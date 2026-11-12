#!/usr/bin/env python3
"""
Sprout Governance — automated test harness.

Runs the revert-assertion and state-assertion cases from the test plan against a
LocalNet node. LocalNet (not testnet) because many cases need rounds to advance on
demand (voting windows, tally_round, the recovery branch) — LocalNet lets us pump
rounds instantly; testnet does not.

What it does:
  * compiles governance.py (via puyapy) OR loads prebuilt TEAL,
  * creates funded accounts (admin + 3 voters) from the LocalNet dispenser,
  * mints a mock "Sprout" ASA (6 decimals, 1:1 microAlgo like production),
  * deploys + bootstraps a fresh governance app with extraPages=1,
  * runs each labeled case, asserting either an expected revert substring or an
    expected resulting global/holding state,
  * prints a PASS/FAIL line per case and a summary, exits nonzero on any FAIL.

This harness covers the deterministic cases (reverts + exact state). Cases that need
human inspection of balances across many winners, or multi-day timing, are left to the
manual plan — see the doc. Each function name maps to a case id (e.g. test_E4_*).

Usage:
    python governance_harness.py                 # all cases
    python governance_harness.py --only D,E,H     # only those categories
    python governance_harness.py --contract ../contracts/governance.py

Requires: py-algorand-sdk, and a running LocalNet (algokit localnet start).
See README_HARNESS.md.
"""

import argparse
import base64
import dataclasses
import os
import subprocess
import sys
import time
from pathlib import Path

try:
    from algosdk import account, mnemonic, transaction, encoding, logic
    from algosdk.v2client import algod
    from algosdk.atomic_transaction_composer import (
        AtomicTransactionComposer,
        TransactionWithSigner,
        AccountTransactionSigner,
    )
    from algosdk.abi import Contract
except ImportError:
    sys.exit("Missing dependency. Run: pip install py-algorand-sdk")

# ── LocalNet defaults (algokit localnet) ──────────────────────────────────────
ALGOD_ADDR = os.environ.get("ALGOD_ADDR", "http://localhost:4001")
ALGOD_TOKEN = os.environ.get("ALGOD_TOKEN", "a" * 64)
# LocalNet's well-known dispenser (KMD default account). Override with DISPENSER_MN.
DISPENSER_MN = os.environ.get("DISPENSER_MN", "")

# Contract constants (keep in sync with governance.py).
MIN_STAKE = 1_000_000
MAX_CANDIDATES = 8
POOL_BUFFER = 100_000
TARGET_WINNERS = 3

HERE = Path(__file__).resolve().parent
DEFAULT_CONTRACT = HERE.parent / "contracts" / "governance.py"
DEFAULT_ARC56 = HERE.parent / "contracts" / "Governance.arc56.json"


# ── tiny result tracker ───────────────────────────────────────────────────────
@dataclasses.dataclass
class Result:
    cid: str
    ok: bool
    detail: str = ""


RESULTS: list[Result] = []

# pc -> assert message, loaded from the ARC-56 sourceInfo. LocalNet's logic-eval error
# only reports the program counter (pc=NNNN), not the assert comment, so we translate
# the pc back into the message to check the RIGHT guard fired.
PC_MESSAGES: dict[int, str] = {}


def load_pc_messages(arc56_path):
    import json
    try:
        spec = json.loads(Path(arc56_path).read_text())
        src = spec["sourceInfo"]["approval"]["sourceInfo"]
        for entry in src:
            msg = entry.get("errorMessage")
            if not msg:
                continue
            for pc in entry.get("pc", []):
                PC_MESSAGES[pc] = msg
    except Exception as e:
        print(f"  (warning: could not load pc->message map: {e})")


def message_for_error(err_text):
    """Pull pc=NNNN from a logic-eval error and return the mapped assert message, if any."""
    import re
    m = re.search(r"pc=(\d+)", str(err_text))
    if m:
        return PC_MESSAGES.get(int(m.group(1)))
    return None


def record(cid, ok, detail=""):
    RESULTS.append(Result(cid, ok, detail))
    mark = "PASS" if ok else "FAIL"
    print(f"  [{mark}] {cid}  {detail}")


# ── client + funding helpers ──────────────────────────────────────────────────
def client() -> algod.AlgodClient:
    return algod.AlgodClient(ALGOD_TOKEN, ALGOD_ADDR)


