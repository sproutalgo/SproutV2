// escrowDeploy.js — transaction builders for deploying + bootstrapping the
// Sprout Staking Escrow (App A). Mirrors the conventions in utils/transactions.js:
// selectors/ABI come from the compiled ARC-56 spec, params via getSp(fee), and the
// app is created with makeApplicationCreateTxnFromObject + the spec's schema.
//
// Place the compiled spec at contracts/StakingEscrow.arc56.json and the compiled
// programs at contracts/escrow_approval.teal / escrow_clear.teal (compile step in
// the README). This module reads the spec for selectors + schema so nothing drifts
// from the deployed program.

import algosdk from 'algosdk'
import { algodClient } from '../utils/algorand'
import escrowArc56 from '../../../contracts/StakingEscrow.arc56.json'

const CONTRACT = new algosdk.ABIContract({ name: escrowArc56.name, methods: escrowArc56.methods })

const SCHEMA = {
  numGlobalInts:       escrowArc56.state.schema.global.ints,
  numGlobalByteSlices: escrowArc56.state.schema.global.bytes,
  numLocalInts:        escrowArc56.state.schema.local.ints,
  numLocalByteSlices:  escrowArc56.state.schema.local.bytes,
}

const TXN_ARG_TYPES = new Set(['pay', 'axfer', 'appl', 'keyreg', 'acfg', 'afrz'])

async function getSp(fee = 1000) {
  const sp = await algodClient.getTransactionParams().do()
  return { ...sp, flatFee: true, fee }
}

function method(name) {
  return CONTRACT.getMethodByName(name)
}

function buildAppArgs(m, nonTxnArgs) {
  const out = [m.getSelector()]
  let ai = 0
  for (const arg of m.args) {
    if (TXN_ARG_TYPES.has(String(arg.type))) continue
    out.push(arg.type.encode(nonTxnArgs[ai++]))
  }
  return out
}

