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
    // stake writes the caller's voter box — it must be declared.
    boxes: [{ appIndex: GOV_APP_ID, name: boxName('v:', algosdk.decodeAddress(address).publicKey) }],
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

// One ID end to end: the directory entry id IS the candidate key.
export async function registerCandidate({ signTransactions, address, directoryEntryId, payoutAddr }) {
  const m = method('register_candidate')
  const appCall = algosdk.makeApplicationNoOpTxnFromObject({
    sender: address, suggestedParams: await getSp(1000),
    appIndex: GOV_APP_ID,
    appArgs: buildAppArgs(m, [BigInt(directoryEntryId), payoutAddr]),
    boxes: [{ appIndex: GOV_APP_ID, name: boxName('c:', uint64Bytes(directoryEntryId)) }],
  })
  return signSend(signTransactions, [appCall], appCall.txID())
}

// ── two-phase finalize: tally -> pay_winners -> finish_tally ──────────────────
// The single finalize referenced every candidate box AND every winner account in one
// txn, exceeding Algorand's 8-reference/txn limit at 8 candidates. The contract now
// splits the work so each call references only ONE category:
//   tally        — references only the candidate boxes (reads + deletes); winner
//                  payout addresses are frozen into global state.
//   pay_winners  — references only the winner payout accounts (<= 8 per slice).
//   finish_tally — references nothing; flips to phase 2.

// PHASE 1. Submit the full ranking (candidate ids sorted by weight DESC). The contract
// verifies the ordering, freezes the winner set + share, deletes all candidate boxes.
//
// OPCODE BUDGET: tally loops over every candidate twice (verify ranking, then record
// winners + delete boxes), which for a full 8-candidate ballot exceeds the 700-opcode
// budget of a SINGLE app call. Algorand pools the opcode budget across all app calls in
// an atomic GROUP (700 units each), so we pad the group with cheap read-only budget
// filler calls. The contract is unchanged — only the real tally call does work; the
// fillers just donate their 700 units to the shared pool. One filler per ~3 candidates
// is ample; we scale with the ballot size and always include at least 3.
export async function tally({ signTransactions, address, rankedCandidateIds }) {
  const m = method('tally')
  const ids = rankedCandidateIds.map(c => BigInt(c))
  const boxes = rankedCandidateIds.map(cid => ({ appIndex: GOV_APP_ID, name: boxName('c:', uint64Bytes(cid)) }))
  const tallyCall = algosdk.makeApplicationNoOpTxnFromObject({
    sender: address,
    suggestedParams: await getSp(1000),   // no inner payments in tally
    appIndex: GOV_APP_ID,
    appArgs: buildAppArgs(m, [ids]),
    boxes,                                  // only candidate boxes — no accounts
  })

  // Budget fillers: cheap read-only calls to the same app. Each adds 700 opcode units
  // to the group's shared pool. get_epoch is trivial and side-effect free.
  const fillers = Math.max(3, Math.ceil(rankedCandidateIds.length / 2))
  const mEpoch = method('get_epoch')
  const group = [tallyCall]
  for (let i = 0; i < fillers; i++) {
    group.push(algosdk.makeApplicationNoOpTxnFromObject({
      sender: address,
      // a distinct note keeps each filler's txid unique within the group
      note: new Uint8Array([0x62, 0x67, 0x74, i]),  // "bgt" + index
      suggestedParams: await getSp(1000),
      appIndex: GOV_APP_ID,
      appArgs: buildAppArgs(mEpoch, []),
    }))
  }
  algosdk.assignGroupID(group)
  // Confirm on the tally call's id (first in the group).
  return signSend(signTransactions, group, tallyCall.txID())
}

// PHASE 2. Pay the next `count` winners their frozen share. References only the winner
// payout accounts. `count` must be <= 8 (reference limit) and <= winners remaining.
// Pass the payout addresses for THIS slice so they go in the accounts array (inner
// payment receivers). The contract reads the authoritative addresses from global state;
// the accounts array only needs to CONTAIN each receiver for the inner payment to send.
export async function payWinners({ signTransactions, address, count, slicePayoutAddrs }) {
  const m = method('pay_winners')
  const appCall = algosdk.makeApplicationNoOpTxnFromObject({
    sender: address,
    // fee covers up to `count` inner payments, plus the outer.
    suggestedParams: await getSp(1000 * (Number(count) + 1)),
    appIndex: GOV_APP_ID,
    appArgs: buildAppArgs(m, [BigInt(count)]),
    accounts: slicePayoutAddrs || [],      // only payout receivers — no boxes
  })
  return signSend(signTransactions, [appCall], appCall.txID())
}

