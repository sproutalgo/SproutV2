// governanceChain.js — on-chain calls for the Governance app (App B).
// Reads selectors from the compiled ARC-56 spec. Carries the escrow build's fixes:
// Address-object coercion, camelCase confirmation keys, and correct resource
// references (foreignAssets for Sprout reads/transfers, accounts for inner payments).
//
// Env: VITE_GOV_APP_ID, VITE_SPROUT_ASA_ID

import algosdk from 'algosdk'
import { algodClient } from './algorand'
import govArc56 from '../../../contracts/Governance.arc56.json'

const GOV_APP_ID    = Number(import.meta.env.VITE_GOV_APP_ID || 0)
const SPROUT_ASA_ID = Number(import.meta.env.VITE_SPROUT_ASA_ID || 0)

const CONTRACT = new algosdk.ABIContract({ name: govArc56.name, methods: govArc56.methods })
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
function appAddr() { return algosdk.getApplicationAddress(GOV_APP_ID) }

async function signSend(signTransactions, txns, confirmTxId) {
  const signed = await signTransactions(txns.map(t => algosdk.encodeUnsignedTransaction(t)))
  await algodClient.sendRawTransaction(signed).do()
  return algosdk.waitForConfirmation(algodClient, confirmTxId, 6)
}

// ── staking (voters) ──────────────────────────────────────────────────────────

export async function isOptedIn(address) {
  const info = await algodClient.accountInformation(address).do()
  const assets = pick(info, 'assets') || []
  return assets.some(a => Number(pick(a, 'asset-id', 'assetId')) === SPROUT_ASA_ID)
}

export async function stake({ signTransactions, address, microSprout }) {
  const sp = await getSp()
  const axfer = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: address, receiver: appAddr(), assetIndex: SPROUT_ASA_ID,
    amount: Number(microSprout), suggestedParams: sp,
  })
  const m = method('stake')
  const appCall = algosdk.makeApplicationNoOpTxnFromObject({
    sender: address, suggestedParams: await getSp(1000),
    appIndex: GOV_APP_ID, appArgs: buildAppArgs(m, []),
    foreignAssets: [SPROUT_ASA_ID],
  })
  algosdk.assignGroupID([axfer, appCall])
  return signSend(signTransactions, [axfer, appCall], appCall.txID())
}

export async function unstake({ signTransactions, address, microSprout, votedCandidateId }) {
  // Unstake decrements the voter's candidate box (if they have a vote), so declare
  // the voter box and — when they've voted — their candidate box.
  const m = method('unstake')
  const boxes = [{ appIndex: GOV_APP_ID, name: boxName('v:', algosdk.decodeAddress(address).publicKey) }]
  if (votedCandidateId && Number(votedCandidateId) !== 0) {
    boxes.push({ appIndex: GOV_APP_ID, name: boxName('c:', uint64Bytes(votedCandidateId)) })
  }
  const appCall = algosdk.makeApplicationNoOpTxnFromObject({
    sender: address, suggestedParams: await getSp(2000), // inner transfer back
    appIndex: GOV_APP_ID, appArgs: buildAppArgs(m, [BigInt(microSprout)]),
    foreignAssets: [SPROUT_ASA_ID],
    boxes,
  })
  return signSend(signTransactions, [appCall], appCall.txID())
}

// ── vote — back ONE candidate with your full staked balance ──────────────────
// Window-only. Snapshots your staked balance onto the candidate; re-vote to update
// after staking more, or to switch candidates. Touches the voter box + up to TWO
// candidate boxes (old + new), so both must be declared when switching.

export async function vote({ signTransactions, address, candidateId, prevCandidateId }) {
  const m = method('vote')
  const boxes = [
    { appIndex: GOV_APP_ID, name: boxName('v:', algosdk.decodeAddress(address).publicKey) },
    { appIndex: GOV_APP_ID, name: boxName('c:', uint64Bytes(candidateId)) },
  ]
  // If switching from a previous candidate, that box is decremented too — declare it.
  if (prevCandidateId && Number(prevCandidateId) !== Number(candidateId)) {
    boxes.push({ appIndex: GOV_APP_ID, name: boxName('c:', uint64Bytes(prevCandidateId)) })
  }
  const appCall = algosdk.makeApplicationNoOpTxnFromObject({
    sender: address, suggestedParams: await getSp(1000),
    appIndex: GOV_APP_ID,
    appArgs: buildAppArgs(m, [BigInt(candidateId)]),
    boxes,
  })
  return signSend(signTransactions, [appCall], appCall.txID())
}

// ── admin lifecycle ───────────────────────────────────────────────────────────

export async function openEpoch({ signTransactions, address, voteOpen, voteClose, tallyRound }) {
  const m = method('open_epoch')
  const appCall = algosdk.makeApplicationNoOpTxnFromObject({
    sender: address, suggestedParams: await getSp(1000),
    appIndex: GOV_APP_ID,
    appArgs: buildAppArgs(m, [BigInt(voteOpen), BigInt(voteClose), BigInt(tallyRound)]),
  })
  return signSend(signTransactions, [appCall], appCall.txID())
}

