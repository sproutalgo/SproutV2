/**
 * syncJob.js — Cron scheduler for on-chain state sync
 *
 * Runs syncAllProjects() every 2 minutes.
 *
 * ROLLBACK: comment out startSyncJob() in backend/src/index.js.
 * No other changes needed — frontend falls back to algod automatically.
 */

import cron             from 'node-cron'
import { syncAllProjects } from '../services/sync.js'

export function startSyncJob() {
  console.log('[sync] Starting on-chain state sync job (every 2 minutes)')

  // Run immediately on startup so cache is warm before first user request
  syncAllProjects().catch(e => console.error('[sync] Initial sync failed:', e.message))

  // Then every 2 minutes: "*/2 * * * *"
  cron.schedule('*/2 * * * *', () => {
    syncAllProjects().catch(e => console.error('[sync] Scheduled sync failed:', e.message))
  })
}
