# governance.py — Sprout Governance / Voting (App B)
#
# Algorand Python (Puya / ARC-4). On-chain staked voting over the funding pool
# harvested from the staking escrow. The contract holds the pool, counts the votes
# via RUNNING TALLIES, and pays the winners itself. The admin only picks which
# projects are on the ballot — it never touches funds or outcomes.
#
# DESIGN (final, simplified):
#   * One voter backs ONE candidate with their FULL staked weight (no split votes).
#   * Candidate boxes hold a RUNNING weight total. Votes/unstakes update them
#     incrementally, so there is NO end-of-period voter iteration — tally just reads
#     the (<= MAX_CANDIDATES) candidate boxes and sorts. O(1) per action, O(cands) tally.
#   * A vote SNAPSHOTS the voter's current staked balance into their candidate. Staking
#     more does NOT change the vote until the voter re-votes.
#   * Unstaking DECREMENTS the voter's voted weight to match (clamped at 0), so a
#     candidate can never hold more votes than real staked Sprout backing it.
#   * Days 1–14: vote / re-vote freely. Day 14: FREEZE — no vote changes after.
#     Unstaking is allowed any time (it decrements the candidate even after freeze).
#   * Candidates are locked at epoch open; none added/removed until tally+distribution.
#
# THE INVARIANT (the whole safety case):
#   candidate.weight == sum of voter.voted_weight over voters backing that candidate,
#   and every voter.voted_weight <= voter.staked. Every method preserves both by
#   adjusting one or two candidate boxes by an EXACT delta. This is the same
#   "add and subtract must agree exactly" property as the escrow's 1:1 deposit/withdraw.
#
# App B custodies Sprout (staked by voters) but does NOT create it — it is a HOLDER,
# so admin_close can opt out and close cleanly without manager rights.

from algopy import (
    ARC4Contract,
    Account,
    Asset,
    Global,
    Txn,
    UInt64,
    BoxMap,
    itxn,
    gtxn,
    subroutine,
)
from algopy.arc4 import abimethod, Address, Struct, UInt64 as ArcU64, UInt8, DynamicArray

# Max candidates per epoch (fixed ballot). finalize reads/deletes this many boxes
# in a single call, so it is bounded by the AVM's 8-box-reference-per-transaction
# limit (and the per-call opcode budget). 8 keeps finalize feasible in one pooled
# group and makes a partial-finalize box-orphan impossible. An off-chain nomination
# phase narrows the field to these 8 finalists before they reach this contract.
MAX_CANDIDATES = 8
# Target number of funded projects (ties can widen the actual winner set).
TARGET_WINNERS = 3
# Headroom left above MBR at payout, so inner payments can't drop the account below
# its minimum balance and the app keeps functioning. 0.1 ALGO.
POOL_BUFFER = 100_000

# H-A: minimum staked balance to hold a voter box. Each voter box the app stores
# costs ALGO MBR that is paid from the POOL, not by the voter (voting is free).
# Without a floor, anyone could open thousands of dust boxes (1 base unit each) that
# permanently ratchet up the app's MBR — locking pool ALGO that only the griefer can
# release. Requiring a real 1-ALGO-equivalent stake per box makes that attack cost
# the griefer meaningful LOCKED Sprout instead of dust, while costing legitimate
# voters nothing (they stake far more than this to have any voting weight). 1 Sprout
# base unit == 1 microAlgo (6-decimal 1:1), so 1 ALGO's worth = 1_000_000 base units.
# The floor applies to a box's RESULTING staked balance: a box must hold either 0
# (deleted) or >= MIN_STAKE — never a sub-threshold dust remainder.
MIN_STAKE = 1_000_000

# M-B: how long after tally_round the phase-0 recovery branch of
# admin_delete_candidate stays CLOSED. A normal finalize is expected promptly at
# tally_round; the recovery hatch must not race it, or the admin could delete a
# legitimate winner in the normal tally window. Opening the hatch only this many
# rounds AFTER tally_round means an honest finalize always has an uncontested first
# claim on the pool, and admin box-deletion in phase 0 is possible only once the
# epoch has been abandoned long enough that no honest finalize came.
#
# ⚠️ TESTING VALUE: set to 0 so recovery is reachable immediately at tally_round
# during LocalNet/testnet runs. BEFORE MAINNET, raise this to a real delay
# (~1 week at ~2.8s/round ≈ 216_000 rounds). At 0, the admin CAN delete a candidate
# the moment tally opens — the winner-censorship window M-B closes is reopened — so
# this value is safe only for testing.
RECOVERY_DELAY = 0