def dispenser(algod_client):
    """Return (addr, sk) of a funded LocalNet account."""
    if DISPENSER_MN:
        sk = mnemonic.to_private_key(DISPENSER_MN)
        return account.address_from_private_key(sk), sk
    # LocalNet: pull a funded account from KMD.
    try:
        from algosdk.kmd import KMDClient
        kmd = KMDClient("a" * 64, os.environ.get("KMD_ADDR", "http://localhost:4002"))
        wallets = kmd.list_wallets()
        wid = next(w["id"] for w in wallets if w["name"] == "unencrypted-default-wallet")
        handle = kmd.init_wallet_handle(wid, "")
        for a in kmd.list_keys(handle):
            info = algod_client.account_info(a)
            if info.get("amount", 0) > 100_000_000:
                sk = kmd.export_key(handle, "", a)
                return a, sk
    except Exception as e:
        sys.exit(f"Could not get a LocalNet dispenser account via KMD: {e}\n"
                 f"Set DISPENSER_MN to a funded account mnemonic instead.")
    sys.exit("No funded LocalNet account found. Is localnet running?")


def sp(algod_client, fee=1000, flat=True):
    p = algod_client.suggested_params()
    p.flat_fee = flat
    p.fee = fee
    return p


def send(algod_client, signed):
    txid = algod_client.send_transaction(signed)
    return transaction.wait_for_confirmation(algod_client, txid, 6)


def new_account(algod_client, disp_addr, disp_sk, micro=100_000_000):
    sk, addr = account.generate_account()
    pay = transaction.PaymentTxn(disp_addr, sp(algod_client), addr, micro)
    send(algod_client, pay.sign(disp_sk))
    return addr, sk


def fund(algod_client, disp_addr, disp_sk, addr, micro):
    pay = transaction.PaymentTxn(disp_addr, sp(algod_client), addr, micro)
    send(algod_client, pay.sign(disp_sk))


def cur_round(algod_client):
    return algod_client.status()["last-round"]


def advance_rounds(algod_client, disp_addr, disp_sk, n):
    """Pump n rounds by sending n cheap self-payments (each triggers a block)."""
    for _ in range(n):
        pay = transaction.PaymentTxn(disp_addr, sp(algod_client), disp_addr, 0)
        send(algod_client, pay.sign(disp_sk))


# ── ASA + app setup ───────────────────────────────────────────────────────────
def create_asa(algod_client, creator, creator_sk):
    txn = transaction.AssetConfigTxn(
        sender=creator, sp=sp(algod_client),
        total=10_000_000_000_000, decimals=6, default_frozen=False,
        unit_name="SPRT", asset_name="MockSprout",
        manager=creator, reserve=creator, freeze=creator, clawback=creator,
    )
    res = send(algod_client, txn.sign(creator_sk))
    return res["asset-index"]


def opt_in_asa(algod_client, addr, sk, asa):
    txn = transaction.AssetTransferTxn(addr, sp(algod_client), addr, 0, asa)
    send(algod_client, txn.sign(sk))


def send_asa(algod_client, frm, frm_sk, to, asa, amt):
    txn = transaction.AssetTransferTxn(frm, sp(algod_client), to, amt, asa)
    send(algod_client, txn.sign(frm_sk))


def compile_contract(contract_path):
    """Compile governance.py with puyapy; return (approval_teal, clear_teal, arc56_path)."""
    out_dir = contract_path.parent
    subprocess.run(["puyapy", str(contract_path)], check=True, cwd=out_dir)
    approval = (out_dir / "Governance.approval.teal").read_text()
    clear = (out_dir / "Governance.clear.teal").read_text()
    return approval, clear, out_dir / "Governance.arc56.json"


def compile_teal(algod_client, teal):
    res = algod_client.compile(teal)
    return base64.b64decode(res["result"])


