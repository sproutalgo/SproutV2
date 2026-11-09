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

# Max candidates per epoch (fixed ballot). Tally reads this many boxes — keep modest.
MAX_CANDIDATES = 20
# Target number of funded projects (ties can widen the actual winner set).
TARGET_WINNERS = 3
# Headroom left above MBR at payout, so inner payments can't drop the account below
# its minimum balance and the app keeps functioning. 0.1 ALGO.
POOL_BUFFER = 100_000


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
        assert self.phase == 0 or self.phase == 2, "previous epoch not finalized"
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
            v.staked = ArcU64(v.staked.native + amt)
            self.voters[Txn.sender] = v.copy()
            total: UInt64 = v.staked.native
            return total
        else:
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

        v.staked = ArcU64(v.staked.native - amount)

        # Decrement voted weight if the new staked balance is below it.
        if v.has_vote.native == 1 and v.voted_weight.native > v.staked.native:
            reduce = v.voted_weight.native - v.staked.native
            self._sub_weight(v.voted_candidate.native, reduce)
            v.voted_weight = ArcU64(v.staked.native)

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

        # Remove any existing contribution first (old candidate, old weight).
        if v.has_vote.native == 1:
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
        assert n > 0, "no candidates"

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
        never seize a voter's stake. It must also have NO boxes left — the account
        cannot close while boxes hold MBR. Voter boxes delete on full unstake; all
        candidate boxes delete at finalize. So before close: everyone unstakes
        (clears Sprout AND voter boxes), and the epoch is finalized (clears candidate
        boxes). candidate_count == 0 confirms candidates are cleared."""
        self._assert_admin()
        held = self._sprout().balance(Global.current_application_address)
        assert held == 0, "unstake all voter Sprout before closing"
        assert self.candidate_count == 0, "finalize the epoch first (clears candidate boxes)"

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
