// stakingChain.js — on-chain calls for the STAKING escrow (App A), wired to the
// live deployed contract. Reads selectors/ABI from the compiled ARC-56 spec so it
// can't drift from the program, exactly like utils/transactions.js does for
// crowdfund. Handles the algosdk version quirks we hit on deploy (Address objects,
// camelCase confirmation keys).
//
// Env:
//   VITE_ESCROW_APP_ID   the escrow App ID (e.g. 3761429965)
//   VITE_SPROUT_ASA_ID   the Sprout ASA ID (e.g. 3761430244)

import algosdk from 'algosdk'
import { algodClient } from './algorand'
import escrowArc56 from '../../../contracts/StakingEscrow.arc56.json'

const ESCROW_APP_ID  = Number(import.meta.env.VITE_ESCROW_APP_ID || 0)
const SPROUT_ASA_ID  = Number(import.meta.env.VITE_SPROUT_ASA_ID || 0)
const SUPPLY_BASE    = 10_000_000_000_000_000 // 10B * 1e6
const HARVEST_BUFFER = 1_000_000              // must match the contract's HARVEST_BUFFER (1 ALGO)

const CONTRACT = new algosdk.ABIContract({ name: escrowArc56.name, methods: escrowArc56.methods })
const TXN_ARG_TYPES = new Set(['pay', 'axfer', 'appl', 'keyreg', 'acfg', 'afrz'])

async function getSp(fee = 1000) {
  const sp = await algodClient.getTransactionParams().do()
  return { ...sp, flatFee: true, fee }
}

function method(name) {
  return CONTRACT.getMethodByName(name)
}

// appArgs = [selector, ...encoded non-txn args]. Transaction args (pay/axfer) are
// separate group members, placed immediately before the app call.
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

// getApplicationAddress returns an Address OBJECT in newer algosdk; coerce.
function appAddr() {
  return algosdk.getApplicationAddress(ESCROW_APP_ID)
}

async function signSend(signTransactions, txns, confirmTxId) {
  const signed = await signTransactions(txns.map(t => algosdk.encodeUnsignedTransaction(t)))
  await algodClient.sendRawTransaction(signed).do()
  return algosdk.waitForConfirmation(algodClient, confirmTxId, 6)
}

// ─── Opt-in ───────────────────────────────────────────────────────────────────

export async function isOptedIn(address) {
  const info = await algodClient.accountInformation(address).do()
  const assets = pick(info, 'assets') || []
  return assets.some(a => Number(pick(a, 'asset-id', 'assetId')) === SPROUT_ASA_ID)
}

// Opt the user into the Sprout ASA (0-amount self transfer). Required before deposit.
export async function optInSprout({ signTransactions, address }) {
  if (await isOptedIn(address)) return false
  const sp = await getSp()
  const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: address, receiver: address, assetIndex: SPROUT_ASA_ID, amount: 0, suggestedParams: sp,
  })
  await signSend(signTransactions, [txn], txn.txID())
  return true
}

// ─── Deposit — [Payment -> app][deposit call], mints Sprout 1:1 ────────────────

export async function deposit({ signTransactions, address, microAlgo }) {
  // Ensure opted in first (deposit asserts it on-chain).
  await optInSprout({ signTransactions, address })

  const sp = await getSp()
  const pay = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: address, receiver: appAddr(), amount: Number(microAlgo), suggestedParams: sp,
  })
  const m = method('deposit')
  const appCall = algosdk.makeApplicationNoOpTxnFromObject({
    sender: address,
    suggestedParams: await getSp(2000), // covers the inner Sprout transfer (fee:0)
    appIndex: ESCROW_APP_ID,
    appArgs: buildAppArgs(m, []),           // no non-txn args; pay is the txn arg
    foreignAssets: [SPROUT_ASA_ID],
  })
  // Group order: [payment, appCall] — payment immediately before the call.
  algosdk.assignGroupID([pay, appCall])
  return signSend(signTransactions, [pay, appCall], appCall.txID())
}

// ─── Withdraw — [AssetTransfer Sprout -> app][withdraw call], returns ALGO 1:1 ──

export async function withdraw({ signTransactions, address, microSprout }) {
  const sp = await getSp()
  const axfer = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: address, receiver: appAddr(), assetIndex: SPROUT_ASA_ID,
    amount: Number(microSprout), suggestedParams: sp,
  })
  const m = method('withdraw')
  const appCall = algosdk.makeApplicationNoOpTxnFromObject({
    sender: address,
    suggestedParams: await getSp(2000), // covers the inner ALGO payment (fee:0)
    appIndex: ESCROW_APP_ID,
    appArgs: buildAppArgs(m, []),
    foreignAssets: [SPROUT_ASA_ID],
  })
  algosdk.assignGroupID([axfer, appCall])
  return signSend(signTransactions, [axfer, appCall], appCall.txID())
}

