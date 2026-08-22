import algosdk from 'algosdk'
import { algodClient } from './algorand'
import arc56 from '../../../contracts/Crowdfund.arc56.json'

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * ARC-4 method-call layer for the Puya (Algorand Python) crowdfunding contract.
 *
 * The contract was ported from PyTeal (bare NoOp calls whose first app-arg was a
 * raw string like "contribute") to a Puya ARC4Contract, which dispatches on
 * 4-byte ARC-4 method SELECTORS instead of strings. Every app call below is now
 * an ARC-4 method call:
 *
 *   appArgs[0]   = method selector (sha512/256("name(argtypes)ret")[:4])
 *   appArgs[1..] = ABI-encoded NON-transaction args (uint64, address, …)
 *
 * Transaction-type args (pay / axfer) are NOT app-args — under ARC-4 they are
 * placed in the group IMMEDIATELY BEFORE the app call. So a "contribute" group is
 * now [payment, appCall] (payment first), the reverse of the old PyTeal order.
 * The contract asserts `txn_arg.group_index == Txn.group_index - 1` accordingly.
 *
 * Selectors and ABI types are read from the compiled ARC-56 spec
 * (contracts/Crowdfund.arc56.json) so they can never drift from the deployed
 * program. Do not hard-code selectors here.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ABIContract built from the ARC-56 method list (ARC-56 methods are ARC-4 compatible).
const CONTRACT = new algosdk.ABIContract({ name: arc56.name, methods: arc56.methods })

/** State schema the client must allocate at create time — read from the spec so
 *  it always matches the contract (13 global ints incl. admin_fee_claimed). */
const SCHEMA = {
  numGlobalInts:       arc56.state.schema.global.ints,   // 13
  numGlobalByteSlices: arc56.state.schema.global.bytes,  // 2
  numLocalInts:        arc56.state.schema.local.ints,    // 1
  numLocalByteSlices:  arc56.state.schema.local.bytes,   // 0
}

const enc = new TextEncoder()

/** Suggested params with flat fee */
async function getSp(fee = 1000) {
  const sp = await algodClient.getTransactionParams().do()
  return { ...sp, flatFee: true, fee }
}

/** Look up a method's selector + ABI arg types from the ARC-56 spec. */
function method(name) {
  return CONTRACT.getMethodByName(name)
}

const TXN_ARG_TYPES = new Set(['pay', 'axfer', 'appl', 'keyreg', 'acfg', 'afrz'])

/**
 * Build the appArgs array for an ARC-4 call: [selector, ...encoded non-txn args].
 * `nonTxnArgs` is an array of raw JS values in method-declaration order, EXCLUDING
 * transaction-type args (those are separate group members). The ABI type for each
 * is taken from the method definition, skipping txn-type slots.
 */
function buildAppArgs(m, nonTxnArgs) {
  const out = [m.getSelector()]
  let ai = 0
  for (const arg of m.args) {
    if (TXN_ARG_TYPES.has(String(arg.type))) continue // group member, not an app-arg
    out.push(arg.type.encode(nonTxnArgs[ai++]))
  }
  return out
}

/**
 * Deploy a new crowdfunding application as an ARC-4 create call grouped with the
 * listing-fee payment:
 *   [0] Payment of listing fee (creator → admin)  ← ARC-4 txn arg, placed first
 *   [1] ApplicationCreate ("create" method call)
 *
 * State schema (from ARC-56 spec):
 *   numGlobalInts = 13: goal, tpb, apb, dec_factor, deadline, days, asa_id,
 *     raised, funded_round, cancelled, creator_claimed, admin_fee_claimed,
 *     admin_claimed
 *   numGlobalByteSlices = 2: creator, admin
 *
 * Exchange rate is two integers: tokens_per_bundle whole tokens per
 * algo_per_bundle ALGO. tokens_per_bundle == 0 => donation campaign.
 * The contract computes deadline internally from days × ROUNDS_PER_DAY.
 * Minimum goal: 10 ALGO. Minimum listing fee: 10 ALGO. Both enforced on-chain.
 *
 * Success fee (4%) is now collected separately and immediately via
 * admin_fee_claim once the campaign is funded — no longer swept at grace close.
 */
