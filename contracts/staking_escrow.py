# staking_escrow.py — Sprout Staking Escrow (App A)
#
# Algorand Python (Puya / ARC-4). Non-custodial staking escrow that:
#   * holds all contributed ALGO
#   * holds the full Sprout ASA supply and dispenses/reclaims it 1:1 against ALGO
#   * participates in Algorand consensus (keyreg) so the balance earns rewards
#   * sweeps ONLY the reward surplus (never principal) to the governance funding pool
#
# Safety model (see the design spec): accounted_principal is DERIVED from the
# token supply, never stored. Because the only lever that moves sprout_held is the
# 1:1 deposit/withdraw transfer, the principal figure cannot drift from real ALGO
# principal. This structurally eliminates the mint/burn asymmetry that produced
# three High-severity findings in Folks Finance xALGO.
#
# Invariants enforced here:
#   I3  deposit moves ALGO in and Sprout out by the SAME amount
#   I4  withdraw moves Sprout in and ALGO out by the SAME amount (flat 1:1, never share-price)
#   I5  app_balance >= accounted_principal + live_mbr  at all times
#   I6  harvest sweeps only app_balance - accounted_principal - live_mbr - HARVEST_BUFFER
#
# NOTE ON CONSTANTS: SUPPLY_BASE below is 10,000,000,000 Sprout * 10^6 decimals.
# Keep Sprout decimals == 6 so 1 Sprout base unit == 1 microAlgo (clean 1:1).
 
from algopy import (
    ARC4Contract,
    Account,
    Asset,
    Global,
    Txn,
    UInt64,
    Bytes,
    itxn,
    gtxn,
    subroutine,
)
from algopy.arc4 import abimethod, Address
 
 
# 10,000,000,000 Sprout at 6 decimals, in base units. Mirrors ALGO's supply.
# Module-level constants are plain Python ints (Puya does not allow UInt64(...)
# calls at module scope); they coerce to UInt64 at each use site.
SUPPLY_BASE = 10_000_000_000_000_000
 
# C1: Durable headroom kept ABOVE accounted_principal + live_mbr and never swept.
# 1 ALGO. If the protocol ever RAISES the account MBR, this absorbs the increase
# so outstanding withdrawals keep clearing instead of hitting "would breach min
# balance". A manual admin top-up would be swept by the next harvest; this buffer
# sits below the harvest floor, so it is permanent.
HARVEST_BUFFER = 1_000_000
 