# ── Governance app wrapper ────────────────────────────────────────────────────
class Gov:
    def __init__(self, algod_client, arc56_path, app_id, app_addr, asa, admin, admin_sk):
        self.c = algod_client
        self.app_id = app_id
        self.app_addr = app_addr
        self.asa = asa
        self.admin = admin
        self.admin_sk = admin_sk
        import json
        spec = json.loads(Path(arc56_path).read_text())
        self.contract = Contract.from_json(json.dumps(
            {"name": spec["name"], "methods": spec["methods"], "networks": {}}
        ))

    def _m(self, name):
        return self.contract.get_method_by_name(name)

    def call(self, name, args, sender, sk, fee=1000, boxes=None, accounts=None,
             foreign_assets=None, group_pad=0, extra_args_for_pad=None, on_complete=None):
        """Call an ABI method. Returns the ABI return value. Raises on reject.

        on_complete defaults to NoOp, but admin_close and discard_unbootstrapped are
        DeleteApplication methods and must be submitted with that OnComplete or they hit
        the routing assert (they aren't callable as NoOp)."""
        if on_complete is None:
            on_complete = (transaction.OnComplete.DeleteApplicationOC
                           if name in ("admin_close", "discard_unbootstrapped")
                           else transaction.OnComplete.NoOpOC)
        atc = AtomicTransactionComposer()
        signer = AccountTransactionSigner(sk)
        atc.add_method_call(
            app_id=self.app_id, method=self._m(name), sender=sender, signer=signer,
            method_args=args, sp=sp(self.c, fee), on_complete=on_complete,
            boxes=boxes or [], accounts=accounts or [],
            foreign_assets=foreign_assets or [],
        )
        # Opcode-budget filler calls (read-only get_epoch) to pool budget in the group.
        for _ in range(group_pad):
            atc.add_method_call(
                app_id=self.app_id, method=self._m("get_epoch"),
                sender=sender, signer=signer, method_args=[], sp=sp(self.c, 1000),
            )
        res = atc.execute(self.c, 6)
        return res.abi_results[0].return_value

    def global_state(self):
        info = self.c.application_info(self.app_id)
        gs = {}
        for kv in info["params"].get("global-state", []):
            key = base64.b64decode(kv["key"]).decode("utf-8", "replace")
            v = kv["value"]
            gs[key] = v["uint"] if v["type"] == 2 else base64.b64decode(v["bytes"])
        return gs

    def held_sprout(self):
        info = self.c.account_info(self.app_addr)
        for a in info.get("assets", []):
            if a["asset-id"] == self.asa:
                return a["amount"]
        return 0

    def box_names(self):
        try:
            res = self.c.application_boxes(self.app_id)
            return [base64.b64decode(b["name"]) for b in res.get("boxes", [])]
        except Exception:
            return []

    def candidate_boxes(self):
        return [b for b in self.box_names() if b[:2] == b"c:"]

    def voter_box_key(self, addr):
        return b"v:" + encoding.decode_address(addr)

    def candidate_box_key(self, cid):
        return b"c:" + cid.to_bytes(8, "big")


# ── assertion helpers ─────────────────────────────────────────────────────────
def expect_revert(cid, fn, substring):
    """Pass iff fn() raises AND the reverting assert maps to `substring`.

    LocalNet reports only pc=NNNN, so we resolve the pc to the assert message via the
    ARC-56 source map. Falls back to a raw substring match if the error already contains
    the text (some SDK/node combos include it)."""
    try:
        fn()
        record(cid, False, f"expected revert '{substring}', but it succeeded")
    except Exception as e:
        raw = str(e)
        mapped = message_for_error(raw)
        if mapped is not None:
            if substring.lower() in mapped.lower():
                record(cid, True, f"reverted: '{mapped}'")
            else:
                record(cid, False, f"reverted with WRONG assert. wanted '{substring}', got '{mapped}' ({raw[:80]})")
        elif substring.lower() in raw.lower():
            record(cid, True, f"reverted: '{substring}'")
        else:
            record(cid, False, f"reverted but couldn't map pc to a message. wanted '{substring}', raw: {raw[:140]}")


def expect_ok(cid, fn, check=None):
    """Pass iff fn() succeeds (and optional check(ret) is truthy)."""
    try:
        ret = fn()
        if check is not None and not check(ret):
            record(cid, False, f"succeeded but post-check failed (ret={ret})")
            return None
        record(cid, True)
        return ret
    except Exception as e:
        record(cid, False, f"expected success, reverted: {str(e)[:160]}")
        return None


# ── scenario builders ─────────────────────────────────────────────────────────
def deploy_fresh(algod_client, arc56_path, approval, clear, asa, admin, admin_sk,
                 disp_addr, disp_sk):
    """Create + fund + bootstrap a fresh governance app. Returns a Gov."""
    approval_b = compile_teal(algod_client, approval)
    clear_b = compile_teal(algod_client, clear)
    import json
    spec = json.loads(Path(arc56_path).read_text())
    gschema = transaction.StateSchema(
        spec["state"]["schema"]["global"]["ints"],
        spec["state"]["schema"]["global"]["bytes"],
    )
    lschema = transaction.StateSchema(
        spec["state"]["schema"]["local"]["ints"],
        spec["state"]["schema"]["local"]["bytes"],
    )
    create = transaction.ApplicationCreateTxn(
        sender=admin, sp=sp(algod_client),
        on_complete=transaction.OnComplete.NoOpOC,
        approval_program=approval_b, clear_program=clear_b,
        global_schema=gschema, local_schema=lschema,
        extra_pages=1,
    )
    res = send(algod_client, create.sign(admin_sk))
    app_id = res["application-index"]
    app_addr = logic.get_application_address(app_id)
    # fund app (covers base MBR 0.2 + boxes + pool)
    fund(algod_client, disp_addr, disp_sk, app_addr, 5_000_000)
    # bootstrap(admin, asa, escrow_app=0)
    gov = Gov(algod_client, arc56_path, app_id, app_addr, asa, admin, admin_sk)
    gov.call("bootstrap", [admin, asa, 0], admin, admin_sk, fee=2000,
             foreign_assets=[asa])
    return gov