export async function buildCreateAppTxnGroup({
  sender,
  approvalProgram,
  clearProgram,
  adminAddress,
  goalMicroAlgos,
  tokensPerBundle,
  algoPerBundle,
  durationDays,
}) {
  const sp   = await getSp()
  const days = Number(durationDays)

  // Listing fee: 0.001% of goal per day = goal × days / 100,000, min 10 ALGO.
  const rawListingFee   = Math.floor((goalMicroAlgos * days) / 100_000)
  const MIN_LISTING_FEE = 10_000_000
  const listingFee      = Math.max(rawListingFee, MIN_LISTING_FEE)

  // The listing-fee payment is the create method's `pay` transaction arg, so it
  // must sit immediately before the app-create call in the group.
  const listingFeeTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender,
    receiver: adminAddress,
    amount:   listingFee,
    suggestedParams: sp,
  })

  const m = method('create')
  // Non-txn args in declaration order: address, uint64, uint64, uint64, uint64.
  const appArgs = buildAppArgs(m, [
    adminAddress,                 // address
    BigInt(goalMicroAlgos),       // goal
    BigInt(tokensPerBundle),      // tokens_per_bundle
    BigInt(days),                 // days
    BigInt(algoPerBundle),        // algo_per_bundle
  ])

  const appCreateTxn = algosdk.makeApplicationCreateTxnFromObject({
    sender,
    suggestedParams: sp,
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    approvalProgram,
    clearProgram,
    ...SCHEMA,
    appArgs,
  })

  // Group order: [payment, appCreate].
  algosdk.assignGroupID([listingFeeTxn, appCreateTxn])
  // The app-create is no longer first in the group, so sendRawTransaction's
  // returned txid (which is the FIRST txn's) would be the payment's, not the
  // create's. Return the create txn id explicitly so the caller can confirm on it
  // and read application-index.
  return { txns: [listingFeeTxn, appCreateTxn], listingFee, appCreateTxnId: appCreateTxn.txID() }
}

/**
 * App opt-in to the project ASA — a STANDALONE call that must run and confirm
 * BEFORE the setup group.
 *
 * Why this exists (subtle but load-bearing): Puya binds setup's axfer argument to
 * the group slot immediately BEFORE the setup call (GroupIndex - 1). So in the
 * setup group [AssetTransfer, setup], the token-pool transfer executes first,
 * before setup's body runs. The app account must already be opted into the ASA at
 * that moment, or the transfer fails with "receiver error: must optin". This call
 * performs that opt-in in its own prior transaction.
 *
 * (The original PyTeal used group order [appCall, transfer], so its inner opt-in
 * ran before the transfer — the ARC-4 port's mandatory reordering is what makes a
 * dedicated opt-in necessary.)
 *
 * LONE app call. Fee 2000 covers the single pooled inner opt-in (fee:0 inner).
 * The asset id is both an ABI arg and in foreignAssets so the on-chain reference
 * resolves.
 */
export async function buildAppOptInAsaTxn({ sender, appId, asaId }) {
  const sp = await getSp(2000)
  const m  = method('app_opt_in_asa')
  const appArgs = buildAppArgs(m, [BigInt(asaId)])
  return algosdk.makeApplicationNoOpTxnFromObject({
    sender,
    suggestedParams: sp,
    appIndex: Number(appId),
    appArgs,
    foreignAssets: [Number(asaId)],
  })
}

/**
 * Setup group (2 txns), ARC-4 order:
 *   [0] AssetTransfer (token pool: creator → app)  ← txn arg, placed first
 *   [1] AppCall "setup" (asset ref + the axfer)
 *
 * setup is gated: before deadline AND before any contribution (raised == 0).
 * PRECONDITIONS (run in order, each confirmed, BEFORE this group):
 *   1. fund the app account for minimum balance (a separate payment),
 *   2. call buildAppOptInAsaTxn so the app is opted into the ASA — REQUIRED,
 *      because the token transfer at slot [0] executes before setup's body and
 *      would otherwise hit an app that isn't opted in yet.
 * The app no longer opts itself in inside setup (that inner opt-in was removed in
 * the contract), so the app-call fee here is the standard 1000 — there is no
 * inner transaction in setup anymore.
 */
