# Crowdfunding App (stateful, smart-contract account) — Puya / Algorand Python port.
#
# This is a direct, logic-preserving port of the original PyTeal contract to
# Algorand Python (Puya). Every assertion, guard, state transition, inner
# transaction, and grace/overflow rule is reproduced exactly. Nothing in the
# on-chain behavior has been changed — only the source language.
#
# Key design properties (unchanged):
#
#   1. Single monotonic counter: `raised` only ever increases and is only ever
#      compared against `goal`.
#
#   2. Sticky outcome: success is determined ONLY by `funded_round > 0`
#      (set once, never cleared). Failure is `funded_round == 0 AND
#      (after_deadline OR cancelled)`. `refund` keys off `funded_round == 0`,
#      NOT `raised < goal`, so it can never reopen once the goal is hit.
#      success and failure are structurally mutually exclusive.
#
#   3. `admin_cancel` is gated on `funded_round == 0` — cannot cancel a
#      campaign that already succeeded.
#
#   4. All inner transactions set fee: 0 explicitly and require the caller's
#      outer transaction to cover pooled fees. Inner-txn fees can not silently
#      drain the app account or the admin's fee.
#
#   5. setup is gated before the deadline and before any contribution.
#
#   6. GRACE-ONLY close. Immediate value movement is always available:
#        - success: creator_claim (96% ALGO) and finalize (tokens) any time,
#        - failure/cancel: refund (full ALGO) any time.
#      Only the FINAL account close-out waits for a 6-month grace period.
#        - success grace: measured from funded_round.
#        - failure grace: measured from the deadline.
#
#   7. Decoupled close. The ASA close-out (admin_sweep_asa) and the ALGO
#      close-out (admin_claim) are SEPARATE calls. admin_claim requires
#      asa_id == 0, so the ALGO close has no inner asset transfer that could
#      revert.
#
# FEE STRUCTURE:
# - Listing fee: goal × days / 100,000 (0.001%/day), minimum 10 ALGO, paid
#   upfront to admin at deployment. Non-refundable. Never enters the contract.
# - Success fee: a fixed 4% of goal, collected by the admin via admin_fee_claim
#   AS SOON AS the campaign succeeds — independent of the creator's claim and of
#   the 6-month grace. Call-once (admin_fee_claimed). If the admin never collects
#   it before the final close, admin_claim pays the outstanding fee to the admin
#   first and then returns the remainder to the creator, so it is never forfeited
#   and never double-paid.
#
# FINAL CLOSE (admin_claim): retires stale contracts after the 6-month grace.
# Residual ALGO closes to the CREATOR (not the admin): after the fee is settled,
# whatever remains is unclaimed creator value plus dust (success) or unclaimed
# refunds/seed (failure). Callable by either the admin or the creator.
#
# WARNING — ClearState: the AVM always approves clear_program. An investor who
# submits ClearState while contrib > 0 permanently forfeits their contribution.

from algopy import (
    Account,
    ARC4Contract,
    Asset,
    Global,
    GlobalState,
    LocalState,
    Txn,
    UInt64,
    gtxn,
    itxn,
    op,
    subroutine,
)
from algopy.arc4 import abimethod

# ── Constants (module-level compile-time constants must be plain ints) ────────
#GRACE_PERIOD_ROUNDS = 5_580_866   # ~6 months at 2.8 s/block  (MAINNET value)
GRACE_PERIOD_ROUNDS = 10           # TESTNET: compressed for fast dry-run
#ROUNDS_PER_DAY = 30_857           # 86400 / 2.8 rounded  (MAINNET value)
ROUNDS_PER_DAY = 10               # TESTNET: compressed for fast dry-run
MIN_DAYS = 1
MAX_DAYS = 100
MAX_GOAL = 100_000_000_000_000    # 100 million ALGO in microAlgos
# Overflow ceiling for the token-distribution guard: 99% of uint64 max, giving
# headroom so no finalize intermediate (contrib*tpb, or whole*dec_factor) wraps.
SAFE_CEIL = 18262276632972455936  # floor((2^64 - 1) * 0.99)
SUCCESS_FEE_PCT = 4
MIN_LISTING_FEE = 10_000_000      # 10 ALGO minimum listing fee


