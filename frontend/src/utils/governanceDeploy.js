// governanceDeploy.js — deploy + bootstrap + close for the Governance app (App B).
// Mirrors escrowDeploy.js: selectors/schema from the compiled ARC-56 spec, params
// via getSp(fee), and all the algosdk-version fixes learned on the escrow (Address
// objects coerced, camelCase confirmation keys, resource references).
//
// Env:
//   VITE_SPROUT_ASA_ID   the Sprout ASA (from the escrow deploy)
//   VITE_ESCROW_APP_ID   the escrow app (informational, pinned at bootstrap)

import algosdk from 'algosdk'
import { algodClient } from '../utils/algorand'
import govArc56 from '../../../contracts/Governance.arc56.json'

const SPROUT_ASA_ID = Number(import.meta.env.VITE_SPROUT_ASA_ID || 0)
const ESCROW_APP_ID = Number(import.meta.env.VITE_ESCROW_APP_ID || 0)

const CONTRACT = new algosdk.ABIContract({ name: govArc56.name, methods: govArc56.methods })
const SCHEMA = {
  numGlobalInts:       govArc56.state.schema.global.ints,
  numGlobalByteSlices: govArc56.state.schema.global.bytes,
  numLocalInts:        govArc56.state.schema.local.ints,
  numLocalByteSlices:  govArc56.state.schema.local.bytes,
}
const TXN_ARG_TYPES = new Set(['pay', 'axfer', 'appl', 'keyreg', 'acfg', 'afrz'])

async function getSp(fee = 1000) {
  const sp = await algodClient.getTransactionParams().do()
  return { ...sp, flatFee: true, fee }
}
function method(name) { return CONTRACT.getMethodByName(name) }
function buildAppArgs(m, nonTxnArgs) {
  const out = [m.getSelector()]
  let ai = 0
  for (const arg of m.args) {
    if (TXN_ARG_TYPES.has(String(arg.type))) continue
    out.push(arg.type.encode(nonTxnArgs[ai++]))
  }
  return out
}
function pick(obj, ...keys) {
  if (!obj) return undefined
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== null) return obj[k]
  return undefined
}
async function sendAndConfirm(signed, txId) {
  await algodClient.sendRawTransaction(signed).do()
  return algosdk.waitForConfirmation(algodClient, txId, 6)
}

// ── create ──────────────────────────────────────────────────────────────────
export async function buildCreateTxn({ sender, approvalProgram, clearProgram }) {
  const sp = await getSp()
  const txn = algosdk.makeApplicationCreateTxnFromObject({
    sender, suggestedParams: sp,
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    approvalProgram, clearProgram, ...SCHEMA,
    // The approval program exceeds the 2048-byte single-page limit (the two-phase
    // finalize + the 8 winner-slot globals pushed it to ~2.4 KB). Request 1 extra
    // program page (→ 4096 bytes of room). In algosdk v3 this field is `extraPages`.
    extraPages: 1,
  })
  return { txn, txId: txn.txID() }
}

// ── fund ────────────────────────────────────────────────────────────────────
export async function buildFundTxn({ sender, appId, microAlgo = 1_000_000 }) {
  const sp = await getSp()
  const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender, receiver: algosdk.getApplicationAddress(Number(appId)),
    amount: Number(microAlgo), suggestedParams: sp,
  })
  return { txn, txId: txn.txID() }
}

// ── bootstrap(admin, sprout_asa_id, escrow_app) — opts app into Sprout ────────
// sproutAsaId / escrowAppId are passed at call time so a split deploy can bootstrap
// with the FRESHLY-MINTED escrow ASA, not a stale build-time env var. They fall back
// to the env constants for back-compat with the one-shot orchestrator.
export async function buildBootstrapTxn({ sender, appId, adminAddress, sproutAsaId, escrowAppId }) {
  const asaId = Number(sproutAsaId ?? SPROUT_ASA_ID)
  const escId = Number(escrowAppId ?? ESCROW_APP_ID)
  if (!asaId) throw new Error('Sprout ASA id required for bootstrap (deploy the escrow first)')
  const sp = await getSp(2000) // covers the inner opt-in (fee:0)
  const m = method('bootstrap')
  const appArgs = buildAppArgs(m, [adminAddress, BigInt(asaId), BigInt(escId)])
  const txn = algosdk.makeApplicationNoOpTxnFromObject({
    sender, suggestedParams: sp, appIndex: Number(appId), appArgs,
    foreignAssets: [asaId],   // the inner opt-in references the ASA
  })
  return { txn, txId: txn.txID() }
}