def open_epoch(gov, algod_client, open_off=50, close_off=50, tally_off=10):
    base = cur_round(algod_client)
    vo, vc, tr = base + open_off, base + open_off + close_off, base + open_off + close_off + tally_off
    gov.call("open_epoch", [vo, vc, tr], gov.admin, gov.admin_sk)
    return vo, vc, tr


def register(gov, cid, payout):
    # register_candidate writes the c: candidate box, so it must be declared.
    gov.call("register_candidate", [cid, payout], gov.admin, gov.admin_sk,
             boxes=[(0, gov.candidate_box_key(cid))])


def stake(gov, algod_client, addr, sk, amt):
    # group: [axfer sprout -> app][app call stake(axfer)]
    atc = AtomicTransactionComposer()
    signer = AccountTransactionSigner(sk)
    axfer = transaction.AssetTransferTxn(addr, sp(algod_client), gov.app_addr, amt, gov.asa)
    tws = TransactionWithSigner(axfer, signer)
    boxes = [(0, gov.voter_box_key(addr))]
    atc.add_method_call(
        app_id=gov.app_id, method=gov._m("stake"), sender=addr, signer=signer,
        method_args=[tws], sp=sp(algod_client), boxes=boxes,
    )
    res = atc.execute(algod_client, 6)
    return res.abi_results[0].return_value


def vote(gov, algod_client, addr, sk, cid):
    boxes = [(0, gov.voter_box_key(addr)), (0, gov.candidate_box_key(cid))]
    atc = AtomicTransactionComposer()
    signer = AccountTransactionSigner(sk)
    atc.add_method_call(
        app_id=gov.app_id, method=gov._m("vote"), sender=addr, signer=signer,
        method_args=[cid], sp=sp(algod_client), boxes=boxes,
    )
    res = atc.execute(algod_client, 6)
    return res.abi_results[0].return_value


def unstake(gov, algod_client, addr, sk, amt, voted_cid=None):
    boxes = [(0, gov.voter_box_key(addr))]
    if voted_cid is not None:
        boxes.append((0, gov.candidate_box_key(voted_cid)))
    atc = AtomicTransactionComposer()
    signer = AccountTransactionSigner(sk)
    atc.add_method_call(
        app_id=gov.app_id, method=gov._m("unstake"), sender=addr, signer=signer,
        method_args=[amt], sp=sp(algod_client, 2000), boxes=boxes,
        foreign_assets=[gov.asa],
    )
    res = atc.execute(algod_client, 6)
    return res.abi_results[0].return_value