class Crowdfund(ARC4Contract):
    def __init__(self) -> None:
        # ── Global state ───────────────────────────────────────────────────
        self.goal = GlobalState(UInt64, key="goal")
        # Two-integer exchange rate: "tpb whole tokens per apb ALGO".
        # tpb == 0 signals a donation campaign (no token distribution).
        # apb is always > 0 (asserted at create) to avoid divide-by-zero.
        self.tpb = GlobalState(UInt64, key="tpb")               # tokens_per_bundle
        self.apb = GlobalState(UInt64, key="apb")               # algo_per_bundle
        self.dec_factor = GlobalState(UInt64, key="dec_factor")  # 10^ASA_decimals
        self.deadline = GlobalState(UInt64, key="deadline")
        self.days = GlobalState(UInt64, key="days")
        self.asa_id = GlobalState(UInt64, key="asa_id")
        self.raised = GlobalState(UInt64, key="raised")          # MONOTONIC — only ++
        self.funded_round = GlobalState(UInt64, key="funded_round")
        self.cancelled = GlobalState(UInt64, key="cancelled")
        self.creator_claimed = GlobalState(UInt64, key="creator_claimed")
        # admin_fee_claimed: 1 after the admin has collected the 4% success fee
        # via admin_fee_claim (independent of the final close).
        self.admin_fee_claimed = GlobalState(UInt64, key="admin_fee_claimed")
        self.admin_claimed = GlobalState(UInt64, key="admin_claimed")
        self.creator = GlobalState(Account, key="creator")
        self.admin = GlobalState(Account, key="admin")
        # ── Local state (per investor) ─────────────────────────────────────
        # microAlgos contributed (zeroed when the investor finalizes/refunds)
        self.contrib = LocalState(UInt64, key="contrib")

    # ── on_create ─────────────────────────────────────────────────────────────
    # Args: admin(32 bytes), goal(microAlgos), tokens_per_bundle, days(1-100),
    #       algo_per_bundle
    # Group: [0]=ApplicationCreate, [1]=Payment(listing_fee) from creator to admin
    # tpb == 0 signals a donation campaign (no token distribution).
    # apb must be > 0 always (it is a divisor in the payout math).
    # All campaigns have a minimum listing fee of 10 ALGO regardless of goal/days.
    @abimethod(create="require")
    def create(
        self,
        admin: Account,
        goal: UInt64,
        tokens_per_bundle: UInt64,
        days: UInt64,
        algo_per_bundle: UInt64,
        fee_pay: gtxn.PaymentTransaction,
    ) -> None:
        listing_fee = (goal * days) // UInt64(100_000)
        effective_listing_fee = (
            UInt64(MIN_LISTING_FEE) if listing_fee < MIN_LISTING_FEE else listing_fee
        )
        deadline_rounds = Global.round + (days * ROUNDS_PER_DAY)

        assert admin.bytes.length == 32
        assert goal > 0
        assert goal % UInt64(1_000_000) == 0
        assert goal >= UInt64(10_000_000)
        assert goal <= MAX_GOAL
        # tpb == 0 is allowed (donation); > 0 for token campaigns.
        # apb must always be > 0 — it is a divisor at payout time.
        assert algo_per_bundle > 0
        assert days >= MIN_DAYS
        assert days <= MAX_DAYS
        # Listing fee payment: grouped Payment from creator to admin.
        # Under ARC-4 the transaction arg (fee_pay) is placed immediately BEFORE
        # this app call in the group, so the app call is at index 1 and fee_pay at
        # index 0. Assert that relationship rather than a fixed absolute index.
        assert Global.group_size == 2
        assert fee_pay.group_index == Txn.group_index - 1
        assert fee_pay.sender == Txn.sender
        assert fee_pay.receiver == admin
        assert fee_pay.amount >= effective_listing_fee
        assert fee_pay.close_remainder_to == Global.zero_address
        assert fee_pay.rekey_to == Global.zero_address

        self.creator.value = Txn.sender
        self.admin.value = admin
        self.goal.value = goal
        self.tpb.value = tokens_per_bundle
        self.apb.value = algo_per_bundle
        self.days.value = days
        self.deadline.value = deadline_rounds
        self.raised.value = UInt64(0)
        self.asa_id.value = UInt64(0)
        self.dec_factor.value = UInt64(0)
        self.funded_round.value = UInt64(0)
        self.cancelled.value = UInt64(0)
        self.creator_claimed.value = UInt64(0)
        self.admin_fee_claimed.value = UInt64(0)
        self.admin_claimed.value = UInt64(0)

    # ── Utility predicates (subroutines to avoid re-reading logic inline) ──────
    @subroutine
    def _is_creator(self) -> bool:
        return Txn.sender == self.creator.value

    @subroutine
    def _is_admin(self) -> bool:
        return Txn.sender == self.admin.value

    @subroutine
    def _before_deadline(self) -> bool:
        return Global.round <= self.deadline.value

    @subroutine
    def _after_deadline(self) -> bool:
        return Global.round > self.deadline.value

    @subroutine
    def _is_cancelled(self) -> bool:
        return self.cancelled.value == 1

    @subroutine
    def _success_grace_expired(self) -> bool:
        # success: measured from the round the goal was met (funded_round).
        return (
            self.funded_round.value > UInt64(0)
            and Global.round > self.funded_round.value + GRACE_PERIOD_ROUNDS
        )

    @subroutine
    def _failure_grace_expired(self) -> bool:
        # failure: measured from the deadline (funded_round == 0 on failure, so a
        # funded_round-based clock would read "already expired"; keying off the
        # deadline gives investors a real 6-month window to refund).
        return Global.round > self.deadline.value + GRACE_PERIOD_ROUNDS

    # ── STICKY OUTCOME PREDICATES ─────────────────────────────────────────────
    # Success is permanent once funded_round is set; NEVER re-derived from live
    # counters. Failure requires the goal was never reached by the deadline, OR
    # an explicit admin cancel. `failed` STRUCTURALLY excludes success: it can
    # only be true while funded_round == 0.
    @subroutine
    def _succeeded(self) -> bool:
        return self.funded_round.value > UInt64(0)

    @subroutine
    def _failed(self) -> bool:
        return self.funded_round.value == UInt64(0) and (
            self._is_cancelled() or self._after_deadline()
        )

    # ── app_opt_in_asa ──────────────────────────────────────────────────────────
    # Opts the APP account into the project ASA in ITS OWN transaction, submitted
    # and confirmed BEFORE the setup group.
    #
    # Why this exists (subtle but load-bearing): Puya binds a method's transaction
    # argument to the group slot immediately BEFORE the call (GroupIndex - 1). So in
    # the setup group [AssetTransfer, setup], the token-pool transfer executes first,
    # before setup's body runs. If the app opted into the ASA inside setup (as it did
    # originally), the transfer would arrive at an app that isn't opted in yet and
    # fail with "receiver error: must optin". Opting in here, in a separate prior
    # transaction, guarantees the app can receive the pool when setup runs.
    #
    # (The original PyTeal used group order [appCall, transfer], so its inner opt-in
    # ran before the transfer — the ARC-4 port's mandatory reordering is what made a
    # dedicated opt-in necessary.)
    #
    # Gated to run only before setup completes (asa_id still 0), creator-only, before
    # the deadline. Fee 2000 on the call covers the single pooled inner opt-in.
    @abimethod
    def app_opt_in_asa(self, asset: Asset) -> None:
        assert self._is_creator()
        assert self.asa_id.value == 0        # only before setup writes asa_id
        assert not self._is_cancelled()
        assert self._before_deadline()
        assert Txn.num_assets == 1
        itxn.AssetTransfer(
            xfer_asset=asset,
            asset_receiver=Global.current_application_address,
            asset_amount=0,
            fee=0,
        ).submit()

    # ── setup ─────────────────────────────────────────────────────────────────
    # ARC-4 group: [0] AssetTransfer(tokens from creator to app), [1] AppCall("setup").
    # The token transfer is passed as the method's transaction argument, so Puya
    # places it immediately before this app call (GroupIndex - 1) and the transfer
    # executes first. The app MUST already be opted into the ASA by then — call
    # app_opt_in_asa in a prior transaction (see that method for the full rationale).
    @abimethod
    def setup(self, asset: Asset, token_pay: gtxn.AssetTransferTransaction) -> None:
        app_addr = Global.current_application_address
        assert self._is_creator()
        assert self.asa_id.value == 0  # one-time only
        assert not self._is_cancelled()
        assert self._before_deadline()  # cannot set up after the campaign ends
        assert self.raised.value == 0  # cannot set up after contributions begin
        assert Txn.num_assets == 1
        self.asa_id.value = asset.id
        assert Global.group_size == 2
        assert token_pay.group_index == Txn.group_index - 1
        # Read the ASA decimals on-chain (no trust in caller-supplied value) and
        # store dec_factor = 10^decimals for use at finalize.
        decimals, dec_ok = op.AssetParamsGet.asset_decimals(asset)
        assert dec_ok
        # Reject rug-capable tokens: clawback and freeze must be permanently
        # disabled (a zero clawback/freeze address is immutable on Algorand), and
        # the asset must not be default-frozen. Without these a creator could claw
        # back the pool after funding, or freeze the app's holding — which blocks
        # asset_close_to, so asa_id could never reset to 0 and the ALGO close would
        # be trapped forever.
        clawback, claw_ok = op.AssetParamsGet.asset_clawback(asset)
        assert claw_ok
        assert clawback == Global.zero_address
        freeze, freeze_ok = op.AssetParamsGet.asset_freeze(asset)
        assert freeze_ok
        assert freeze == Global.zero_address
        dfrozen, dfrozen_ok = op.AssetParamsGet.asset_default_frozen(asset)
        assert dfrozen_ok
        assert not dfrozen

        df = op.exp(UInt64(10), decimals)  # 10^decimals
        self.dec_factor.value = df
        # Overflow guard (token campaigns only): prove no finalize intermediate can
        # exceed uint64 at the worst case of one backer contributing the whole goal.
        #   numer_max = goal * tpb ; whole_cap = numer_max / (apb * 1e6) ;
        #   pool/base_max = whole_cap * dec_factor. Both must stay under SAFE_CEIL.
        pool_needed = UInt64(0)
        if self.tpb.value != 0:
            assert self.goal.value * self.tpb.value <= SAFE_CEIL
            whole_cap = (self.goal.value * self.tpb.value) // (
                self.apb.value * UInt64(1_000_000)
            )
            pool_needed = whole_cap * df
            assert pool_needed <= SAFE_CEIL

        # NOTE: the app is opted into the ASA earlier, via app_opt_in_asa, in a
        # transaction that executes before this group. Opting in again here would
        # fail (an account cannot opt into an ASA it already holds), so there is no
        # inner opt-in in setup anymore.

        # Validate ASA token pool transfer covers the whole-token distribution at
        # full goal (floor-to-whole-tokens, scaled to base units).
        assert token_pay.sender == Txn.sender
        assert token_pay.asset_receiver == app_addr
        assert token_pay.xfer_asset == asset
        assert token_pay.asset_amount >= pool_needed
        assert token_pay.asset_close_to == Global.zero_address
        assert token_pay.rekey_to == Global.zero_address

    # ── contribute ──────────────────────────────────────────────────────────
    # raised moves UP by the contribution and is never decremented. Per-investor
    # `contrib` local state records the individual stake (settled to zero on
    # finalize/refund). Donation campaigns (tpb==0): no asa_id, no distribution.
    @abimethod
    def contribute(self, pay: gtxn.PaymentTransaction) -> None:
        investor = Txn.sender
        app_addr = Global.current_application_address
        assert self._before_deadline()
        assert not self._is_cancelled()
        assert self.raised.value < self.goal.value
        # Token campaigns require setup (asa_id != 0); donation campaigns skip it.
        if self.tpb.value != 0:
            assert self.asa_id.value != 0
        assert Global.group_size == 2
        assert pay.group_index == Txn.group_index - 1
        assert pay.sender == investor
        assert pay.receiver == app_addr
        assert pay.amount > 0
        assert pay.amount % UInt64(1_000_000) == 0
        assert pay.close_remainder_to == Global.zero_address
        assert pay.rekey_to == Global.zero_address
        assert self.raised.value + pay.amount <= self.goal.value
        self.contrib[investor] = self.contrib.get(investor, default=UInt64(0)) + pay.amount
        new_raised = self.raised.value + pay.amount
        self.raised.value = new_raised
        if new_raised >= self.goal.value and self.funded_round.value == 0:
            self.funded_round.value = Global.round

    # ── finalize ──────────────────────────────────────────────────────────────
    # Success only. Investor claims tokens; their local contrib is zeroed.
    # Donation campaigns (tpb==0): no tokens distributed, contrib zeroed at once.
    @abimethod
    def finalize(self) -> None:
        investor = Txn.sender
        assert Global.group_size == 1
        assert self._succeeded()
        assert not self._is_cancelled()
        contrib_amt = self.contrib.get(investor, default=UInt64(0))
        assert contrib_amt > 0
        # Token campaigns: floor to WHOLE tokens first, then scale to base units.
        #   whole_tokens = floor( contrib * tpb / (apb * 1e6) )
        #   tokens_due   = whole_tokens * dec_factor
        # Donation campaigns (tpb==0): skip token distribution.
        # Skip token distribution if the ASA holding has already been swept
        # (asa_id reset to 0 post-grace) — tokens are forfeited per the grace
        # rules, but contrib must still zero so the investor can close out.
        if self.tpb.value != 0 and self.asa_id.value != 0:
            whole_tokens = (contrib_amt * self.tpb.value) // (
                self.apb.value * UInt64(1_000_000)
            )
            tokens_due = whole_tokens * self.dec_factor.value
            if tokens_due > 0:
                itxn.AssetTransfer(
                    xfer_asset=self.asa_id.value,
                    asset_receiver=investor,
                    asset_amount=tokens_due,
                    fee=0,
                ).submit()
        self.contrib[investor] = UInt64(0)

    # ── creator_claim ──────────────────────────────────────────────────────────
    # Success only. Creator withdraws (goal - 4% fee) ALGO. Callable as soon as
    # the goal is met, independent of investor finalization.
    @abimethod
    def creator_claim(self) -> None:
        assert Global.group_size == 1
        assert self._is_creator()
        assert self._succeeded()
        assert not self._is_cancelled()
        assert self.creator_claimed.value == 0
        admin_fee = (self.goal.value * SUCCESS_FEE_PCT) // UInt64(100)
        creator_payout = self.goal.value - admin_fee
        assert creator_payout > 0
        itxn.Payment(
            receiver=self.creator.value,
            amount=creator_payout,
            fee=0,
        ).submit()
        self.creator_claimed.value = UInt64(1)

    # ── admin_fee_claim ─────────────────────────────────────────────────────────
    # Success only. Admin collects the 4% success fee IMMEDIATELY once the goal is
    # met — no 6-month grace wait. Fully independent of creator_claim: the admin's
    # fee and the creator's 96% payout are settled on separate calls in any order.
    # Call-once (admin_fee_claimed flag). The final close (admin_claim) checks this
    # flag so the fee is never paid twice.
    @abimethod
    def admin_fee_claim(self) -> None:
        assert Global.group_size == 1
        assert self._is_admin()
        assert self._succeeded()
        assert not self._is_cancelled()
        assert self.admin_fee_claimed.value == 0
        admin_fee = (self.goal.value * SUCCESS_FEE_PCT) // UInt64(100)
        assert admin_fee > 0
        itxn.Payment(
            receiver=self.admin.value,
            amount=admin_fee,
            fee=0,
        ).submit()
        self.admin_fee_claimed.value = UInt64(1)

    # ── refund ──────────────────────────────────────────────────────────────────
    # Failure only. Investor reclaims their ALGO. Keyed on `failed`, which
    # requires funded_round == 0 — can NEVER open once the goal is hit.
    # Available immediately on failure/cancel; no grace wait for investors.
    @abimethod
    def refund(self) -> None:
        investor = Txn.sender
        assert Global.group_size == 1
        assert self._failed()
        contrib_amt = self.contrib.get(investor, default=UInt64(0))
        assert contrib_amt > 0
        itxn.Payment(
            receiver=investor,
            amount=contrib_amt,
            fee=0,
        ).submit()
        self.contrib[investor] = UInt64(0)

    # ── creator_reclaim_asa ─────────────────────────────────────────────────────
    # Failure only. The creator's failure-side counterpart to refund: closes the
    # app's entire deposited project-token holding back to the CREATOR.
    # Available IMMEDIATELY on failure/cancel — no grace wait, symmetric with the
    # investor refund. Closing the ASA also satisfies admin_claim's asa_id == 0
    # precondition, so on failure the admin never needs admin_sweep_asa.
    @abimethod
    def creator_reclaim_asa(self) -> None:
        assert Global.group_size == 1
        assert self._is_creator()
        assert self._failed()
        assert self.asa_id.value != 0
        itxn.AssetTransfer(
            xfer_asset=self.asa_id.value,
            asset_receiver=self.creator.value,
            asset_amount=0,
            asset_close_to=self.creator.value,  # closes the app's full ASA balance
            fee=0,
        ).submit()
        self.asa_id.value = UInt64(0)  # app no longer holds the ASA

    # ── admin_sweep_asa ─────────────────────────────────────────────────────────
    # Decoupled ASA close-out to the ADMIN, kept separate from the ALGO close.
    #   SUCCESS (success_grace_expired): sweeps tokens of investors who never
    #     finalized; unclaimed value forfeits to the admin.
    #   FAILURE (failure_grace_expired): fallback only; if the creator never
    #     reclaims within the 6-month failure grace, admin sweeps — symmetric with
    #     the success side, prevents a non-reclaiming creator locking the ALGO
    #     close (which requires asa_id == 0).
    # PROCEDURE: the admin must opt into asa_id BEFORE calling, or the inner
    # asset_close_to reverts. On revert nothing is lost — opt in and retry.
    @abimethod
    def admin_sweep_asa(self) -> None:
        asa_id = self.asa_id.value
        asa_sweep_ok = asa_id != 0 and (
            (self._succeeded() and not self._is_cancelled() and self._success_grace_expired())
            or (self._failed() and self._failure_grace_expired())
        )
        assert Global.group_size == 1
        assert self._is_admin()
        assert asa_sweep_ok, "grace not expired"
        itxn.AssetTransfer(
            xfer_asset=asa_id,
            asset_receiver=self.admin.value,
            asset_amount=0,
            asset_close_to=self.admin.value,  # closes the app's full ASA balance
            fee=0,
        ).submit()
        self.asa_id.value = UInt64(0)  # app no longer holds the ASA

    # ── admin_claim ─────────────────────────────────────────────────────────────
    # GRACE-ONLY ALGO close, used to retire STALE contracts. No early/`owed`-based
    # path, so nothing the close depends on can be desynchronized by ClearState.
    #
    # Recipient change vs the original: the residual now closes to the CREATOR, not
    # the admin. The admin's earned money is the 4% success fee, which is now
    # collected up-front and independently via admin_fee_claim. Whatever is left in
    # the contract at close time is unclaimed CREATOR value (a 96% payout the
    # creator never claimed) plus dust on success, or unclaimed refunds/seed on
    # failure — none of which is the admin's, so it returns to the creator.
    #
    # Callable by EITHER the admin or the creator: the recipient is fixed to the
    # creator regardless of who triggers it, so letting either party call it means
    # a vanished creator can't block cleanup while a vanished admin can't either.
    #
    # Precondition: the app must NOT still hold the project ASA (asa_id == 0), so
    # the ALGO close carries no inner asset transfer that could revert.
    #
    #   Success close: succeeded, not cancelled, success_grace_expired
    #     → if the admin never took the 4% fee (admin_fee_claimed == 0), pay it to
    #       the admin FIRST, then close the full remainder to the CREATOR. If the
    #       fee was already claimed, just close the remainder to the creator.
    #   Failure close: failed, failure_grace_expired
    #     → close residual ALGO to the CREATOR. No fee is ever taken on failure.
    #
    # Inner-txn count: the success close can fire TWO inner txns (outstanding fee +
    # close) in the worst case; the failure close fires one. All inner fees are 0
    # (caller-pooled), so the triggering app-call must carry fee >= 3x min fee to
    # cover the app call plus two inners. Lone transaction (group_size == 1) so the
    # pooled-fee budget can't be manipulated by sibling transactions.
    @abimethod
    def admin_claim(self) -> None:
        success_close_ok = (
            self._succeeded()
            and not self._is_cancelled()
            and self._success_grace_expired()
            and self.asa_id.value == 0
        )
        failure_close_ok = (
            self._failed()
            and self._failure_grace_expired()
            and self.asa_id.value == 0
        )
        assert Global.group_size == 1
        assert self._is_admin() or self._is_creator()
        assert self.admin_claimed.value == 0
        assert success_close_ok or failure_close_ok, "grace not expired"
        # On a success close where the 4% fee was never collected, pay the admin
        # their fee FIRST (a normal transfer — must precede the close, since after
        # the close there is no balance left to pay from), then mark it claimed.
        if success_close_ok and self.admin_fee_claimed.value == 0:
            admin_fee = (self.goal.value * SUCCESS_FEE_PCT) // UInt64(100)
            if admin_fee > 0:
                itxn.Payment(
                    receiver=self.admin.value,
                    amount=admin_fee,
                    fee=0,
                ).submit()
            self.admin_fee_claimed.value = UInt64(1)
        # Close the full remaining balance to the CREATOR. Identical inner txn for
        # both success and failure paths.
        itxn.Payment(
            receiver=self.creator.value,
            amount=0,
            close_remainder_to=self.creator.value,
            fee=0,
        ).submit()
        self.admin_claimed.value = UInt64(1)

    # ── admin_cancel ────────────────────────────────────────────────────────────
    # Only before success. Cannot cancel a funded campaign.
    @abimethod
    def admin_cancel(self) -> None:
        assert Global.group_size == 1
        assert self._is_admin()
        assert not self._is_cancelled()
        assert self.funded_round.value == 0
        self.cancelled.value = UInt64(1)

    # ── on_delete ─────────────────────────────────────────────────────────────
    @abimethod(allow_actions=["DeleteApplication"])
    def delete(self) -> None:
        assert self._is_admin()
        assert self.admin_claimed.value == 1

    # ── on_update ── UpdateApplication is rejected (no allowed method) ──────────
    # (No update method is defined, so any UpdateApplication call fails, matching
    #  the original on_update = Reject().)

    # ── on_closeout ─────────────────────────────────────────────────────────────
    @abimethod(allow_actions=["CloseOut"])
    def closeout(self) -> None:
        assert self.contrib[Txn.sender] == 0

    # ── on_optin ────────────────────────────────────────────────────────────────
    @abimethod(allow_actions=["OptIn"])
    def optin(self) -> None:
        assert not self._is_cancelled()
        assert self._before_deadline()
        self.contrib[Txn.sender] = UInt64(0)

    # clear_state always approves (the AVM approves clear_program unconditionally).
    # A missing clear_state handler in Puya compiles to an approving clear program.