export async function buildSetupGroup({ sender, appId, asaId, goalMicroAlgos, tokensPerBundle, algoPerBundle, asaDecimals, appAddress }) {
  const sp      = await getSp()

  // Must match the contract's pool_needed (floor-to-whole-tokens, then scale):
  //   whole = floor(goal * tpb / (apb * 1e6));  pool = whole * 10^decimals
  const decFactor   = Math.pow(10, Number(asaDecimals) || 0)
  const wholeTokens = Number(tokensPerBundle) === 0
    ? 0
    : Math.floor((goalMicroAlgos * Number(tokensPerBundle)) / (Number(algoPerBundle) * 1_000_000))
  const tokensRequired = wholeTokens * decFactor

  const asaTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender,
    receiver: appAddress,
    assetIndex: Number(asaId),
    amount: tokensRequired,
    suggestedParams: sp,
  })

  const m = method('setup')
  // Non-txn args: the asset reference (uint64 asset id). foreignAssets must also
  // carry it so the on-chain AssetParam reads resolve.
  const appArgs = buildAppArgs(m, [BigInt(asaId)])

  const appCallTxn = algosdk.makeApplicationNoOpTxnFromObject({
    sender,
    suggestedParams: sp,        // standard fee: setup has no inner txn anymore
    appIndex: Number(appId),
    appArgs,
    foreignAssets: [Number(asaId)],
    accounts: [sender],
  })

  // Group order: [assetTransfer, appCall].
  algosdk.assignGroupID([asaTxn, appCallTxn])
  return [asaTxn, appCallTxn]
}

/** Opt-in transaction (investor opts into the app) */
export async function buildOptInTxn({ sender, appId }) {
  const sp = await getSp()
  const m  = method('optin')
  return algosdk.makeApplicationOptInTxnFromObject({
    sender,
    suggestedParams: sp,
    appIndex: Number(appId),
    appArgs: buildAppArgs(m, []),
  })
}

/**
 * Contribute group (2 txns), ARC-4 order:
 *   [0] Payment (whole-ALGO amount, investor → app)  ← txn arg, placed first
 *   [1] AppCall "contribute"
 */
export async function buildContributeGroup({ sender, appId, appAddress, amountMicroAlgos }) {
  const sp = await getSp()

  const payTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender,
    receiver: appAddress,
    amount: amountMicroAlgos,
    suggestedParams: sp,
  })

  const m = method('contribute')
  const appCallTxn = algosdk.makeApplicationNoOpTxnFromObject({
    sender,
    suggestedParams: sp,
    appIndex: Number(appId),
    appArgs: buildAppArgs(m, []),
  })

  // Group order: [payment, appCall].
  algosdk.assignGroupID([payTxn, appCallTxn])
  return [payTxn, appCallTxn]
}

/**
 * Finalize (pull model): the calling investor claims their own tokens.
 * LONE app call — group_size == 1 enforced by the contract.
 * Fee: 2000 covers 1 inner ASA transfer (fee:0 → caller-pooled).
 * REQUIREMENT: investor must be opted into asa_id before calling.
 */
export async function buildFinalizeTxn({ sender, appId, asaId }) {
  const sp = await getSp(2000)
  const m  = method('finalize')
  return algosdk.makeApplicationNoOpTxnFromObject({
    sender,
    suggestedParams: sp,
    appIndex: Number(appId),
    appArgs: buildAppArgs(m, []),
    foreignAssets: [Number(asaId)],
  })
}

/**
 * Creator claim: creator withdraws (goal - 4%) ALGO.
 * LONE app call — group_size == 1 enforced by the contract.
 * Callable immediately once funded_round > 0. Independent of admin_fee_claim.
 * Fee: 2000 covers 1 inner Payment (fee:0 → caller-pooled).
 */