async function sendAndConfirm(signedTxns, confirmTxId) {
  await algodClient.sendRawTransaction(signedTxns).do()
  return algosdk.waitForConfirmation(algodClient, confirmTxId, 6)
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1 — create the escrow application (no args on create; bootstrap configures
// it separately). Returns the unsigned txn + its id so the caller can read the new
// app id from the confirmation.
// ─────────────────────────────────────────────────────────────────────────────
export async function buildCreateEscrowTxn({ sender, approvalProgram, clearProgram }) {
  const sp = await getSp()
  const txn = algosdk.makeApplicationCreateTxnFromObject({
    sender,
    suggestedParams: sp,
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    approvalProgram,
    clearProgram,
    ...SCHEMA,
  })
  return { txn, txId: txn.txID() }
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2 — fund the app account so bootstrap's inner AssetConfig can create +
// hold the Sprout ASA. Base MBR (0.1) + ASA MBR (0.1) + the 1 ALGO HARVEST_BUFFER
// + inner-txn fees + headroom. Default 2 ALGO is comfortable for testnet.
// ─────────────────────────────────────────────────────────────────────────────
export async function buildFundAppTxn({ sender, appId, microAlgo = 2_000_000 }) {
  const sp = await getSp()
  const appAddress = algosdk.getApplicationAddress(Number(appId))
  const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender,
    receiver: appAddress,
    amount: Number(microAlgo),
    suggestedParams: sp,
  })
  return { txn, txId: txn.txID() }
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3 — bootstrap(admin, pool_addr). Both are ABI `address` args (no txn args),
// so this is a lone NoOp app call. Fee 2000 covers the single pooled inner
// AssetConfig (which itself is fee:0). The app account must already be funded.
// ─────────────────────────────────────────────────────────────────────────────
export async function buildBootstrapTxn({ sender, appId, adminAddress, poolAddress }) {
  const sp = await getSp(2000)
  const m = method('bootstrap')
  const appArgs = buildAppArgs(m, [adminAddress, poolAddress]) // address, address
  const txn = algosdk.makeApplicationNoOpTxnFromObject({
    sender,
    suggestedParams: sp,
    appIndex: Number(appId),
    appArgs,
  })
  return { txn, txId: txn.txID() }
}

// ─────────────────────────────────────────────────────────────────────────────
// admin_close — SAFE teardown. Destroys the Sprout ASA, sends all remaining ALGO
// to admin, and deletes the app. Only succeeds when accounted_principal == 0 (all
// Sprout burned back) and the account is offline. This is a DeleteApplication call.
//
// Fee 3000 covers the two pooled inner txns (ASA destroy + close payment), both
// fee:0. The Sprout ASA goes in foreignAssets so the destroy reference resolves.
// ─────────────────────────────────────────────────────────────────────────────
export async function buildCloseTxn({ sender, appId, sproutAsaId }) {
  const sp = await getSp(3000)
  const m = method('admin_close')
  const appArgs = buildAppArgs(m, []) // no non-txn args
  const txn = algosdk.makeApplicationDeleteTxnFromObject({
    sender,
    suggestedParams: sp,
    appIndex: Number(appId),
    appArgs,
    foreignAssets: [Number(sproutAsaId)],
  })
  return { txn, txId: txn.txID() }
}

// Run the close: sign + send + confirm. Returns the confirmation.
export async function closeEscrow({ signTransactions, sender, appId, sproutAsaId }) {
  const { txn, txId } = await buildCloseTxn({ sender, appId, sproutAsaId })
  const [signed] = await signTransactions([algosdk.encodeUnsignedTransaction(txn)])
  return sendAndConfirm([signed], txId)
}

// ─────────────────────────────────────────────────────────────────────────────
// Orchestrator — runs the three steps in order, signing each with the wallet and
// waiting for confirmation between them (each step depends on the previous having
// landed: fund needs the app id from create; bootstrap needs the funds present).
//
// signTransactions: use-wallet's signer. Returns { appId, sproutAsaId }.
// ─────────────────────────────────────────────────────────────────────────────
export async function deployAndBootstrap({
  signTransactions, sender, approvalProgram, clearProgram,
  adminAddress, poolAddress, fundMicroAlgo = 2_000_000,
  onStep = () => {},
}) {
  // 1) Create the app.
  onStep('Creating escrow application…')
  const create = await buildCreateEscrowTxn({ sender, approvalProgram, clearProgram })
  const [sc] = await signTransactions([algosdk.encodeUnsignedTransaction(create.txn)])
  const createRes = await sendAndConfirm([sc], create.txId)
  const appId = Number(createRes['application-index'])
  if (!appId) throw new Error('Could not read new app id from create confirmation')

  // 2) Fund the app account.
  onStep(`Funding app ${appId}…`)
  const fund = await buildFundAppTxn({ sender, appId, microAlgo: fundMicroAlgo })
  const [sf] = await signTransactions([algosdk.encodeUnsignedTransaction(fund.txn)])
  await sendAndConfirm([sf], fund.txId)

  // 3) Bootstrap (creates the Sprout ASA, pins admin + pool).
  onStep('Bootstrapping (creating Sprout ASA, pinning admin + pool)…')
  const boot = await buildBootstrapTxn({ sender, appId, adminAddress, poolAddress })
  const [sb] = await signTransactions([algosdk.encodeUnsignedTransaction(boot.txn)])
  const bootRes = await sendAndConfirm([sb], boot.txId)

  // The Sprout ASA is created as an INNER transaction of bootstrap. Read its id
  // from the inner-txn results of the confirmation.
  let sproutAsaId = null
  const inner = bootRes['inner-txns'] || []
  for (const itx of inner) {
    if (itx['asset-index']) { sproutAsaId = Number(itx['asset-index']); break }
    if (itx['created-asset-index']) { sproutAsaId = Number(itx['created-asset-index']); break }
  }
  // Fallback: the ABI return value of bootstrap is the ASA id (uint64).
  if (!sproutAsaId && bootRes['logs']) {
    // ARC-4 return is logged with the 0x151f7c75 return prefix; last 8 bytes = uint64.
    try {
      const log = bootRes['logs'][bootRes['logs'].length - 1]
      const bytes = Uint8Array.from(atob(log), c => c.charCodeAt(0))
      if (bytes.length >= 12) {
        const dv = new DataView(bytes.buffer, bytes.byteLength - 8, 8)
        sproutAsaId = Number(dv.getBigUint64(0))
      }
    } catch { /* leave null */ }
  }

  onStep('Done.')
  return { appId, sproutAsaId, appAddress: algosdk.getApplicationAddress(appId) }
}