// ─── Harvest — permissionless. Sweeps surplus (balance − principal − mbr − buffer)
//     to the pinned pool address. It READS the ASA holding (to compute principal)
//     but never transfers or destroys it, so it works regardless of the ASA's
//     manager. The ASA must be in foreignAssets for that balance read to resolve
//     (asset_holding_get), or the call reverts "unavailable Asset". Caller pays the
//     inner payment fee. ──────────────────────────────────────────────────────────

// Coerce a value that may be a base64 string OR a Uint8Array (algosdk differs by
// version) into a Uint8Array.
function toBytes(v) {
  if (v == null) return new Uint8Array()
  if (v instanceof Uint8Array) return v
  if (Array.isArray(v)) return Uint8Array.from(v)
  if (typeof v === 'string') {
    // base64 → bytes
    try { return Uint8Array.from(atob(v), c => c.charCodeAt(0)) } catch { /* fall through */ }
  }
  return new Uint8Array()
}

function bytesToStr(v) {
  return new TextDecoder().decode(toBytes(v))
}

// Read the pinned pool address from the app's global state (funding_pool_addr).
export async function fetchPoolAddress() {
  const appInfo = await algodClient.getApplicationByID(ESCROW_APP_ID).do()
  const gs = pick(appInfo?.params, 'global-state', 'globalState') || []
  for (const kv of gs) {
    const key = bytesToStr(pick(kv, 'key'))
    if (key === 'funding_pool_addr') {
      const raw = pick(kv.value, 'bytes')
      const bytes = toBytes(raw)
      if (bytes.length === 32) return algosdk.encodeAddress(bytes)
    }
  }
  return null
}

export async function harvest({ signTransactions, address, poolAddress }) {
  // The inner payment goes to the pinned pool address, which must be declared as
  // an available ACCOUNT resource or the call reverts "unavailable Account".
  // Prefer an explicitly-passed poolAddress (or VITE_POOL_ADDRESS); otherwise read
  // it from the contract's global state.
  const pool = poolAddress
    || import.meta.env.VITE_POOL_ADDRESS
    || await fetchPoolAddress()
  if (!pool) throw new Error('Could not determine pool address')

  const m = method('harvest')
  const appCall = algosdk.makeApplicationNoOpTxnFromObject({
    sender: address,
    suggestedParams: await getSp(2000), // covers the inner payment (fee:0)
    appIndex: ESCROW_APP_ID,
    appArgs: buildAppArgs(m, []),
    foreignAssets: [SPROUT_ASA_ID],     // harvest reads the app's Sprout balance
    accounts: [pool],                   // harvest pays the pool via inner payment
  })
  return signSend(signTransactions, [appCall], appCall.txID())
}

// ─── Reads ──────────────────────────────────────────────────────────────────

// The caller's Sprout balance == their withdrawable principal (1 Sprout = 1 microAlgo).
export async function fetchMyPosition(address) {
  const info = await algodClient.accountInformation(address).do()
  const assets = pick(info, 'assets') || []
  let sprout = 0, optedIn = false
  for (const a of assets) {
    if (Number(pick(a, 'asset-id', 'assetId')) === SPROUT_ASA_ID) {
      sprout = Number(pick(a, 'amount')); optedIn = true
    }
  }
  return { optedIn, sproutMicro: sprout, principalMicro: sprout }
}

// Pool-wide escrow stats: total principal (ALGO staked) + harvestable surplus.
export async function fetchEscrowStats() {
  const info = await algodClient.accountInformation(appAddr()).do()
  const bal = Number(pick(info, 'amount'))
  const mbr = Number(pick(info, 'min-balance', 'minBalance'))
  const assets = pick(info, 'assets') || []
  let held = 0
  for (const a of assets) {
    if (Number(pick(a, 'asset-id', 'assetId')) === SPROUT_ASA_ID) held = Number(pick(a, 'amount'))
  }
  const principal = SUPPLY_BASE - held
  // Mirror the contract's harvest floor EXACTLY: principal + live MBR + buffer.
  // (Earlier this omitted the buffer, overstating harvestable surplus by 1 ALGO.)
  const surplus = Math.max(0, bal - principal - mbr - HARVEST_BUFFER)
  return { balanceMicro: bal, principalMicro: principal, surplusMicro: surplus, mbrMicro: mbr }
}

export const IDS = { ESCROW_APP_ID, SPROUT_ASA_ID }