export async function buildCreatorClaimTxn({ sender, appId }) {
  const sp = await getSp(2000)
  const m  = method('creator_claim')
  return algosdk.makeApplicationNoOpTxnFromObject({
    sender,
    suggestedParams: sp,
    appIndex: Number(appId),
    appArgs: buildAppArgs(m, []),
    accounts: [sender],
  })
}

/**
 * Admin fee claim: admin collects the fixed 4% success fee IMMEDIATELY once the
 * campaign is funded — no 6-month grace wait. Independent of creator_claim.
 * Call-once (admin_fee_claimed flag on-chain). LONE app call.
 * Fee: 2000 covers 1 inner Payment (fee:0 → caller-pooled).
 */
export async function buildAdminFeeClaimTxn({ sender, appId }) {
  const sp = await getSp(2000)
  const m  = method('admin_fee_claim')
  return algosdk.makeApplicationNoOpTxnFromObject({
    sender,
    suggestedParams: sp,
    appIndex: Number(appId),
    appArgs: buildAppArgs(m, []),
    accounts: [sender],
  })
}

/**
 * Refund (pull model): investor reclaims their own ALGO on failure/cancel.
 * LONE app call — group_size == 1 enforced by the contract.
 * Keyed on failed predicate (funded_round == 0 AND (cancelled OR after_deadline)).
 * Fee: 2000 covers 1 inner Payment (fee:0 → caller-pooled).
 */
export async function buildRefundTxn({ sender, appId }) {
  const sp = await getSp(2000)
  const m  = method('refund')
  return algosdk.makeApplicationNoOpTxnFromObject({
    sender,
    suggestedParams: sp,
    appIndex: Number(appId),
    appArgs: buildAppArgs(m, []),
    accounts: [sender],
  })
}

/**
 * Creator reclaim ASA: creator closes the entire project-token holding back to
 * themselves on failure/cancel. Immediate — no grace wait. LONE app call.
 * Fee: 2000 covers 1 inner ASA close (fee:0 → caller-pooled).
 * REQUIREMENT: creator must be opted into asa_id.
 * After this call asa_id == 0, satisfying admin_claim's precondition.
 */
export async function buildCreatorReclaimAsaTxn({ sender, appId, asaId }) {
  const sp = await getSp(2000)
  const m  = method('creator_reclaim_asa')
  return algosdk.makeApplicationNoOpTxnFromObject({
    sender,
    suggestedParams: sp,
    appIndex: Number(appId),
    appArgs: buildAppArgs(m, []),
    foreignAssets: [Number(asaId)],
  })
}

/**
 * Admin sweep ASA: closes the app's entire ASA holding to the admin after grace
 * expiry. Decoupled from the ALGO close so a missing opt-in cannot trap the ALGO.
 * LONE app call.
 *   Success case: sweeps tokens of investors who never finalized.
 *   Failure case: fallback if creator never called creator_reclaim_asa.
 * REQUIREMENT: admin must be opted into asa_id before calling.
 * Fee: 2000 covers 1 inner ASA close (fee:0 → caller-pooled).
 * After this call asa_id == 0, satisfying admin_claim's precondition.
 */
export async function buildAdminSweepAsaTxn({ sender, appId, asaId }) {
  const sp = await getSp(2000)
  const m  = method('admin_sweep_asa')
  return algosdk.makeApplicationNoOpTxnFromObject({
    sender,
    suggestedParams: sp,
    appIndex: Number(appId),
    appArgs: buildAppArgs(m, []),
    foreignAssets: [Number(asaId)],
  })
}

/**
 * Admin claim: GRACE-ONLY ALGO close that retires a stale contract. Requires
 * asa_id == 0 (run admin_sweep_asa or creator_reclaim_asa first). LONE app call.
 * Callable by EITHER the admin or the creator; the residual always closes to the
 * CREATOR.
 *
 *   Success path: if the 4% fee was never collected, pays it to the admin FIRST,
 *     then closes the remaining ALGO (unclaimed creator payout + dust) to the
 *     creator. Fires after success_grace_expired.
 *   Failure path: closes residual ALGO to the creator. No fee. Fires after
 *     failure_grace_expired (measured from deadline).
 *
 * Fee: 3000 — the success path can fire TWO inner txns (outstanding fee + close),
 * all fee:0 → caller-pooled, so the app call must fund app-call + 2 inners.
 * The creator must be passed in `accounts` (foreign account) so the inner close
 * can address them.
 */