export async function registerCandidate({ signTransactions, address, candidateId, directoryEntryId, payoutAddr }) {
  const m = method('register_candidate')
  const appCall = algosdk.makeApplicationNoOpTxnFromObject({
    sender: address, suggestedParams: await getSp(1000),
    appIndex: GOV_APP_ID,
    appArgs: buildAppArgs(m, [BigInt(candidateId), BigInt(directoryEntryId), payoutAddr]),
    boxes: [{ appIndex: GOV_APP_ID, name: boxName('c:', uint64Bytes(candidateId)) }],
  })
  return signSend(signTransactions, [appCall], appCall.txID())
}

// Tally: submit the full ranking (candidate ids sorted by weight DESC); contract
// verifies the ordering against its running tallies, derives winners, and pays. No
// per-voter processing — candidate weights are already final (running tallies).
export async function finalize({ signTransactions, address, rankedCandidateIds, payoutAddrs }) {
  const m = method('finalize')
  const ids = rankedCandidateIds.map(c => BigInt(c))
  const boxes = rankedCandidateIds.map(cid => ({ appIndex: GOV_APP_ID, name: boxName('c:', uint64Bytes(cid)) }))
  const appCall = algosdk.makeApplicationNoOpTxnFromObject({
    sender: address,
    // fee must cover up to (winners) inner payments; be generous for testing.
    suggestedParams: await getSp(1000 * (rankedCandidateIds.length + 2)),
    appIndex: GOV_APP_ID,
    appArgs: buildAppArgs(m, [ids]),
    boxes,
    accounts: payoutAddrs || [],  // winner payout addresses (inner payment receivers)
  })
  return signSend(signTransactions, [appCall], appCall.txID())
}

// ── reads ────────────────────────────────────────────────────────────────────

export async function fetchStaked(address) {
  // Read the voter box. ABI layout: staked(u64)@0, voted_candidate(u64)@8,
  // voted_weight(u64)@16, has_vote(u8)@24, epoch(u64)@25.
  try {
    const name = boxName('v:', algosdk.decodeAddress(address).publicKey)
    const box = await algodClient.getApplicationBoxByName(GOV_APP_ID, name).do()
    const dv = new DataView(box.value.buffer, box.value.byteOffset, box.value.byteLength)
    const stakedMicro = Number(dv.getBigUint64(0))
    const votedCandidate = Number(dv.getBigUint64(8))
    const votedWeight = Number(dv.getBigUint64(16))
    const hasVote = dv.getUint8(24) === 1
    return { stakedMicro, votedCandidate, votedWeightMicro: votedWeight, hasVote }
  } catch (e) {
    return { stakedMicro: 0, votedCandidate: 0, votedWeightMicro: 0, hasVote: false }
  }
}

// Read one candidate box's running weight. ABI layout: directory_entry_id(u64)@0,
// payout_addr(32 bytes)@8, weight(u64)@40.
export async function fetchCandidateWeight(candidateId) {
  try {
    const name = boxName('c:', uint64Bytes(candidateId))
    const box = await algodClient.getApplicationBoxByName(GOV_APP_ID, name).do()
    const dv = new DataView(box.value.buffer, box.value.byteOffset, box.value.byteLength)
    return Number(dv.getBigUint64(40))
  } catch (e) {
    return 0
  }
}

// Build the descending ranking `finalize` needs, by reading each candidate's weight.
// Returns { rankedIds: [...], payoutAddrs: [...] } sorted by weight DESC.
export async function buildRanking(candidateIds, candidatePayouts) {
  const withWeights = []
  for (const cid of candidateIds) {
    const w = await fetchCandidateWeight(cid)
    withWeights.push({ cid, w, payout: candidatePayouts?.[cid] })
  }
  withWeights.sort((a, b) => b.w - a.w)
  return {
    rankedIds: withWeights.map(x => x.cid),
    payoutAddrs: withWeights.map(x => x.payout).filter(Boolean),
    weights: withWeights.map(x => x.w),
  }
}

export async function fetchPool() {
  const info = await algodClient.accountInformation(appAddr()).do()
  const bal = Number(pick(info, 'amount'))
  const mbr = Number(pick(info, 'min-balance', 'minBalance'))
  return Math.max(0, bal - mbr)
}

// ── helpers ──────────────────────────────────────────────────────────────────

function uint64Bytes(n) {
  const b = new Uint8Array(8)
  new DataView(b.buffer).setBigUint64(0, BigInt(n))
  return b
}
function boxName(prefix, suffixBytes) {
  const p = new TextEncoder().encode(prefix)
  const out = new Uint8Array(p.length + suffixBytes.length)
  out.set(p, 0); out.set(suffixBytes, p.length)
  return out
}

export const IDS = { GOV_APP_ID, SPROUT_ASA_ID }
