/**
 * syncJob.js — Cron scheduler for on-chain state sync
 *
 * Runs syncAllProjects() every 5 minutes (was 2). The cache only needs to be
 * fresh enough that explore/My-Projects pages aren't stale for long; 5 minutes is
 * plenty, and it cuts recurring algod calls by 60% to stay well inside a free node
 * quota. Override with SYNC_CRON if you ever need a different cadence.
 *
 * ROLLBACK: comment out startSyncJob() in backend/src/index.js.
 * No other changes needed — frontend falls back to algod automatically.
 */

import cron             from 'node-cron'
import { syncAllProjects } from '../services/sync.js'

// Default: every 5 minutes. Settable via env without a code change.
const SYNC_CRON = process.env.SYNC_CRON || '*/5 * * * *'

export function startSyncJob() {
  console.log(`[sync] Starting on-chain state sync job (cron: ${SYNC_CRON})`)

  // Run immediately on startup so cache is warm before first user request
  syncAllProjects().catch(e => console.error('[sync] Initial sync failed:', e.message))

  cron.schedule(SYNC_CRON, () => {
    syncAllProjects().catch(e => console.error('[sync] Scheduled sync failed:', e.message))
  })
}