export async function buildAdminClaimTxn({ sender, appId, creatorAddress }) {
  const sp = await getSp(3000)
  const m  = method('admin_claim')
  return algosdk.makeApplicationNoOpTxnFromObject({
    sender,
    suggestedParams: sp,
    appIndex: Number(appId),
    appArgs: buildAppArgs(m, []),
    accounts: creatorAddress ? [creatorAddress] : undefined,
  })
}

/**
 * Admin cancel: sets cancelled=1, unlocking the refund path.
 * LONE app call. Gated on funded_round == 0 — cannot cancel a funded campaign.
 */
export async function buildAdminCancelTxn({ sender, appId }) {
  const sp = await getSp()
  const m  = method('admin_cancel')
  return algosdk.makeApplicationNoOpTxnFromObject({
    sender,
    suggestedParams: sp,
    appIndex: Number(appId),
    appArgs: buildAppArgs(m, []),
  })
}

/**
 * Compile TEAL source string via algod REST endpoint.
 * Returns compiled bytes as Uint8Array.
 */
export async function compileTeal(source) {
  const compiled = await algodClient.compile(enc.encode(source)).do()
  const b64 = compiled.result ?? compiled.bytes
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0))
}

/**
 * Close out an ASA holding entirely, sending the full balance to closeTo.
 */
export async function buildAsaCloseTxn({ sender, asaId, closeTo }) {
  const sp = await getSp()
  return algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender,
    receiver: closeTo,
    assetIndex: Number(asaId),
    amount: 0,
    closeRemainderTo: closeTo,
    suggestedParams: sp,
  })
}

/**
 * Opt into an ASA (required before an account can receive a given token).
 */
export async function buildAsaOptInTxn({ sender, asaId }) {
  const sp = await getSp()
  return algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender,
    receiver: sender,
    assetIndex: Number(asaId),
    amount: 0,
    suggestedParams: sp,
  })
}

/**
 * ClearState: opts the sender out unconditionally.
 * WARNING: if contrib > 0, using this permanently forfeits the contribution.
 */
export async function buildClearStateTxn({ sender, appId }) {
  const sp = await getSp()
  return algosdk.makeApplicationClearStateTxnFromObject({
    sender,
    suggestedParams: sp,
    appIndex: Number(appId),
  })
}

/**
 * Create a new Algorand Standard Asset (ASA).
 * Used by the "Create token" tab in the setup modal.
 * NOTE: clawback and freeze are left unset (immutable zero address) and
 * defaultFrozen is false — the contract's setup rejects tokens that don't meet
 * these conditions.
 */
export async function buildAsaCreateTxn({
  sender, assetName, unitName, total, decimals,
}) {
  const sp = await getSp()
  return algosdk.makeAssetCreateTxnWithSuggestedParamsFromObject({
    sender,
    suggestedParams: { ...sp, flatFee: true, fee: 1000 },
    defaultFrozen: false,
    unitName:      String(unitName).slice(0, 8).toUpperCase(),
    assetName:     String(assetName).slice(0, 32),
    total:         BigInt(total),
    decimals:      Number(decimals),
    assetURL:      '',
    manager:       sender,
    reserve:       sender,
    freeze:        undefined,
    clawback:      undefined,
  })
}

/**
 * Delete the application (admin only, when admin_claimed == 1).
 */
export async function buildDeleteAppTxn({ sender, appId }) {
  const sp = await getSp()
  const m  = method('delete')
  return algosdk.makeApplicationDeleteTxnFromObject({
    sender,
    suggestedParams: sp,
    appIndex: Number(appId),
    appArgs: buildAppArgs(m, []),
  })
}

/**
 * Encode an array of unsigned Transaction objects into the
 * Uint8Array[] format expected by use-wallet's signTransactions().
 */
export function encodeUnsignedTxns(txns) {
  return txns.map(t => t.toByte())
}