// PHASE 3. After all winners paid, flip to phase 2 so the next epoch can open.
export async function finishTally({ signTransactions, address }) {
  const m = method('finish_tally')
  const appCall = algosdk.makeApplicationNoOpTxnFromObject({
    sender: address, suggestedParams: await getSp(1000),
    appIndex: GOV_APP_ID, appArgs: buildAppArgs(m, []),
  })
  return signSend(signTransactions, [appCall], appCall.txID())
}

// Admin escape hatch: delete one candidate box by id. Allowed once the epoch is over
// (phase 2, or past tally_round+RECOVERY_DELAY). Used to clear orphaned candidate boxes
// so the app can always reach zero boxes and be closed. References only that one box.
export async function adminDeleteCandidate({ signTransactions, address, candidateId }) {
  const m = method('admin_delete_candidate')
  const appCall = algosdk.makeApplicationNoOpTxnFromObject({
    sender: address, suggestedParams: await getSp(1000),
    appIndex: GOV_APP_ID,
    appArgs: buildAppArgs(m, [BigInt(candidateId)]),
    boxes: [{ appIndex: GOV_APP_ID, name: boxName('c:', uint64Bytes(candidateId)) }],
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

// Read one candidate box. Current ABI layout (after collapsing the id):
//   payout_addr(32 bytes)@0, weight(u64)@32.
export async function fetchCandidate(candidateId) {
  try {
    const name = boxName('c:', uint64Bytes(candidateId))
    const box = await algodClient.getApplicationBoxByName(GOV_APP_ID, name).do()
    const bytes = box.value
    const payoutAddr = algosdk.encodeAddress(bytes.slice(0, 32))
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const weight = Number(dv.getBigUint64(32))
    return { payoutAddr, weight }
  } catch (e) {
    return { payoutAddr: null, weight: 0 }
  }
}

// Back-compat weight-only reader.
export async function fetchCandidateWeight(candidateId) {
  const { weight } = await fetchCandidate(candidateId)
  return weight
}

// Build the descending ranking `finalize` needs. Reads each candidate's weight AND
// payout address FROM THE ON-CHAIN BOX — never from typed input — so the accounts
// array passed to finalize always matches exactly what the contract will pay.
// Returns { rankedIds, payoutAddrs, weights } sorted by weight DESC.
export async function buildRanking(candidateIds) {
  const rows = []
  for (const cid of candidateIds) {
    const { weight, payoutAddr } = await fetchCandidate(cid)
    rows.push({ cid, weight, payoutAddr })
  }
  rows.sort((a, b) => b.weight - a.weight)
  return {
    rankedIds: rows.map(x => x.cid),
    payoutAddrs: rows.map(x => x.payoutAddr).filter(Boolean),
    weights: rows.map(x => x.weight),
  }
}

export async function fetchPool() {
  const info = await algodClient.accountInformation(appAddr()).do()
  const bal = Number(pick(info, 'amount'))
  const mbr = Number(pick(info, 'min-balance', 'minBalance'))
  return Math.max(0, bal - mbr)
}

// Enumerate all candidate ids by listing the app's boxes and keeping the `c:` ones.
// This is what lets finalize be one click — the contract can't list its own boxes,
// but the client can, off-chain, via algod. Decodes the uint64 id from each box name.
export async function listCandidateIds() {
  const res = await algodClient.getApplicationBoxes(GOV_APP_ID).do()
  const boxes = pick(res, 'boxes') || []
  const prefix = new TextEncoder().encode('c:')
  const ids = []
  for (const b of boxes) {
    // box name may be a Uint8Array or base64 string depending on sdk version.
    let name = pick(b, 'name')
    if (typeof name === 'string') name = Uint8Array.from(atob(name), c => c.charCodeAt(0))
    if (name.length === prefix.length + 8 && prefix.every((c, i) => name[i] === c)) {
      const dv = new DataView(name.buffer, name.byteOffset + prefix.length, 8)
      ids.push(Number(dv.getBigUint64(0)))
    }
  }
  return ids
}

// Read the governance global state we need to drive finalize: phase, winner_count,
// paid_count. Falls back gracefully if a key is absent (older app / pre-tally).
export async function fetchGovState() {
  try {
    const info = await algodClient.getApplicationByID(GOV_APP_ID).do()
    const params = pick(info, 'params') || {}
    const gs = pick(params, 'global-state', 'globalState') || []
    const out = {}
    for (const kv of gs) {
      const keyB64 = pick(kv, 'key')
      const key = typeof keyB64 === 'string'
        ? new TextDecoder().decode(Uint8Array.from(atob(keyB64), c => c.charCodeAt(0)))
        : new TextDecoder().decode(keyB64)
      const val = pick(kv, 'value') || {}
      out[key] = Number(pick(val, 'uint') || 0)
    }
    return {
      phase: out.phase ?? 0,
      winnerCount: out.winner_count ?? 0,
      paidCount: out.paid_count ?? 0,
      candidateCount: out.candidate_count ?? 0,
      epochId: out.epoch_id ?? 0,
    }
  } catch (e) {
    return { phase: 0, winnerCount: 0, paidCount: 0, candidateCount: 0, epochId: 0 }
  }
}

// One-click finalize across the three phases. Discovers candidates, reads weights +
// payout addresses from chain, sorts descending, then:
//   1) tally(rankedIds)         — freezes winners, deletes candidate boxes
//   2) pay_winners in slices    — pays each winner its share (<= 8 accounts per txn)
//   3) finish_tally             — flips to phase 2
// Reports progress via onStep. Resumable: if called when already mid-payout (phase 1),
// it skips tally and continues paying from paid_count.
const PAY_SLICE = 8   // max winner accounts referenced per pay_winners txn
export async function finalizeAuto({ signTransactions, address, onStep = () => {} }) {
  let st = await fetchGovState()

  // Phase 0: run tally. Need the ranked ids + their payout addresses (for the payout
  // slices later). Capture the ranking BEFORE tally deletes the candidate boxes.
  let rankedIds = []
  let payoutAddrs = []
  if (st.phase === 0) {
    const ids = await listCandidateIds()
    if (ids.length === 0) throw new Error('No candidates registered for this epoch')
    const r = await buildRanking(ids)
    rankedIds = r.rankedIds
    payoutAddrs = r.payoutAddrs
    onStep('Tallying…')
    await tally({ signTransactions, address, rankedCandidateIds: rankedIds })
    st = await fetchGovState()
  } else if (st.phase === 1) {
    // Resuming a payout: candidate boxes are already gone, so rebuild the payout
    // address list from the directory ranking isn't possible here. The contract pays
    // from its own global state regardless; the accounts array just needs each winner
    // receiver. We reconstruct winners from the on-chain winner globals below.
    payoutAddrs = await fetchWinnerAddrs(st.winnerCount)
  }

  // Phase 1: pay winners in slices until paid_count == winner_count.
  if (st.phase === 1) {
    // If we just tallied, we have payoutAddrs in ranked order; winners are the first
    // winnerCount of them. If resuming, payoutAddrs came from the winner globals.
    const winners = payoutAddrs.slice(0, st.winnerCount)
    while (st.paidCount < st.winnerCount) {
      const start = st.paidCount
      const end = Math.min(start + PAY_SLICE, st.winnerCount)
      const slice = winners.slice(start, end)
      onStep(`Paying winners ${start + 1}–${end} of ${st.winnerCount}…`)
      await payWinners({ signTransactions, address, count: end - start, slicePayoutAddrs: slice })
      st = await fetchGovState()
    }
    onStep('Finishing…')
    await finishTally({ signTransactions, address })
    st = await fetchGovState()
  }

  onStep('Done.')
  return st
}

// Read the frozen winner payout addresses from global state (w0..w7). Used when
// resuming a payout after the candidate boxes are already deleted.
export async function fetchWinnerAddrs(winnerCount) {
  const info = await algodClient.getApplicationByID(GOV_APP_ID).do()
  const params = pick(info, 'params') || {}
  const gs = pick(params, 'global-state', 'globalState') || []
  const byKey = {}
  for (const kv of gs) {
    const keyB64 = pick(kv, 'key')
    const key = typeof keyB64 === 'string'
      ? new TextDecoder().decode(Uint8Array.from(atob(keyB64), c => c.charCodeAt(0)))
      : new TextDecoder().decode(keyB64)
    byKey[key] = pick(kv, 'value') || {}
  }
  const addrs = []
  for (let i = 0; i < Number(winnerCount) && i < 8; i++) {
    const val = byKey['w' + i]
    if (!val) break
    const raw = pick(val, 'bytes')
    if (!raw) continue
    const bytes = typeof raw === 'string' ? Uint8Array.from(atob(raw), c => c.charCodeAt(0)) : raw
    addrs.push(algosdk.encodeAddress(bytes))
  }
  return addrs
}

// Delete every candidate box on the app, one admin_delete_candidate call each. Used to
// clear an epoch whose boxes can't be tallied (e.g. an overflowed ballot on an old
// contract) so the app can be closed. Requires the epoch to be over (phase 2 or past
// tally_round). Returns the ids it deleted.
export async function clearAllCandidates({ signTransactions, address, onStep = () => {} }) {
  const ids = await listCandidateIds()
  for (let i = 0; i < ids.length; i++) {
    onStep(`Deleting candidate ${ids[i]} (${i + 1}/${ids.length})…`)
    await adminDeleteCandidate({ signTransactions, address, candidateId: ids[i] })
  }
  onStep('All candidate boxes cleared.')
  return ids
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