// ── split step 1: create + fund ONLY (no bootstrap) ───────────────────────────
// Creates the governance app and funds its account. Returns { appId, appAddress }.
// The app address is what the escrow bootstrap takes as its pool_addr — and it exists
// the moment the app is created, before bootstrap. This is the whole point of the
// split: create governance → take its address → bootstrap escrow (mints Sprout) →
// bootstrap governance with that fresh Sprout ASA id.
export async function createAndFund({
  signTransactions, sender, approvalProgram, clearProgram,
  fundMicroAlgo = 1_000_000, onStep = () => {},
}) {
  onStep('Creating governance application…')
  const create = await buildCreateTxn({ sender, approvalProgram, clearProgram })
  const [sc] = await signTransactions([algosdk.encodeUnsignedTransaction(create.txn)])
  const createRes = await sendAndConfirm([sc], create.txId)
  const appId = Number(pick(createRes, 'application-index', 'applicationIndex'))
  if (!appId) throw new Error('Could not read new app id from create confirmation')

  onStep(`Funding app ${appId}…`)
  const fund = await buildFundTxn({ sender, appId, microAlgo: fundMicroAlgo })
  const [sf] = await signTransactions([algosdk.encodeUnsignedTransaction(fund.txn)])
  await sendAndConfirm([sf], fund.txId)

  onStep(`Created + funded. Gov App ID ${appId}.`)
  return { appId, appAddress: String(algosdk.getApplicationAddress(appId)) }
}

// ── split step 2: bootstrap an already-created gov app ────────────────────────
// Call after the escrow has been bootstrapped, so the fresh Sprout ASA id is known.
export async function bootstrapOnly({
  signTransactions, sender, appId, adminAddress, sproutAsaId, escrowAppId,
  onStep = () => {},
}) {
  onStep('Bootstrapping (opt into Sprout, pin admin)…')
  const boot = await buildBootstrapTxn({ sender, appId, adminAddress, sproutAsaId, escrowAppId })
  const [sb] = await signTransactions([algosdk.encodeUnsignedTransaction(boot.txn)])
  await sendAndConfirm([sb], boot.txId)
  onStep('Done.')
  return { appId, appAddress: String(algosdk.getApplicationAddress(Number(appId))) }
}

// ── orchestrated deploy (one-shot; env-based ASA/escrow ids) ──────────────────
// Retained for back-compat. Only correct when the env already holds the right
// Sprout ASA + escrow ids — i.e. NOT during a fresh split deploy. Prefer
// createAndFund + bootstrapOnly for a first-time deploy.
export async function deployAndBootstrap({
  signTransactions, sender, approvalProgram, clearProgram,
  adminAddress, sproutAsaId, escrowAppId, fundMicroAlgo = 1_000_000, onStep = () => {},
}) {
  const { appId } = await createAndFund({
    signTransactions, sender, approvalProgram, clearProgram, fundMicroAlgo, onStep,
  })
  await bootstrapOnly({
    signTransactions, sender, appId, adminAddress, sproutAsaId, escrowAppId, onStep,
  })
  onStep('Done.')
  return { appId, appAddress: String(algosdk.getApplicationAddress(appId)) }
}

// ── close / delete (testing teardown) ─────────────────────────────────────────
// admin_close requires the app hold zero Sprout (all voters unstaked). It opts the
// app out of Sprout and closes the ALGO account to admin. DeleteApplication call.
// Fee 3000 covers the two inner txns (asset opt-out + close payment). Resource refs:
// Sprout in foreignAssets, admin in accounts.
export async function buildCloseTxn({ sender, appId, adminAddress }) {
  const sp = await getSp(3000)
  const m = method('admin_close')
  const txn = algosdk.makeApplicationDeleteTxnFromObject({
    sender, suggestedParams: sp, appIndex: Number(appId),
    appArgs: buildAppArgs(m, []),
    foreignAssets: [SPROUT_ASA_ID],
    accounts: adminAddress ? [adminAddress] : undefined,
  })
  return { txn, txId: txn.txID() }
}

export async function closeGovernance({ signTransactions, sender, appId, adminAddress }) {
  const { txn, txId } = await buildCloseTxn({ sender, appId, adminAddress: adminAddress || sender })
  const [signed] = await signTransactions([algosdk.encodeUnsignedTransaction(txn)])
  return sendAndConfirm([signed], txId)
}

// discard_unbootstrapped — recover an app whose bootstrap FAILED (creator-only).
// For a shell that never bootstrapped (no admin, never opted into Sprout). Closes
// the ~1 ALGO funding back to the creator and deletes the app. No resource refs
// needed (no ASA holding). DeleteApplication call; fee 2000 covers the inner close.
export async function buildDiscardTxn({ sender, appId }) {
  const sp = await getSp(2000)
  const m = method('discard_unbootstrapped')
  const txn = algosdk.makeApplicationDeleteTxnFromObject({
    sender, suggestedParams: sp, appIndex: Number(appId),
    appArgs: buildAppArgs(m, []),
    accounts: [sender],   // the inner close pays the creator (= sender)
  })
  return { txn, txId: txn.txID() }
}

export async function discardUnbootstrapped({ signTransactions, sender, appId }) {
  const { txn, txId } = await buildDiscardTxn({ sender, appId })
  const [signed] = await signTransactions([algosdk.encodeUnsignedTransaction(txn)])
  return sendAndConfirm([signed], txId)
}