def tally(gov, algod_client, ranked_ids):
    boxes = [(0, gov.candidate_box_key(c)) for c in ranked_ids]
    pad = max(3, (len(ranked_ids) + 1) // 2)
    atc = AtomicTransactionComposer()
    signer = AccountTransactionSigner(gov.admin_sk)
    atc.add_method_call(
        app_id=gov.app_id, method=gov._m("tally"), sender=gov.admin, signer=signer,
        method_args=[ranked_ids], sp=sp(algod_client), boxes=boxes,
    )
    for i in range(pad):
        atc.add_method_call(
            app_id=gov.app_id, method=gov._m("get_epoch"), sender=gov.admin,
            signer=signer, method_args=[], sp=sp(algod_client), note=bytes([0x62, i]),
        )
    res = atc.execute(algod_client, 6)
    return res.abi_results[0].return_value


# ── the cases ─────────────────────────────────────────────────────────────────
def run_category_A(ctx):
    g = ctx["fresh"]()
    a = ctx
    gov = g
    # A1 deploy/bootstrap already done by fresh()
    gs = gov.global_state()
    record("A1", gs.get("bootstrapped") == 1 and gs.get("phase") == 0, f"bootstrapped, phase={gs.get('phase')}")
    # A2 open epoch
    expect_ok("A2", lambda: open_epoch(gov, a["algod"]))
    gs = gov.global_state()
    record("A2b", gs.get("epoch_id") == 1, f"epoch_id={gs.get('epoch_id')}")
    # A3 register 3
    for i, cid in enumerate([1, 2, 3]):
        register(gov, cid, a["voters"][i][0])
    gs = gov.global_state()
    record("A3", gs.get("candidate_count") == 3 and len(gov.candidate_boxes()) == 3,
           f"candidate_count={gs.get('candidate_count')}, boxes={len(gov.candidate_boxes())}")
    # A4 stake
    for i in range(3):
        stake(gov, a["algod"], a["voters"][i][0], a["voters"][i][1], 2_000_000)
    record("A4", gov.held_sprout() == 6_000_000, f"held={gov.held_sprout()}")
    # A5 advance into the voting window, then each voter votes their candidate.
    # vote_open is at base+50; registering + staking already consumed some rounds, so
    # advance to comfortably inside [vote_open, vote_close].
    _advance_to(a, "vote_open_round")
    for i, cid in enumerate([1, 2, 3]):
        expect_ok(f"A5-vote{cid}",
                  lambda i=i, cid=cid: vote(gov, a["algod"], a["voters"][i][0], a["voters"][i][1], cid),
                  check=lambda r: r == 2_000_000)
    # get_candidate_weight reads the c: box, so declare it.
    w1 = gov.call("get_candidate_weight", [1], gov.admin, gov.admin_sk,
                  boxes=[(0, gov.candidate_box_key(1))])
    record("A5", w1 == 2_000_000, f"candidate 1 weight={w1}")


def _advance_to(ctx, which):
    # helper used by A; re-opens epoch bookkeeping. For simplicity advance 60 rounds.
    advance_rounds(ctx["algod"], ctx["disp"][0], ctx["disp"][1], 60)


def run_category_C(ctx):
    a = ctx
    gov = a["fresh"]()
    open_epoch(gov, a["algod"])
    register(gov, 1, a["voters"][0][0])
    v, vk = a["voters"][0]
    # C4: new stake below MIN_STAKE
    expect_revert("C4", lambda: stake(gov, a["algod"], v, vk, 500_000),
                  "stake below minimum")
    # proper stake 3 ALGO
    stake(gov, a["algod"], v, vk, 3_000_000)
    # C3: unstake leaving sub-min remainder
    expect_revert("C3", lambda: unstake(gov, a["algod"], v, vk, 2_600_000),
                  "unstake to zero or leave >= minimum")
    # C5: unstake more than staked
    expect_revert("C5", lambda: unstake(gov, a["algod"], v, vk, 9_000_000),
                  "exceeds staked")
    # C6: zero unstake
    expect_revert("C6", lambda: unstake(gov, a["algod"], v, vk, 0), "zero unstake")
    # C7: unstake from non-staker
    v2, vk2 = a["voters"][1]
    expect_revert("C7", lambda: unstake(gov, a["algod"], v2, vk2, 1_000_000), "nothing staked")
    # C2: full exit
    expect_ok("C2", lambda: unstake(gov, a["algod"], v, vk, 3_000_000),
              check=lambda r: r == 0)
    record("C2-box", gov.voter_box_key(v) not in gov.box_names(), "voter box deleted")


def run_category_E(ctx):
    a = ctx
    algod_client = a["algod"]
    # E1: 0-candidate tally reaches phase 2
    gov = a["fresh"]()
    open_epoch(gov, algod_client)
    advance_rounds(algod_client, a["disp"][0], a["disp"][1], 120)
    expect_ok("E1", lambda: tally(gov, algod_client, []))
    record("E1-phase", gov.global_state().get("phase") == 2, "phase=2 after 0-candidate tally")

    # E2: candidates, nobody votes
    gov = a["fresh"]()
    open_epoch(gov, algod_client)
    for cid in (1, 2, 3):
        register(gov, cid, a["voters"][0][0])
    advance_rounds(algod_client, a["disp"][0], a["disp"][1], 120)
    expect_ok("E2", lambda: tally(gov, algod_client, [1, 2, 3]))
    gs = gov.global_state()
    record("E2-state", gs.get("phase") == 2 and gs.get("candidate_count") == 0 and len(gov.candidate_boxes()) == 0,
           f"phase={gs.get('phase')}, boxes={len(gov.candidate_boxes())}")

    # E4: wrong order
    gov = a["fresh"]()
    open_epoch(gov, algod_client)
    for cid in (1, 2):
        register(gov, cid, a["voters"][0][0])
    v, vk = a["voters"][0]
    advance_rounds(algod_client, a["disp"][0], a["disp"][1], 55)  # into vote window
    stake(gov, algod_client, v, vk, 2_000_000)
    vote(gov, algod_client, v, vk, 1)  # candidate 1 has weight, 2 has 0
    advance_rounds(algod_client, a["disp"][0], a["disp"][1], 120)
    # submit ascending (wrong): [2,1] where 1 has more weight
    expect_revert("E4", lambda: tally(gov, algod_client, [2, 1]), "ranking not descending")

    # E5: fewer ids than candidate_count
    gov = a["fresh"]()
    open_epoch(gov, algod_client)
    for cid in (1, 2, 3):
        register(gov, cid, a["voters"][0][0])
    advance_rounds(algod_client, a["disp"][0], a["disp"][1], 120)
    expect_revert("E5", lambda: tally(gov, algod_client, [1, 2]), "must list all candidates")

    # E6: tally before tally_round
    gov = a["fresh"]()
    open_epoch(gov, algod_client)
    register(gov, 1, a["voters"][0][0])
    expect_revert("E6", lambda: tally(gov, algod_client, [1]), "tally not open")

    # E9: full 8-candidate tally succeeds (budget pooling)
    gov = a["fresh"]()
    open_epoch(gov, algod_client)
    for cid in range(1, 9):
        register(gov, cid, a["voters"][0][0])
    advance_rounds(algod_client, a["disp"][0], a["disp"][1], 120)
    expect_ok("E9", lambda: tally(gov, algod_client, list(range(1, 9))))
    record("E9-boxes", len(gov.candidate_boxes()) == 0, "all 8 candidate boxes deleted")

    # E11: non-admin tally
    gov = a["fresh"]()
    open_epoch(gov, algod_client)
    register(gov, 1, a["voters"][0][0])
    advance_rounds(algod_client, a["disp"][0], a["disp"][1], 120)
    v2, vk2 = a["voters"][1]
    def nonadmin_tally():
        boxes = [(0, gov.candidate_box_key(1))]
        atc = AtomicTransactionComposer()
        s = AccountTransactionSigner(vk2)
        atc.add_method_call(app_id=gov.app_id, method=gov._m("tally"), sender=v2,
                            signer=s, method_args=[[1]], sp=sp(algod_client), boxes=boxes)
        for i in range(3):
            atc.add_method_call(app_id=gov.app_id, method=gov._m("get_epoch"),
                                sender=v2, signer=s, method_args=[], sp=sp(algod_client),
                                note=bytes([i]))
        atc.execute(algod_client, 6)
    expect_revert("E11", nonadmin_tally, "admin only")


def run_category_D(ctx):
    a = ctx
    algod_client = a["algod"]
    # D1: vote in epoch 1, finalize, unstake while still epoch 1 (phase 2)
    gov = a["fresh"]()
    open_epoch(gov, algod_client)
    register(gov, 1, a["voters"][0][0])
    v, vk = a["voters"][0]
    advance_rounds(algod_client, a["disp"][0], a["disp"][1], 55)
    stake(gov, algod_client, v, vk, 2_000_000)
    vote(gov, algod_client, v, vk, 1)
    advance_rounds(algod_client, a["disp"][0], a["disp"][1], 120)
    # finalize: tally (1 winner), pay, finish
    tally(gov, algod_client, [1])
    gs = gov.global_state()
    if gs.get("phase") == 1:
        gov.call("pay_winners", [gs.get("winner_count", 1)], gov.admin, gov.admin_sk,
                 fee=1000 * (gs.get("winner_count", 1) + 1), accounts=[a["voters"][0][0]])
        gov.call("finish_tally", [], gov.admin, gov.admin_sk)
    # now phase 2, still epoch 1; unstake must succeed without touching deleted c:1
    expect_ok("D1", lambda: unstake(gov, algod_client, v, vk, 2_000_000, voted_cid=1),
              check=lambda r: r == 0)

    # D2: cross-epoch — finalize epoch1, open epoch2, then unstake epoch-1 voter
    gov = a["fresh"]()
    open_epoch(gov, algod_client)
    register(gov, 1, a["voters"][0][0])
    v, vk = a["voters"][1]
    advance_rounds(algod_client, a["disp"][0], a["disp"][1], 55)
    stake(gov, algod_client, v, vk, 2_000_000)
    vote(gov, algod_client, v, vk, 1)
    advance_rounds(algod_client, a["disp"][0], a["disp"][1], 120)
    tally(gov, algod_client, [1])
    gs = gov.global_state()
    if gs.get("phase") == 1:
        gov.call("pay_winners", [1], gov.admin, gov.admin_sk, fee=2000, accounts=[a["voters"][0][0]])
        gov.call("finish_tally", [], gov.admin, gov.admin_sk)
    open_epoch(gov, algod_client)  # epoch 2
    expect_ok("D2", lambda: unstake(gov, algod_client, v, vk, 2_000_000, voted_cid=1),
              check=lambda r: r == 0)


def run_category_G(ctx):
    a = ctx
    algod_client = a["algod"]
    gov = a["fresh"]()
    v2, vk2 = a["voters"][1]
    # G1 non-admin open_epoch
    def nonadmin_open():
        base = cur_round(algod_client)
        gov.call("open_epoch", [base + 50, base + 100, base + 110], v2, vk2)
    expect_revert("G1", nonadmin_open, "admin only")
    # G4 vote_open not in future
    def past_open():
        base = cur_round(algod_client)
        gov.call("open_epoch", [base, base + 50, base + 60], gov.admin, gov.admin_sk)
    expect_revert("G4", past_open, "vote_open must be in the future")
    # G5 ordering
    def bad_order():
        base = cur_round(algod_client)
        gov.call("open_epoch", [base + 100, base + 50, base + 200], gov.admin, gov.admin_sk)
    expect_revert("G5", bad_order, "vote_close must follow vote_open")
    # open a real epoch for the rest
    open_epoch(gov, algod_client)
    # G8 9th candidate (fill to 8, then the 9th is over the limit)
    for cid in range(1, 9):
        register(gov, cid, a["voters"][0][0])
    expect_revert("G8", lambda: register(gov, 9, a["voters"][0][0]), "candidate limit reached")
    # G9 duplicate — on a FRESH app with room, so the duplicate assert is reached before
    # the limit assert (which fires first when the ballot is already full).
    gov2 = a["fresh"]()
    open_epoch(gov2, algod_client)
    register(gov2, 5, a["voters"][0][0])
    expect_revert("G9", lambda: register(gov2, 5, a["voters"][0][0]), "candidate exists")


def run_category_H(ctx):
    a = ctx
    algod_client = a["algod"]
    # H5 admin_close while holding Sprout
    gov = a["fresh"]()
    open_epoch(gov, algod_client)
    register(gov, 1, a["voters"][0][0])
    v, vk = a["voters"][0]
    advance_rounds(algod_client, a["disp"][0], a["disp"][1], 55)
    stake(gov, algod_client, v, vk, 2_000_000)
    expect_revert("H5", lambda: gov.call("admin_close", [], gov.admin, gov.admin_sk,
                  fee=3000, foreign_assets=[gov.asa], accounts=[gov.admin]),
                  "unstake all voter Sprout")
    # H6 admin_close while candidate boxes remain (unstake first so H5 passes, candidates remain)
    unstake(gov, algod_client, v, vk, 2_000_000, voted_cid=None)
    expect_revert("H6", lambda: gov.call("admin_close", [], gov.admin, gov.admin_sk,
                  fee=3000, foreign_assets=[gov.asa], accounts=[gov.admin]),
                  "clear candidates first")
    # H2 admin_delete_candidate during live voting (phase 0, before tally) — RECOVERY_DELAY=0
    # so this is only blocked BEFORE tally_round. We are before tally_round here.
    expect_revert("H2", lambda: gov.call("admin_delete_candidate", [1], gov.admin, gov.admin_sk,
                  boxes=[(0, gov.candidate_box_key(1))]),
                  "cleanup after finalize")
    # H3 after tally_round, recovery delete works (RECOVERY_DELAY=0)
    advance_rounds(algod_client, a["disp"][0], a["disp"][1], 120)
    expect_ok("H3", lambda: gov.call("admin_delete_candidate", [1], gov.admin, gov.admin_sk,
              boxes=[(0, gov.candidate_box_key(1))]))
    record("H3-box", len(gov.candidate_boxes()) == 0, "candidate box deleted via recovery")
    # H4 now close cleanly (no Sprout, no boxes)
    expect_ok("H4", lambda: gov.call("admin_close", [], gov.admin, gov.admin_sk,
              fee=3000, foreign_assets=[gov.asa], accounts=[gov.admin]))


def run_category_F(ctx):
    a = ctx
    algod_client = a["algod"]
    # F3/F5/F6 cursor + phase guards around a real 1-winner payout
    gov = a["fresh"]()
    open_epoch(gov, algod_client)
    register(gov, 1, a["voters"][0][0])
    v, vk = a["voters"][0]
    advance_rounds(algod_client, a["disp"][0], a["disp"][1], 55)
    stake(gov, algod_client, v, vk, 2_000_000)
    vote(gov, algod_client, v, vk, 1)
    advance_rounds(algod_client, a["disp"][0], a["disp"][1], 120)
    # F5: pay_winners before tally (phase 0 already passed; now call tally)
    tally(gov, algod_client, [1])
    gs = gov.global_state()
    if gs.get("phase") != 1:
        record("F*", False, f"expected phase 1 after tally with a winner, got {gs.get('phase')}")
        return
    wc = gs.get("winner_count", 1)
    # F6: finish before paying
    expect_revert("F6", lambda: gov.call("finish_tally", [], gov.admin, gov.admin_sk),
                  "pay all winners first")
    # pay
    expect_ok("F1", lambda: gov.call("pay_winners", [wc], gov.admin, gov.admin_sk,
              fee=1000 * (wc + 1), accounts=[a["voters"][0][0]]))
    # F3: pay again
    expect_revert("F3", lambda: gov.call("pay_winners", [1], gov.admin, gov.admin_sk,
                  accounts=[a["voters"][0][0]]), "all winners already paid")
    # finish
    expect_ok("F-finish", lambda: gov.call("finish_tally", [], gov.admin, gov.admin_sk))
    record("F-phase2", gov.global_state().get("phase") == 2, "phase=2 after finish")


# ── main ──────────────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--contract", default=str(DEFAULT_CONTRACT))
    ap.add_argument("--arc56", default=str(DEFAULT_ARC56))
    ap.add_argument("--only", default="", help="comma list of categories, e.g. D,E,H")
    ap.add_argument("--no-compile", action="store_true",
                    help="use prebuilt TEAL/arc56 instead of running puyapy")
    args = ap.parse_args()

    algod_client = client()
    try:
        algod_client.status()
    except Exception as e:
        sys.exit(f"Cannot reach algod at {ALGOD_ADDR}: {e}\nStart LocalNet: algokit localnet start")

    contract_path = Path(args.contract)
    if args.no_compile:
        out = contract_path.parent
        approval = (out / "Governance.approval.teal").read_text()
        clear = (out / "Governance.clear.teal").read_text()
        arc56_path = Path(args.arc56)
    else:
        print("Compiling contract with puyapy…")
        approval, clear, arc56_path = compile_contract(contract_path)

    load_pc_messages(arc56_path)

    disp_addr, disp_sk = dispenser(algod_client)
    print(f"Dispenser: {disp_addr}")

    # admin + 3 voters
    admin, admin_sk = new_account(algod_client, disp_addr, disp_sk, 50_000_000)
    voters = [new_account(algod_client, disp_addr, disp_sk, 50_000_000) for _ in range(3)]

    # ASA: admin creates, everyone opts in, voters funded with Sprout
    asa = create_asa(algod_client, admin, admin_sk)
    for addr, sk in voters:
        opt_in_asa(algod_client, addr, sk, asa)
        send_asa(algod_client, admin, admin_sk, addr, asa, 1_000_000_000)
    print(f"ASA: {asa}")

    def fresh():
        return deploy_fresh(algod_client, arc56_path, approval, clear, asa,
                            admin, admin_sk, disp_addr, disp_sk)

    ctx = {
        "algod": algod_client, "fresh": fresh, "admin": (admin, admin_sk),
        "voters": voters, "disp": (disp_addr, disp_sk), "asa": asa,
    }

    cats = {
        "A": run_category_A, "C": run_category_C, "D": run_category_D,
        "E": run_category_E, "F": run_category_F, "G": run_category_G,
        "H": run_category_H,
    }
    only = [c.strip().upper() for c in args.only.split(",") if c.strip()]
    to_run = only or list(cats.keys())

    for cat in to_run:
        if cat not in cats:
            print(f"(skipping unknown category {cat})")
            continue
        print(f"\n=== Category {cat} ===")
        try:
            cats[cat](ctx)
        except Exception as e:
            record(f"{cat}-SETUP", False, f"category crashed: {str(e)[:200]}")

    # summary
    passed = sum(1 for r in RESULTS if r.ok)
    failed = sum(1 for r in RESULTS if not r.ok)
    print(f"\n{'='*50}\nSUMMARY: {passed} passed, {failed} failed, {len(RESULTS)} total")
    if failed:
        print("\nFailures:")
        for r in RESULTS:
            if not r.ok:
                print(f"  {r.cid}: {r.detail}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
