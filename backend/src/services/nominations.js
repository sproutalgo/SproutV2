// nominations.js — community nomination voting (off-chain).
//
// One wallet = one vote = one directory project, changeable anytime, no gating.
// A ROUND COUNTER (nomination_state.current_round) implements "reset": every vote is
// stamped with the round it belongs to, the tally counts only the current round, and
// the admin reset bumps the counter (past votes stay as history). The unique constraint
// (wallet_address, round) makes "one vote per wallet" structural — a re-vote upserts the
// wallet's existing row for the current round rather than adding another.
//
// All writes use the service-role client (`supabase`); the public tally read can use the
// anon client (`supabasePublic`) since the data is public. The VOTER address always comes
// from the verified signature (req.verifiedAddress), never the request body.

import { supabase, supabasePublic } from '../utils/supabase.js'

// ─── Round state ──────────────────────────────────────────────────────────────

// The current nomination round number. Reads the singleton state row.
export async function getCurrentRound() {
  const { data, error } = await supabase
    .from('nomination_state')
    .select('current_round')
    .eq('id', 1)
    .single()
  if (error) throw error
  return Number(data.current_round)
}

// ─── Vote (verified wallet) ─────────────────────────────────────────────────

// Cast or change a wallet's vote for the current round. Upserts on (wallet_address,
// round) so a wallet has exactly one vote per round; voting again just rewrites the
// chosen project. Validates the project exists and is approved before accepting.
export async function castVote({ walletAddress, directoryEntryId }) {
  if (!walletAddress) throw new Error('walletAddress required')
  if (!directoryEntryId) throw new Error('directoryEntryId required')

  // The project must exist and be approved — you can't nominate a pending/rejected or
  // non-existent entry.
  const { data: entry, error: entryErr } = await supabase
    .from('directory_entries')
    .select('id, status')
    .eq('id', directoryEntryId)
    .single()
  if (entryErr || !entry) throw new Error('project not found')
  if (entry.status !== 'approved') throw new Error('project is not approved')

  const round = await getCurrentRound()
  const now = new Date().toISOString()

  const { data, error } = await supabase
    .from('nomination_votes')
    .upsert(
      {
        wallet_address: walletAddress,
        round,
        directory_entry_id: directoryEntryId,
        updated_at: now,
      },
      { onConflict: 'wallet_address,round' }
    )
    .select()
    .single()
  if (error) throw error
  return data
}

// Withdraw a wallet's vote for the current round (optional — the UI may let a voter
// clear their pick entirely rather than always backing someone).
export async function withdrawVote({ walletAddress }) {
  const round = await getCurrentRound()
  const { error } = await supabase
    .from('nomination_votes')
    .delete()
    .eq('wallet_address', walletAddress)
    .eq('round', round)
  if (error) throw error
  return { ok: true }
}

// What this wallet currently backs in the current round (null if it hasn't voted).
export async function getMyVote(walletAddress) {
  const round = await getCurrentRound()
  const { data, error } = await supabasePublic
    .from('nomination_votes')
    .select('directory_entry_id, updated_at')
    .eq('wallet_address', walletAddress)
    .eq('round', round)
    .maybeSingle()
  if (error) throw error
  return data ?? null
}

// ─── Public tally ─────────────────────────────────────────────────────────────

// The live tally for the current round: every approved project with its vote count,
// sorted highest first. Returns the round number too, so the UI can show "Round N".
// Projects with zero votes are included (count 0) so the full ballot is visible.
export async function getTally() {
  const round = await getCurrentRound()

  // All approved projects (the candidates). We return every one, even at 0 votes.
  // select('*') (not a fixed column list) so the query never fails if an optional
  // column like payout_address isn't present on this deployment — we pick fields with
  // fallbacks below. This mirrors the directory service's select('*') approach.
  const { data: entries, error: entriesErr } = await supabasePublic
    .from('directory_entries')
    .select('*')
    .eq('status', 'approved')
  if (entriesErr) throw entriesErr

  // All votes in the current round. Count them per project in JS (simple + portable;
  // the row counts here are small — one per voting wallet).
  const { data: votes, error: votesErr } = await supabasePublic
    .from('nomination_votes')
    .select('directory_entry_id')
    .eq('round', round)
  if (votesErr) throw votesErr

  const counts = new Map()
  for (const v of votes ?? []) {
    counts.set(v.directory_entry_id, (counts.get(v.directory_entry_id) || 0) + 1)
  }

  const tally = (entries ?? []).map((e) => ({
    directory_entry_id: e.id,
    name: e.name,
    tagline: e.tagline,
    candidate_number: e.candidate_number,
    payout_address: e.payout_address || e.wallet_address || null,
    votes: counts.get(e.id) || 0,
  }))

  tally.sort((a, b) => b.votes - a.votes || String(a.name).localeCompare(String(b.name)))

  const totalVotes = (votes ?? []).length
  return { round, totalVotes, tally }
}

// The admin's shortlist: the top N (default 8) projects by vote count in the current
// round, with the payout address pre-resolved so they can be registered on-chain.
export async function getTopN(n = 8) {
  const { round, tally } = await getTally()
  // Only include projects that actually received at least one vote.
  const top = tally.filter((t) => t.votes > 0).slice(0, n)
  return { round, top }
}

// ─── Admin reset ──────────────────────────────────────────────────────────────

// Start a fresh tally: bump the round counter. Past votes remain in nomination_votes
// stamped with the old round (history); the live tally, which filters on the current
// round, now shows an empty board. Atomic — a single counter update.
export async function resetTally({ adminAddress }) {
  const current = await getCurrentRound()
  const next = current + 1
  const { data, error } = await supabase
    .from('nomination_state')
    .update({ current_round: next, updated_at: new Date().toISOString() })
    .eq('id', 1)
    .select()
    .single()
  if (error) throw error
  // adminAddress is logged by the caller/route for audit; not stored on the row here.
  return { previousRound: current, currentRound: Number(data.current_round) }
}