# M2: Algorand participation-key byte lengths (ed25519 vote/selection = 32,
# state-proof key = 64). A malformed key would register the account online with
# keys it cannot actually sign blocks with — silently forfeiting rewards and risking
# being marked absent. Validate up front.
VOTE_PK_LEN = 32
SEL_PK_LEN = 32
SP_PK_LEN = 64
 
 
class StakingEscrow(ARC4Contract):
    def __init__(self) -> None:
        # Set once by bootstrap(); 0 until then.
        self.sprout_asa_id = UInt64(0)
        # Funding-pool destination. Set once at bootstrap, then IMMUTABLE (M1 — no
        # set_pool). Harvest pays THIS address.
        #
        # TESTING NOTE: for standalone escrow testing this is a plain WALLET
        # address, so harvested yield lands somewhere you can watch directly
        # without deploying the governance app. For the production design, this
        # becomes the governance app's account (either pass that app's address
        # here, or revert to the app-id-derived form — Application(id).address —
        # which removes the ability to mistype the destination). The address is
        # validated non-zero at bootstrap and can never change afterward.
        self.funding_pool_addr = Account()
        # Admin manages keyreg and the deposit pause. Set once at bootstrap, then
        # IMMUTABLE (M3 — no set_admin). Pass a multisig here for safety.
        self.admin = Account()
        # 0/1 consensus registration state (telemetry; keyreg itself is the source of truth).
        self.is_online = UInt64(0)
        # Lifetime microAlgo swept to the pool (telemetry only).
        self.total_harvested = UInt64(0)
        # Deposit circuit breaker. Withdraw is NEVER gated by this.
        self.paused = UInt64(0)
 
    # ──────────────────────────────────────────────────────────────────────
    # Derived quantities — computed per call, never stored.
    # ──────────────────────────────────────────────────────────────────────
 
    @subroutine
    def _sprout(self) -> Asset:
        return Asset(self.sprout_asa_id)
 
    @subroutine
    def _sprout_held(self) -> UInt64:
        # Balance of the app's own holding of the Sprout ASA.
        # No opt-in assertion: the escrow is the ASA CREATOR, so bootstrap's
        # AssetConfig lands the full supply in the app account and opts it in
        # atomically (see H-A). There is no reachable state where the app holds
        # Sprout but is not opted in, so a check here would be dead code.
        return self._sprout().balance(Global.current_application_address)
 
    @subroutine
    def _accounted_principal(self) -> UInt64:
        # The ALGO principal contributors can still reclaim.
        # = total supply minus whatever Sprout the contract still holds.
        return SUPPLY_BASE - self._sprout_held()
 
    @subroutine
    def _live_mbr(self) -> UInt64:
        # Live minimum balance of the app account (base + per-ASA + any boxes).
        # Read from the ledger, NEVER hardcoded, so a protocol MBR change can't strand funds.
        return Global.current_application_address.min_balance
 
    @subroutine
    def _pool_addr(self) -> Account:
        # The funding pool's receiving account. For testing this is the wallet
        # address pinned at bootstrap. (Production: swap for an app-id-derived
        # address to remove the mistype risk — see the field comment.)
        return self.funding_pool_addr
 
    @subroutine
    def _harvest_floor(self) -> UInt64:
        # Single source of truth for the line harvest must never cross.
        # Everything below this stays in the escrow: principal (owed to depositors),
        # the live MBR (so the account keeps functioning), and the C1 buffer.
        return self._accounted_principal() + self._live_mbr() + HARVEST_BUFFER
 
    @subroutine
    def _assert_admin(self) -> None:
        assert Txn.sender == self.admin, "admin only"
 
    # ──────────────────────────────────────────────────────────────────────
    # Bootstrap — pins admin + pool immutably and mints the fixed supply.
    # ──────────────────────────────────────────────────────────────────────
 
    @abimethod()
    def bootstrap(self, admin: Address, pool_addr: Address) -> UInt64:
        """Create the Sprout ASA (full supply to the app) and record admin + pool.
 
        Callable only by the deployer, exactly once. The deployer must fund the
        app account first so it meets min balance for creating + holding the ASA.
 
        admin / pool_addr are pinned here and can never change (M1, M3). Pass a
        MULTISIG as `admin` so loss of a single key cannot freeze keyreg/pause.

        TESTING: pool_addr is a plain wallet address that receives harvested
        yield, so the escrow can be exercised without the governance app. Both
        addresses are validated non-zero and are immutable thereafter.
        Returns the new ASA id.
        """
        # Only the deployer may bootstrap, and only once.
        assert Txn.sender == Global.creator_address, "deployer only"
        assert self.sprout_asa_id == 0, "already bootstrapped"
 
        # Immutable references must be real.
        assert admin.native != Global.zero_address, "admin cannot be zero"
        assert pool_addr.native != Global.zero_address, "pool address cannot be zero"
 
        # H1: Non-custodial token. reserve, freeze and clawback are left as the zero
        # address — permanently (a role zeroed at creation is irreversibly locked on
        # Algorand). So supply can never be minted beyond the fixed total, no account
        # can be frozen, and no tokens can be seized — by ANYONE, including this
        # contract or its manager. These are the depositor-protecting properties, and
        # they make accounted_principal = SUPPLY - sprout_held correct by construction.
        #
        # manager IS set — to the ESCROW APP ITSELF (no private key). Why it's needed
        # and why it's safe:
        #   * NEEDED: the app is the ASA creator, and a creator account cannot close
        #     while its asset exists; the asset can only be shed by DESTROYING it, and
        #     destroy requires the manager. Without a manager, admin_close can never
        #     fully close the account — the MBR would strand (this is the exact dead-
        #     lock hit on the first live deploy, pc=860).
        #   * SAFE: the manager is an account with no key; it can only act when THIS
        #     contract's code issues an AssetConfig, which happens in exactly two
        #     places — bootstrap (one-time create) and admin_close (destroy, gated on
        #     principal==0 + admin). The contract is non-upgradable, so no other
        #     AssetConfig path can ever be added. The manager power (reconfigure/
        #     destroy) is therefore unreachable except via those two gated paths, and
        #     the dangerous powers (freeze/clawback) are locked off above regardless.
        created = itxn.AssetConfig(
            total=SUPPLY_BASE,
            decimals=6,
            unit_name=b"SPRT",
            asset_name=b"Sprout",
            manager=Global.current_application_address,
            default_frozen=False,
            fee=0,
        ).submit()
 
        self.sprout_asa_id = created.created_asset.id
        self.admin = admin.native
        self.funding_pool_addr = pool_addr.native
        return self.sprout_asa_id
 
    @abimethod()
    def set_pause(self, flag: UInt64) -> None:
        self._assert_admin()
        assert flag <= 1, "flag must be 0 or 1"
        self.paused = flag
 
    # ──────────────────────────────────────────────────────────────────────
    # Deposit — ALGO in, Sprout out 1:1 (I3)
    # ──────────────────────────────────────────────────────────────────────
 
    @abimethod()
    def deposit(self, pay: gtxn.PaymentTransaction) -> UInt64:
        """Group: [Payment -> app][this call]. Mints Sprout 1:1 to the depositor.
 
        Returns the amount of Sprout sent (== microAlgo deposited).
        """
        assert self.paused == 0, "deposits paused"
        assert self.sprout_asa_id != 0, "not bootstrapped"
 
        # H3-style ordering guard: the payment must come BEFORE this app call in
        # the group, so a later txn in the same group can't be reinterpreted as the
        # funding payment for this mint.
        assert pay.group_index < Txn.group_index, "payment must precede this call"
 
        # The payment must be to the app account, from the caller, nonzero.
        assert pay.receiver == Global.current_application_address, "pay must target escrow"
        assert pay.sender == Txn.sender, "payer must be caller"
        amount = pay.amount
        assert amount > 0, "zero deposit"
 
        # Depositor must already be opted into the Sprout ASA, or the inner
        # transfer back to them would fail and revert the whole group. Check it
        # up front with a clear error instead of a late, opaque failure.
        assert Txn.sender.is_opted_in(self._sprout()), "opt into Sprout before depositing"
 
        # I3: send back EXACTLY `amount` Sprout. 1:1, no fee skim.
        itxn.AssetTransfer(
            xfer_asset=self.sprout_asa_id,
            asset_receiver=Txn.sender,
            asset_amount=amount,
            fee=0,
        ).submit()
 
        return amount
 
    # ──────────────────────────────────────────────────────────────────────
    # Withdraw — Sprout in, ALGO out 1:1 (I4). FLAT, never share-price.
    # ──────────────────────────────────────────────────────────────────────
 
    @abimethod()
    def withdraw(self, axfer: gtxn.AssetTransferTransaction) -> UInt64:
        """Group: [AssetTransfer Sprout -> app][this call]. Returns ALGO 1:1.
 
        Withdraw is never pausable and never depends on the governance app.
        Returns the microAlgo paid out (== Sprout burned-in).
        """
        assert self.sprout_asa_id != 0, "not bootstrapped"
 
        # H3: the asset transfer must come BEFORE this app call in the group.
        # The payout is read straight off the referenced `axfer` (algo_out == n ==
        # axfer.asset_amount), not from an account balance, so this ordering guard
        # is not what makes the 1:1 amount correct. It pins the referenced txn's
        # position so the group's shape is unambiguous — the axfer that funds this
        # withdraw sits where callers and reviewers expect, rather than being some
        # later transaction reinterpreted as the Sprout-in. Defense-in-depth, not a
        # load-bearing invariant.
        assert axfer.group_index < Txn.group_index, "asset transfer must precede this call"
 
        assert axfer.xfer_asset == self._sprout(), "wrong asset"
        assert axfer.asset_receiver == Global.current_application_address, "must send Sprout to escrow"
        assert axfer.sender == Txn.sender, "sender must be caller"
 
        n = axfer.asset_amount
        assert n > 0, "zero withdraw"

        # NOTE: we deliberately do NOT assert `n <= accounted_principal` here.
        # By the time this call body runs, the axfer has ALREADY landed (it precedes
        # this call in the group), so accounted_principal = SUPPLY - sprout_held
        # already reflects the returned Sprout. On a full withdrawal that returns a
        # holder's entire balance, accounted_principal reads 0 while n is their whole
        # amount — an `n <= principal` check would wrongly revert the legitimate
        # "withdraw everything" case (observed on-chain: pc=529 assert fail).
        #
        # No such check is needed: n is bounded by the Sprout the caller actually
        # sent, the ASA transfer itself prevents sending more than they hold, and
        # every Sprout was minted 1:1 against a real ALGO deposit. So n can never
        # exceed the ALGO the contract owes. The real guard is the min-balance check
        # below, which prevents paying out more ALGO than the account can spend.
        algo_out = n  # I4: FLAT 1:1. Never n * balance / circulating.
 
        # I5: paying out must not drop the account below its live minimum balance.
        app_bal = Global.current_application_address.balance
        assert app_bal >= algo_out + self._live_mbr(), "would breach min balance"
 
        itxn.Payment(
            receiver=Txn.sender,
            amount=algo_out,
            fee=0,
        ).submit()
 
        return algo_out
 
    # ──────────────────────────────────────────────────────────────────────
    # Harvest — sweep ONLY the reward surplus to the pool (I5/I6). Permissionless.
    # ──────────────────────────────────────────────────────────────────────
 
    @abimethod()
    def harvest(self) -> UInt64:
        """Sweep (balance - principal - live_mbr - buffer) to the funding pool.
 
        Permissionless: rewards arrive silently as balance increases with no event,
        so anyone may trigger the sweep. Caller pays the inner-txn fee. Returns the
        swept amount.
        """
        assert self.funding_pool_addr != Global.zero_address, "pool unset"
 
        app_bal = Global.current_application_address.balance
 
        # I5/I6 + C1: the account must cover principal + MBR + buffer before we
        # sweep anything. Checked subtraction — revert rather than ever touch
        # principal (the fix the Folks reports all lacked), and keep the buffer in
        # reserve so a later MBR increase can't strand withdrawals.
        floor = self._harvest_floor()
        assert app_bal >= floor, "no surplus: balance below principal+mbr+buffer"
        surplus = app_bal - floor
        assert surplus > 0, "nothing to harvest"
 
        itxn.Payment(
            receiver=self._pool_addr(),
            amount=surplus,
            fee=0,
        ).submit()
 
        self.total_harvested += surplus
        return surplus
 
    # ──────────────────────────────────────────────────────────────────────
    # Consensus participation — keyreg inner transactions (admin)
    # ──────────────────────────────────────────────────────────────────────
 
    @abimethod()
    def go_online(
        self,
        vote_pk: Bytes,
        sel_pk: Bytes,
        sp_pk: Bytes,
        vote_first: UInt64,
        vote_last: UInt64,
        vote_kd: UInt64,
    ) -> None:
        """Register the escrow account ONLINE for consensus with the given keys.
 
        Going online does not change MBR. Participation keys can only vote in
        consensus, never spend — that is what keeps staking non-custodial.
 
        M2: validate the keys and the round window before registering, so a typo or
        a stale/expired key set can't put the account online in a broken state
        (which silently forfeits rewards and can get it marked absent).
        """
        self._assert_admin()
        assert self.sprout_asa_id != 0, "not bootstrapped"  # M-A
 
        # Key byte lengths must match Algorand's ed25519 / state-proof formats.
        assert vote_pk.length == VOTE_PK_LEN, "vote key must be 32 bytes"
        assert sel_pk.length == SEL_PK_LEN, "selection key must be 32 bytes"
        assert sp_pk.length == SP_PK_LEN, "state-proof key must be 64 bytes"
 
        # Round window must be sane and not already expired.
        assert vote_last > vote_first, "vote_last must exceed vote_first"
        assert vote_last > Global.round, "participation window already expired"
        assert vote_kd > 0, "vote key dilution must be positive"
 
        itxn.KeyRegistration(
            vote_key=vote_pk,
            selection_key=sel_pk,
            state_proof_key=sp_pk,
            vote_first=vote_first,
            vote_last=vote_last,
            vote_key_dilution=vote_kd,
            fee=0,
        ).submit()
        self.is_online = UInt64(1)
 
    @abimethod()
    def go_offline(self) -> None:
        """Deregister from consensus (empty keyreg)."""
        self._assert_admin()
        assert self.sprout_asa_id != 0, "not bootstrapped"  # M-A
        itxn.KeyRegistration(fee=0).submit()
        self.is_online = UInt64(0)

    # ──────────────────────────────────────────────────────────────────────
    # Admin close / recover — SAFE teardown, only when nobody is owed principal.
    # ──────────────────────────────────────────────────────────────────────

    @abimethod(allow_actions=["DeleteApplication"])
    def discard_unbootstrapped(self) -> None:
        """Delete an app that was CREATED but never bootstrapped (creator-only).

        Guards the "created but not bootstrapped → stuck forever" trap: before
        bootstrap, admin is the zero address, so admin_close's admin check can
        never pass and the app would otherwise be un-deletable, locking 0.1 ALGO
        of the creator's min-balance permanently. This lets the original creator
        tear down such an empty shell.

        Strictly limited to the pre-bootstrap state: it asserts sprout_asa_id == 0,
        so it can NEVER run on a live escrow holding depositor funds. Once
        bootstrapped, only admin_close (with its principal==0 gate) can delete.
        No ASA to destroy and the account holds no principal, so it just closes any
        residual ALGO back to the creator and lets the delete proceed.
        """
        assert Txn.sender == Global.creator_address, "creator only"
        assert self.sprout_asa_id == 0, "already bootstrapped: use admin_close"

        # Return any stray ALGO in the app account to the creator and zero it.
        itxn.Payment(
            receiver=Global.creator_address,
            amount=0,
            close_remainder_to=Global.creator_address,
            fee=0,
        ).submit()

    @abimethod(allow_actions=["DeleteApplication"])
    def admin_close(self) -> None:
        """Destroy the ASA, send all remaining ALGO to admin, and delete the app.

        SAFETY GATE: this is permitted ONLY when accounted_principal == 0 — i.e.
        every unit of Sprout has been burned back and the app holds the FULL supply
        again, so no depositor has an outstanding claim. While ANY principal is
        outstanding, this reverts. It can therefore never seize a depositor's funds:
        the only ALGO it recovers is the residual (MBR + buffer + unharvested
        surplus), which at principal == 0 is entirely the admin's own.

        This preserves the non-custodial guarantee — a compromised admin key still
        cannot drain staked principal, because it cannot make this call succeed
        while anyone is staked.

        Called as a DeleteApplication so the outer txn tears down the app itself.
        """
        self._assert_admin()
        assert self.sprout_asa_id != 0, "not bootstrapped"

        # SAFETY GATE: all Sprout must be back in the contract (principal fully
        # redeemed). Equivalent to sprout_held == SUPPLY_BASE.
        assert self._accounted_principal() == 0, "principal outstanding: depositors still owed"

        # Must be OFFLINE before closing — never tear down an account that is still
        # registered for consensus.
        assert self.is_online == 0, "go offline before closing"

        # 1) Destroy the Sprout ASA. The app is the ASA MANAGER and holds 100% of
        # supply (guaranteed by principal == 0 above), so this destroy is authorized
        # and valid. Destroying it is what lets the CREATOR account (the app) shed the
        # asset — a creator cannot close while its asset exists, and cannot shed it
        # any other way. This drops the per-ASA MBR so the account can fully close.
        # (An AssetConfig with only config_asset set and no new roles is the destroy
        # op; the inner txn sender is the app account = the manager.)
        itxn.AssetConfig(
            config_asset=self.sprout_asa_id,
            fee=0,
        ).submit()

        # 2) Close the app account: send ALL remaining ALGO to admin and zero the
        # account. amount=0 + close_remainder_to moves the entire balance (less fee)
        # to the admin in one step.
        itxn.Payment(
            receiver=self.admin,
            amount=0,
            close_remainder_to=self.admin,
            fee=0,
        ).submit()

        # The method runs under DeleteApplication, so the outer app call deletes the
        # application once this returns.
 
    # ──────────────────────────────────────────────────────────────────────
    # Read-only views (ABI getters for the frontend/backend).
    #
    # H-A: the self opt-in recovery hatch was removed. The escrow is the ASA
    # creator, so bootstrap's AssetConfig lands the full supply in the app account
    # and opts it in atomically — there is no reachable state where the app holds
    # Sprout but is not opted in, so no recovery method is needed.
    # ──────────────────────────────────────────────────────────────────────
 
    @abimethod(readonly=True)
    def get_principal(self) -> UInt64:
        return self._accounted_principal()
 
    @abimethod(readonly=True)
    def get_surplus(self) -> UInt64:
        # Mirrors harvest's floor exactly (principal + mbr + buffer) so the UI
        # never shows harvestable surplus that harvest would refuse.
        app_bal = Global.current_application_address.balance
        floor = self._harvest_floor()
        if app_bal <= floor:
            return UInt64(0)
        return app_bal - floor
 
    @abimethod(readonly=True)
    def get_state(self) -> UInt64:
        # Returns sprout_asa_id for convenience (0 if not bootstrapped).
        return self.sprout_asa_id