class VoterBox(Struct):
    staked: ArcU64            # Sprout currently staked in this app
    voted_candidate: ArcU64   # candidate id currently backed (0 = none)
    voted_weight: ArcU64      # weight currently applied to that candidate (<= staked)
    has_vote: UInt8           # 1 if voted_candidate is meaningful
    epoch: ArcU64             # epoch the vote belongs to


class CandidateBox(Struct):
    # Keyed by the directory_entry_id itself (no separate candidate_id) — one ID
    # end to end. The box key IS the directory entry id.
    payout_addr: Address
    weight: ArcU64            # RUNNING total weight backing this candidate


class Governance(ARC4Contract):
    def __init__(self) -> None:
        self.admin = Account()
        self.sprout_asa_id = UInt64(0)
        self.escrow_app = UInt64(0)             # App A, informational
        self.epoch_id = UInt64(0)
        self.vote_open = UInt64(0)              # round voting opens (day 1)
        self.vote_close = UInt64(0)             # round votes freeze (day 14)
        self.tally_round = UInt64(0)            # round tally may begin (day 28)
        self.candidate_count = UInt64(0)
        self.phase = UInt64(0)                  # 0 open/voting, 2 finalized
        self.bootstrapped = UInt64(0)

        self.voters = BoxMap(Account, VoterBox, key_prefix=b"v:")
        self.candidates = BoxMap(UInt64, CandidateBox, key_prefix=b"c:")

    # ── helpers ──────────────────────────────────────────────────────────────

    @subroutine
    def _assert_admin(self) -> None:
        assert Txn.sender == self.admin, "admin only"

    @subroutine
    def _sprout(self) -> Asset:
        return Asset(self.sprout_asa_id)

    @subroutine
    def _add_weight(self, cid: UInt64, delta: UInt64) -> None:
        c = self.candidates[cid].copy()
        c.weight = ArcU64(c.weight.native + delta)
        self.candidates[cid] = c.copy()

    @subroutine
    def _has_live_vote(self, has_vote: UInt64, epoch: UInt64) -> bool:
        # A vote is "live" — i.e. its candidate box still exists and holds this vote's
        # weight — only while ALL of these hold:
        #   * has_vote == 1, and
        #   * it was cast in the CURRENT epoch (epoch == epoch_id), and
        #   * the epoch is still OPEN (phase == 0).
        # The phase check is the fix for the post-finalize-same-epoch trap: finalize
        # deletes every candidate box and flips to phase 2 WITHOUT advancing epoch_id,
        # so between finalize and the next open_epoch a voter's box still reads
        # epoch == epoch_id with has_vote == 1 — yet its candidate box is already gone.
        # The earlier (epoch-only) check treated that as live and tried to decrement a
        # deleted candidate on unstake, reverting (box_get on a missing box) and
        # stranding the stake. Once finalized, the weight is already consumed and the
        # box no longer exists, so the vote must be treated as not-live: skip any
        # decrement. Cross-epoch stale votes (epoch != epoch_id) are caught as before.
        return has_vote == 1 and epoch == self.epoch_id and self.phase == 0

    @subroutine
    def _sub_weight(self, cid: UInt64, delta: UInt64) -> None:
        c = self.candidates[cid].copy()
        # Clamp defensively; by invariant delta <= c.weight always.
        w: UInt64 = c.weight.native
        new_w = UInt64(0)
        if w >= delta:
            new_w = w - delta
        c.weight = ArcU64(new_w)
        self.candidates[cid] = c.copy()

    # ── bootstrap / configuration ──────────────────────────────────────────────

    @abimethod()
    def bootstrap(self, admin: Address, sprout_asa_id: UInt64, escrow_app: UInt64) -> None:
        assert Txn.sender == Global.creator_address, "deployer only"
        assert self.bootstrapped == 0, "already bootstrapped"
        assert admin.native != Global.zero_address, "admin cannot be zero"
        assert sprout_asa_id != 0, "sprout asa required"

        self.admin = admin.native
        self.sprout_asa_id = sprout_asa_id
        self.escrow_app = escrow_app
        self.bootstrapped = UInt64(1)

        itxn.AssetTransfer(
            xfer_asset=sprout_asa_id,
            asset_receiver=Global.current_application_address,
            asset_amount=0,
            fee=0,
        ).submit()

    # ── epoch lifecycle (admin) ────────────────────────────────────────────────

    @abimethod()
    def open_epoch(self, vote_open: UInt64, vote_close: UInt64, tally_round: UInt64) -> UInt64:
        self._assert_admin()
        assert self.bootstrapped == 1, "not bootstrapped"
        # A new epoch may only open from one of three clean states:
        #   * the very first epoch (epoch_id == 0), or
        #   * a FINALIZED prior epoch (phase == 2), or
        #   * (A-1 recovery) a prior epoch abandoned long past tally
        #     (Global.round >= tally_round + RECOVERY_DELAY) whose candidate boxes
        #     have already been cleared via admin_delete_candidate — the deadlock cure
        #     for an epoch finalize could not process. The delay matches the recovery
        #     hatch so this branch can't open before the boxes are even clearable, and
        #     can't race an honest finalize. Without this third case, clearing a
        #     deadlocked epoch's boxes would leave phase == 0 and open_epoch would
        #     still refuse to advance, re-locking the pool.
        # Re-opening an already-LIVE epoch (phase 0 before tally_round) remains
        # forbidden — that is what once let candidate_count reset to 0 while old
        # candidate boxes physically lingered, orphaning them permanently.
        assert (
            self.epoch_id == 0
            or self.phase == 2
            or Global.round >= self.tally_round + RECOVERY_DELAY
        ), "finish or end the current epoch first"
        # Belt and suspenders: candidates must already be cleared. finalize sets this to
        # 0 and deletes every candidate box together (and admin_delete_candidate can
        # drive it to 0 in the recovery case), so this is the on-chain proof that no
        # candidate box survives into the new epoch — in every one of the three paths.
        assert self.candidate_count == 0, "candidates not cleared (finalize first)"
        # M-3: vote_open must be in the FUTURE. register_candidate locks at
        # Global.round < vote_open, so a past (or current) vote_open would slam the
        # candidate-registration window shut the instant the epoch opens — no
        # candidate could ever be added, bricking the epoch into an empty ballot.
        assert vote_open > Global.round, "vote_open must be in the future"
        assert vote_open < vote_close, "vote_close must follow vote_open"
        assert vote_close < tally_round, "tally must follow vote_close"

        self.epoch_id += 1
        self.vote_open = vote_open
        self.vote_close = vote_close
        self.tally_round = tally_round
        self.candidate_count = UInt64(0)
        self.phase = UInt64(0)

        # NOTE: the pool is NOT snapshotted here. Harvested staking rewards flow into
        # this account throughout the epoch, so the amount to distribute is computed
        # LIVE at finalize (balance - MBR - buffer). Snapshotting at open would
        # exclude every reward that arrives during the voting period — unfair, and
        # it would push a whole month's yield into the next epoch.
        return self.epoch_id

    @abimethod()
    def register_candidate(self, directory_entry_id: UInt64, payout_addr: Address) -> None:
        """Admit a candidate (admin only). The directory_entry_id IS the candidate
        key — one ID end to end. Locked once voting is open — candidates are fixed
        for the epoch (no additions/removals until finalize)."""
        self._assert_admin()
        assert self.epoch_id > 0, "no epoch"
        assert self.phase == 0, "voting not open"
        assert Global.round < self.vote_open, "candidates lock at voting open"
        assert self.candidate_count < MAX_CANDIDATES, "candidate limit reached"
        assert directory_entry_id != 0, "directory entry id must be nonzero"
        assert directory_entry_id not in self.candidates, "candidate exists"
        assert payout_addr.native != Global.zero_address, "payout addr required"

        self.candidates[directory_entry_id] = CandidateBox(
            payout_addr=payout_addr,
            weight=ArcU64(0),
        )
        self.candidate_count += 1

    @abimethod()
    def admin_delete_candidate(self, candidate_id: UInt64) -> UInt64:
        """ESCAPE HATCH (admin only): delete one candidate box by id, unconditionally.

        This is the guaranteed cure for any candidate_count / box-set desync, so the
        app can ALWAYS be driven to zero boxes and therefore ALWAYS deleted/closed —
        no ALGO is ever trappable behind an orphaned candidate box.

        ALLOWED ONLY ONCE THE EPOCH IS OVER: either finalize has run (phase == 2), OR
        the tally round has arrived (Global.round >= tally_round) even if finalize has
        not yet succeeded. The second case (A-1) is the deadlock cure: if finalize ever
        can't run — e.g. a candidate_count/box-set desync makes the length check
        unsatisfiable — the app would otherwise be stuck in phase 0 with boxes that
        finalize can't delete and this hatch (phase-2-only) couldn't either, locking
        the pool forever. Permitting direct deletion from tally_round onward means the
        boxes are ALWAYS clearable, so finalize is never the sole path out.

        It stays inert during the LIVE epoch (before tally_round), granting the admin
        NO mid-voting power: it cannot censor a not-yet-voted candidate, grief a project
        by front-running its first vote, or alter the ballot the public saw at
        registration. Since voting freezes at vote_close < tally_round, deletion only
        ever becomes possible after all voting has ended — the anti-censorship guarantee
        is fully preserved. A mistakenly-registered candidate simply sits at weight 0
        through voting, is ignored by finalize, and is cleaned up afterward.

        Returns the new candidate_count. The count floors at 0 even if it had drifted,
        so it can never underflow. Pair with a repeated off-chain enumeration of the
        app's boxes to clear every lingering candidate before admin_close."""
        self._assert_admin()
        # Normal cleanup: after a successful finalize (phase == 2).
        # M-B recovery: in phase 0, only once the epoch has been ABANDONED — i.e.
        # RECOVERY_DELAY rounds past tally_round with no finalize. The delay keeps the
        # hatch from racing an honest finalize (which is expected promptly at
        # tally_round), so the admin cannot use it to censor a legitimate winner in the
        # normal tally window — it opens only after any honest finalize would already
        # have run.
        assert (
            self.phase == 2
            or Global.round >= self.tally_round + RECOVERY_DELAY
        ), "cleanup after finalize, or recovery only long after tally"
        assert candidate_id in self.candidates, "no such candidate box"

        del self.candidates[candidate_id]
        # Floor the counter at 0 — if it had drifted below the real box set, deleting a
        # box must not underflow it.
        if self.candidate_count > 0:
            self.candidate_count -= 1
        return self.candidate_count

    # ── staking ─────────────────────────────────────────────────────────────────

    @abimethod()
    def stake(self, axfer: gtxn.AssetTransferTransaction) -> UInt64:
        """Group: [AssetTransfer Sprout -> app][this call]. Adds to staked balance.
        Does NOT change any vote — the voter must re-vote to apply the new balance."""
        assert self.sprout_asa_id != 0, "not bootstrapped"
        assert axfer.xfer_asset == self._sprout(), "wrong asset"
        assert axfer.asset_receiver == Global.current_application_address, "stake into app"
        assert axfer.sender == Txn.sender, "sender must be caller"
        amt = axfer.asset_amount
        assert amt > 0, "zero stake"

        if Txn.sender in self.voters:
            v = self.voters[Txn.sender].copy()
            new_total: UInt64 = v.staked.native + amt
            # H-A: resulting balance must clear the floor. An existing box already
            # cleared it, so a top-up of any size keeps it clear — but assert anyway
            # so the invariant holds uniformly and survives future edits.
            assert new_total >= MIN_STAKE, "stake below minimum"
            v.staked = ArcU64(new_total)
            self.voters[Txn.sender] = v.copy()
            return new_total
        else:
            # H-A: a NEW voter box's opening stake must meet the floor, so no dust box
            # can ever be created to grief the pool's MBR.
            assert amt >= MIN_STAKE, "stake below minimum (1 ALGO equivalent)"
            self.voters[Txn.sender] = VoterBox(
                staked=ArcU64(amt),
                voted_candidate=ArcU64(0),
                voted_weight=ArcU64(0),
                has_vote=UInt8(0),
                epoch=ArcU64(self.epoch_id),
            )
            return amt

    @abimethod()
    def unstake(self, amount: UInt64) -> UInt64:
        """Return `amount` Sprout. Allowed any time (incl. after freeze). If the voter
        has a vote, DECREMENT their voted weight (and the candidate) to match, so a
        candidate never holds more votes than real staked Sprout backing it."""
        assert Txn.sender in self.voters, "nothing staked"
        v = self.voters[Txn.sender].copy()
        assert amount > 0, "zero unstake"
        assert v.staked.native >= amount, "exceeds staked"

        new_staked: UInt64 = v.staked.native - amount
        # H-A: the box must end at 0 (fully exited, box deleted below) or at/above the
        # floor — never a sub-threshold dust remainder, which would leave a cheap box
        # permanently inflating the pool's MBR. Full withdrawal is ALWAYS allowed (the
        # voter can pass the exact staked amount to exit); only a dusty leftover is
        # forbidden. To go below the floor, unstake everything.
        assert new_staked == 0 or new_staked >= MIN_STAKE, "unstake to zero or leave >= minimum"

        v.staked = ArcU64(new_staked)

        # Decrement voted weight if the new staked balance is below it — but ONLY for a
        # live vote in the current epoch. A vote left over from a finalized epoch points
        # at a deleted candidate box; decrementing it would revert (box_get on a missing
        # box) and strand the stake. For a stale vote, skip the decrement and clear it so
        # the voter starts the new epoch clean.
        if self._has_live_vote(v.has_vote.native, v.epoch.native):
            if v.voted_weight.native > v.staked.native:
                reduce = v.voted_weight.native - v.staked.native
                self._sub_weight(v.voted_candidate.native, reduce)
                v.voted_weight = ArcU64(v.staked.native)
        elif v.has_vote.native == 1:
            # Not-live vote — either from a previous epoch, or from THIS epoch after it
            # was finalized (phase 2, candidate boxes already deleted). Its candidate box
            # is gone, so clear the vote WITHOUT touching any candidate. This is what lets
            # a voter always reclaim stake after finalize, instead of reverting on a
            # box_get for the deleted candidate.
            v.has_vote = UInt8(0)
            v.voted_weight = ArcU64(0)
            v.voted_candidate = ArcU64(0)

        remaining: UInt64 = v.staked.native

        # Return the Sprout first.
        itxn.AssetTransfer(
            xfer_asset=self.sprout_asa_id,
            asset_receiver=Txn.sender,
            asset_amount=amount,
            fee=0,
        ).submit()

        # Box hygiene: if the voter is now fully unstaked, delete their box so its
        # MBR is released (and the app can eventually close). Any decrement to their
        # candidate already happened above. Otherwise persist the updated box.
        if remaining == 0:
            del self.voters[Txn.sender]
        else:
            self.voters[Txn.sender] = v.copy()

        return remaining

    # ── voting ────────────────────────────────────────────────────────────────

    @abimethod()
    def vote(self, candidate_id: UInt64) -> UInt64:
        """Back `candidate_id` with your FULL current staked balance. Window-only
        (days 1–14). Snapshots your staked balance; re-vote to update after staking
        more. Changing candidate moves your weight from the old to the new. Returns
        the weight applied."""
        assert self.epoch_id > 0, "no epoch"
        assert self.phase == 0, "voting closed"
        assert Global.round >= self.vote_open, "voting not open yet"
        assert Global.round < self.vote_close, "voting window closed"      # the freeze
        assert candidate_id in self.candidates, "unknown candidate"
        assert Txn.sender in self.voters, "stake before voting"

        v = self.voters[Txn.sender].copy()
        new_weight: UInt64 = v.staked.native
        assert new_weight > 0, "nothing staked"

        # Remove any existing contribution first (old candidate, old weight) — but only
        # if it's a live vote in THIS epoch. A vote carried over from a finalized epoch
        # points at a deleted candidate box; subtracting it would revert. Re-voting in a
        # new epoch simply overwrites the stale vote.
        if self._has_live_vote(v.has_vote.native, v.epoch.native):
            self._sub_weight(v.voted_candidate.native, v.voted_weight.native)

        # Apply the full current stake to the chosen candidate.
        self._add_weight(candidate_id, new_weight)

        v.voted_candidate = ArcU64(candidate_id)
        v.voted_weight = ArcU64(new_weight)
        v.has_vote = UInt8(1)
        v.epoch = ArcU64(self.epoch_id)
        self.voters[Txn.sender] = v.copy()
        return new_weight

    # ── tally — O(candidates), no voter iteration ──────────────────────────────

    @abimethod()
    def finalize(self, ranked_candidate_ids: DynamicArray[ArcU64]) -> UInt64:
        """Permissionless, after tally_round. Caller submits all candidate ids sorted
        by weight DESC (computed off-chain from the on-chain candidate boxes). The
        contract VERIFIES the ordering, derives the winner set (top ~3, ties widen),
        and pays each winner an equal share. Returns the number of winners paid.

        Trustless: a dishonest ordering is rejected — the contract re-checks each
        listed candidate's weight is >= the next and derives winners itself."""
        assert self.phase == 0, "already finalized"
        assert Global.round >= self.tally_round, "tally not open"
        assert ranked_candidate_ids.length == self.candidate_count, "must list all candidates"

        n = ranked_candidate_ids.length

        # A-2: an epoch with NO candidates (none registered, or a quiet epoch) is a
        # VALID finalize, not a revert. The old `assert n > 0` wedged the contract:
        # with zero candidates, finalize reverted, but open_epoch needs phase == 2 to
        # start the next epoch — so the app could neither finalize nor advance, and
        # the pool sat locked. Here, n == 0 pays nobody, deletes nothing, carries the
        # pool forward, and flips to phase 2 so the next epoch can open. Mirrors the
        # zero-WINNERS carry-forward already handled below.
        if n == 0:
            self.candidate_count = UInt64(0)
            self.phase = UInt64(2)
            return UInt64(0)

        # 1) Verify the submitted ordering is descending by weight.
        prev_w = UInt64(0)
        i = UInt64(0)
        while i < n:
            cid = ranked_candidate_ids[i].native
            assert cid in self.candidates, "unknown candidate in ranking"
            w = self.candidates[cid].weight.native
            if i > 0:
                assert w <= prev_w, "ranking not descending"
            prev_w = w
            i += 1

        # 2) Cutoff = weight at the TARGET_WINNERS-th place (or last if fewer). Winners
        #    = all candidates with weight >= cutoff AND > 0 (tie-widening falls out).
        cut_index = UInt64(TARGET_WINNERS - 1)
        if n < TARGET_WINNERS:
            cut_index = n - 1
        cut_cid: UInt64 = ranked_candidate_ids[cut_index].native
        cutoff: UInt64 = self.candidates[cut_cid].weight.native

        winners = UInt64(0)
        i = UInt64(0)
        while i < n:
            w = self.candidates[ranked_candidate_ids[i].native].weight.native
            if w >= cutoff and w > 0:
                winners += 1
            i += 1
        # NOTE: winners may be 0 (nobody voted). That is a VALID finalize — it pays
        # nobody and the pool carries forward — NOT a revert. Reverting here would
        # leave the candidate boxes undeletable and permanently block admin_close
        # (the "register candidates, nobody votes" lock). So we proceed and only
        # skip the payout when there are no winners.

        # 3) Compute the pool LIVE, now, at tally — = balance - MBR - buffer. This
        #    captures all staking rewards that flowed in during the epoch. A small
        #    buffer stays above MBR so the account keeps functioning and the inner
        #    payments can't drive it below min balance.
        bal = Global.current_application_address.balance
        mbr = Global.current_application_address.min_balance
        floor = mbr + POOL_BUFFER
        pool = UInt64(0)
        if bal > floor:
            pool = bal - floor

        # Equal split among winners. Dust (pool mod winners) stays and carries over.
        # Guard the division: winners can be 0, in which case there is no payout.
        if winners > 0:
            share = pool // winners
            if share > 0:
                i = UInt64(0)
                while i < n:
                    cid = ranked_candidate_ids[i].native
                    w = self.candidates[cid].weight.native
                    if w >= cutoff and w > 0:
                        c = self.candidates[cid].copy()
                        itxn.Payment(
                            receiver=c.payout_addr.native,
                            amount=share,
                            fee=0,
                        ).submit()
                    i += 1

        # Box hygiene: the epoch is over, so delete every candidate box to release
        # its MBR. ranked_candidate_ids lists all candidates (asserted == count), so
        # this clears them all. The app can then close once voter boxes are gone too.
        j = UInt64(0)
        while j < n:
            del self.candidates[ranked_candidate_ids[j].native]
            j += 1
        self.candidate_count = UInt64(0)

        self.phase = UInt64(2)
        return winners

    # ── discard an unbootstrapped shell (creator-only) ─────────────────────────

    @abimethod(allow_actions=["DeleteApplication"])
    def discard_unbootstrapped(self) -> None:
        """Delete an app that was CREATED but never bootstrapped (creator-only).

        Guards the "created but bootstrap failed -> stuck forever" trap: before
        bootstrap, admin is the zero address, so admin_close's admin check can never
        pass and the app's ~1 ALGO funding would be stranded. This lets the original
        creator recover it. Strictly limited to the pre-bootstrap state (bootstrapped
        == 0) so it can NEVER run on a live governance app holding voter stake. Also
        safe on the ASA front: an unbootstrapped app never opted into Sprout, so there
        is no holding to clear — just close the ALGO account to the creator.
        """
        assert Txn.sender == Global.creator_address, "creator only"
        assert self.bootstrapped == 0, "already bootstrapped: use admin_close"

        itxn.Payment(
            receiver=Global.creator_address,
            amount=0,
            close_remainder_to=Global.creator_address,
            fee=0,
        ).submit()

    # ── admin close / recover (testing teardown) ───────────────────────────────

    @abimethod(allow_actions=["DeleteApplication"])
    def admin_close(self) -> None:
        """Delete the app and recover funds (admin only). App B holds (not creates)
        the Sprout ASA, so it opts out and closes cleanly — no manager needed.

        SAFETY GATE: the app must hold ZERO Sprout (all voters unstaked) so close can
        never seize a voter's stake. The protocol also refuses to delete an app while
        ANY box still exists, and deleting with boxes present would permanently strand
        their MBR — so every candidate and voter box must be gone first. Voter boxes
        delete on full unstake; candidate boxes delete at finalize, or individually via
        admin_delete_candidate (the escape hatch). candidate_count == 0 confirms the
        candidate set is cleared; if the counter ever disagrees with the real boxes,
        admin_delete_candidate can always drive both to zero, so the app — and its
        ALGO — can never be trapped. Operationally: unstake everyone, finalize (or
        delete each candidate), confirm the app shows zero boxes off-chain, then close."""
        self._assert_admin()
        held = self._sprout().balance(Global.current_application_address)
        assert held == 0, "unstake all voter Sprout before closing"
        assert self.candidate_count == 0, "clear candidates first (finalize or admin_delete_candidate)"

        itxn.AssetTransfer(
            xfer_asset=self.sprout_asa_id,
            asset_receiver=self.admin,
            asset_amount=0,
            asset_close_to=self.admin,
            fee=0,
        ).submit()
        itxn.Payment(
            receiver=self.admin,
            amount=0,
            close_remainder_to=self.admin,
            fee=0,
        ).submit()

    # ── read-only views ─────────────────────────────────────────────────────────

    @abimethod(readonly=True)
    def get_epoch(self) -> UInt64:
        return self.epoch_id

    @abimethod(readonly=True)
    def get_pool(self) -> UInt64:
        # Live distributable pool = balance - MBR - buffer (what finalize would pay).
        bal = Global.current_application_address.balance
        mbr = Global.current_application_address.min_balance
        floor = mbr + POOL_BUFFER
        if bal <= floor:
            return UInt64(0)
        p: UInt64 = bal - floor
        return p

    @abimethod(readonly=True)
    def get_staked(self, who: Address) -> UInt64:
        if who.native in self.voters:
            s: UInt64 = self.voters[who.native].staked.native
            return s
        return UInt64(0)

    @abimethod(readonly=True)
    def get_candidate_weight(self, candidate_id: UInt64) -> UInt64:
        if candidate_id in self.candidates:
            w: UInt64 = self.candidates[candidate_id].weight.native
            return w
        return UInt64(0)
