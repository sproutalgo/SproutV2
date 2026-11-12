// cycleStatus.js — the backbone of the staking/governance UI.
//
// Reads the live state of the funding cycle (from the governance contract + the
// nominations backend) and derives a single human-facing "phase" plus the next
// deadline, so every page can show the user exactly what they can do right now.
//
// The contract speaks in round numbers; users think in days/hours. The rounds→time
// helpers here are the one translation the whole UI depends on.

import { fetchGovState, fetchPool } from './governanceChain'
import { fetchNominationRound } from './api'
import { algodClient } from './algorand'

// Algorand mainnet: ~2.8 s per round (empirically ~2.75–2.9). Good enough for
// human-readable countdowns; never used for anything consensus-critical.
export const SECONDS_PER_ROUND = 2.8

// Rounds between now and a target round, as seconds (can be negative if past).
export function roundsToSeconds(deltaRounds) {
  return deltaRounds * SECONDS_PER_ROUND
}

// Human "in 2d 4h" / "in 36m" / "now" for a target round given the current round.
// Returns { seconds, label, past } — `past` true if the target round has passed.
export function roundCountdown(targetRound, currentRound) {
  const delta = Number(targetRound) - Number(currentRound)
  const seconds = roundsToSeconds(delta)
  if (delta <= 0) return { seconds, label: 'now', past: true }
  return { seconds, label: humanizeSeconds(seconds), past: false }
}

// "2d 4h", "4h 12m", "36m", "< 1m". Compact, at most two units.
export function humanizeSeconds(s) {
  s = Math.max(0, Math.round(s))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return '< 1m'
}

// Approximate wall-clock Date a target round maps to, from the current round + now.
export function roundToDate(targetRound, currentRound) {
  const seconds = roundsToSeconds(Number(targetRound) - Number(currentRound))
  return new Date(Date.now() + seconds * 1000)
}

// ── The derived phase ──────────────────────────────────────────────────────────
//
// The contract's `phase` (0 open, 1 paying, 2 finalized) isn't enough on its own,
// because phase 0 spans three user-facing states depending on where the current
// round sits in the epoch window. This maps raw state → one of:
//
//   'nominating'   — no open epoch, or epoch open but before vote_open: the
//                    community is building the next ballot (nominations active).
//   'voting'       — epoch open, vote_open ≤ round < vote_close: stakers vote.
//   'frozen'       — epoch open, vote_close ≤ round < tally_round: votes locked,
//                    awaiting tally.
//   'tallying'     — round ≥ tally_round but not yet finalized: results imminent.
//   'paying'       — phase 1: winners being paid.
//   'between'      — phase 2 (finalized): cycle done, awaiting the next epoch.
//
// Each carries the primary action a user can take and the next deadline round.
export const PHASES = {
  nominating: { key: 'nominating', label: 'Nominating', action: 'nominate', tone: 'accent' },
  voting:     { key: 'voting',     label: 'Voting open', action: 'vote',     tone: 'success' },
  frozen:     { key: 'frozen',     label: 'Votes frozen', action: 'none',    tone: 'warn' },
  tallying:   { key: 'tallying',   label: 'Awaiting results', action: 'none', tone: 'warn' },
  paying:     { key: 'paying',     label: 'Paying winners', action: 'none',  tone: 'accent' },
  between:    { key: 'between',    label: 'Between cycles', action: 'nominate', tone: 'muted' },
}

function derivePhase(gov, currentRound) {
  const { phase, epochId, voteOpen, voteClose, tallyRound } = gov
  // No epoch ever opened, or finalized: nomination time for the next cycle.
  if (!epochId || epochId === 0) return { ...PHASES.nominating, deadline: null }
  if (phase === 2) return { ...PHASES.between, deadline: null }
  if (phase === 1) return { ...PHASES.paying, deadline: null }
  // phase === 0 — split by window.
  const r = Number(currentRound)
  if (r < Number(voteOpen))  return { ...PHASES.nominating, deadline: voteOpen }   // registration window
  if (r < Number(voteClose)) return { ...PHASES.voting,  deadline: voteClose }
  if (r < Number(tallyRound)) return { ...PHASES.frozen, deadline: tallyRound }
  return { ...PHASES.tallying, deadline: null }
}

// ── The one call the UI makes ───────────────────────────────────────────────────
//
// Returns everything the status strip needs. Resilient: any failing piece degrades
// to a sensible default rather than throwing, so a status strip never breaks a page.
export async function fetchCycleStatus() {
  const out = {
    poolMicro: 0,
    phase: PHASES.nominating,
    currentRound: 0,
    deadline: null,           // { round, label, date } or null
    nominationRound: null,
    epochId: 0,
    rawPhase: 0,
    ok: true,
  }

  // Current round (also used for countdowns).
  try {
    const st = await algodClient.status().do()
    out.currentRound = Number(st['last-round'] ?? st.lastRound ?? 0)
  } catch { /* leave 0 */ }

  // Governance state.
  let gov = null
  try {
    gov = await fetchGovState()   // { phase, epochId, winnerCount, paidCount, candidateCount } + rounds if present
    out.epochId = gov.epochId ?? 0
    out.rawPhase = gov.phase ?? 0
  } catch { out.ok = false }

  // Pool.
  try { out.poolMicro = Number(await fetchPool()) || 0 } catch { /* 0 */ }

  // Nomination round.
  try {
    const nr = await fetchNominationRound()
    out.nominationRound = nr?.round ?? null
  } catch { /* null */ }

  // Derive the human phase (needs the epoch window rounds; fetchGovState includes
  // them when available, else we treat as nominating).
  if (gov) {
    const ph = derivePhase({
      phase: gov.phase ?? 0,
      epochId: gov.epochId ?? 0,
      voteOpen: gov.voteOpen ?? 0,
      voteClose: gov.voteClose ?? 0,
      tallyRound: gov.tallyRound ?? 0,
    }, out.currentRound)
    out.phase = ph
    if (ph.deadline) {
      const cd = roundCountdown(ph.deadline, out.currentRound)
      out.deadline = { round: ph.deadline, label: cd.label, date: roundToDate(ph.deadline, out.currentRound) }
    }
  }

  return out
}
