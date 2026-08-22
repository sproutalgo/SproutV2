/**
 * sync.js — On-chain state cache sync service
 *
 * Syncs global state from algod into Supabase on_chain_* columns.
 * The frontend uses these cached values instead of calling algod directly,
 * dramatically reducing algod requests at scale.
 *
 * ROLLBACK: comment out the startSyncJob() call in index.js.
 * The frontend automatically falls back to direct algod calls when
 * on_chain_* columns are null.
 *
 * Sync interval: every 2 minutes via node-cron.
 * Batch size: 10 concurrent algod calls to avoid rate limiting.
 */

import { supabase }               from '../utils/supabase.js'
import { algodClient, decodeGlobalState } from '../utils/algorand.js'

const BATCH_SIZE = 10

/**
 * Sync on-chain state for a single app ID.
 * Called inline after registerProject to populate cache immediately.
 */
export async function syncSingleProject(appId) {
  try {
    const result = await fetchAndDecode(appId)
    let currentRound = 0
    try {
      const status = await algodClient.status().do()
      currentRound = Number(status['last-round'] ?? status.lastRound ?? 0)
    } catch { /* non-critical */ }
    await upsertOnChain(appId, result, currentRound)
  } catch (e) {
    console.error(`[sync] Failed to sync app ${appId}:`, e.message)
  }
}

/**
 * Sync all non-closed projects.
 * Called by the cron job every 2 minutes.
 */
export async function syncAllProjects() {
  const started = Date.now()
  let synced = 0, failed = 0, deleted = 0

  try {
    // Fetch all projects that aren't marked deleted on-chain
    const { data: projects, error } = await supabase
      .from('projects')
      .select('app_id')
      .or('on_chain_deleted.is.null,on_chain_deleted.eq.false')

    if (error) throw error
    if (!projects?.length) return

    // Fetch current round ONCE per sync cycle — not per project
    let currentRound = 0
    try {
      const status = await algodClient.status().do()
      currentRound = Number(status['last-round'] ?? status.lastRound ?? 0)
    } catch (e) {
      console.warn('[sync] Could not fetch current round:', e.message)
    }

    // Process in batches to avoid overwhelming algod
    for (let i = 0; i < projects.length; i += BATCH_SIZE) {
      const batch = projects.slice(i, i + BATCH_SIZE)
      await Promise.all(batch.map(async ({ app_id }) => {
        try {
          const result = await fetchAndDecode(app_id)
          await upsertOnChain(app_id, result, currentRound)
          if (result.deleted) deleted++
          else synced++
        } catch (e) {
          console.error(`[sync] app ${app_id}: ${e.message}`)
          failed++
        }
      }))
    }

    const elapsed = ((Date.now() - started) / 1000).toFixed(1)
    console.log(`[sync] Complete — ${synced} synced, ${deleted} deleted, ${failed} failed (${elapsed}s)`)
  } catch (e) {
    console.error('[sync] Sync job error:', e.message)
  }
}

/**
 * Fetch global state from algod and decode it.
 * Returns { gs, deleted } — deleted=true if the app no longer exists.
 */
async function fetchAndDecode(appId) {
  try {
    const info   = await algodClient.getApplicationByID(Number(appId)).do()
    const rawGs  = info.params?.['global-state'] ?? info.params?.globalState ?? []
    const gs     = decodeGlobalState(rawGs)
    return { gs, deleted: false }
  } catch (e) {
    // 404 means the contract was deleted on-chain
    if (e?.status === 404 || e?.message?.includes('404') || e?.message?.includes('not found')) {
      return { gs: {}, deleted: true }
    }
    throw e
  }
}

/**
 * Write decoded global state into Supabase on_chain_* columns.
 * currentRound is fetched once per sync cycle and passed in.
 * Uses 50-round buffer before marking expired to avoid false positives.
 * Enforces mutual exclusivity on status flags before writing.
 */
async function upsertOnChain(appId, { gs, deleted }, currentRound = 0) {
  const fundedRound = Number(gs.funded_round ?? 0)
  const deadline    = Number(gs.deadline     ?? 0)
  const cancelled   = Boolean(Number(gs.cancelled ?? 0))

  // Detect failed campaigns conservatively — 50-round buffer prevents
  // marking live campaigns as expired due to sync timing at the boundary.
  const EXPIRED_BUFFER_ROUNDS = 50
  const isExpiredUnfunded = (
    !deleted && !fundedRound && !cancelled && deadline > 0 &&
    currentRound > 0 && currentRound > deadline + EXPIRED_BUFFER_ROUNDS
  )

  // Build status flag updates with mutual exclusivity enforcement
  const statusUpdate = {}
  if (cancelled)         statusUpdate.is_cancelled = true
  if (isExpiredUnfunded) {
    // Only set is_refunded if not already funded — guards against contradictory state
    if (!fundedRound) statusUpdate.is_refunded = true
  }

  // on_chain_raised is a HISTORICAL value: once a funded campaign's contract
  // is deleted on-chain, its raised amount can never be re-read. So on deletion
  // we PRESERVE the last-synced value (by omitting the field from the update)
  // rather than nulling it — this keeps completed campaigns counted in
  // cumulative totals. All other on_chain_* fields are operational state and
  // are still nulled on deletion. Note: syncAllProjects skips already-deleted
  // rows, so the preserved value is written exactly once and never overwritten.
  const update = {
    on_chain_funded_round:    deleted ? null : Number(gs.funded_round    ?? 0),
    on_chain_deadline:        deleted ? null : Number(gs.deadline        ?? 0),
    on_chain_asa_id:          deleted ? null : Number(gs.asa_id          ?? 0),
    on_chain_cancelled:       deleted ? null : cancelled,
    on_chain_creator_claimed: deleted ? null : Boolean(Number(gs.creator_claimed ?? 0)),
    on_chain_admin_fee_claimed: deleted ? null : Boolean(Number(gs.admin_fee_claimed ?? 0)),
    on_chain_admin_claimed:   deleted ? null : Boolean(Number(gs.admin_claimed   ?? 0)),
    on_chain_deleted:         deleted,
    on_chain_synced_at:       new Date().toISOString(),
    ...statusUpdate,
  }
  if (!deleted) {
    update.on_chain_raised = Number(gs.raised ?? 0)
  }

  const { error } = await supabase
    .from('projects')
    .update(update)
    .eq('app_id', Number(appId))

  if (error) throw error
}
