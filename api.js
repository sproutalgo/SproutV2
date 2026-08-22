/**
 * api.js — Sprout backend API client
 *
 * Auth strategy: all write endpoints require a cryptographic proof of key
 * ownership via a dummy 0-ALGO self-payment transaction signed by the wallet.
 * This works universally across Pera, Defly, and other Algorand wallets since
 * it uses the standard signTransactions API rather than wallet-specific signData.
 * The backend decodes the signed transaction, verifies the Ed25519 signature,
 * and checks the embedded resource note and validity window.
 */

import { signAuthChallenge } from './algorand'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api'

// ─── Core fetch wrapper ───────────────────────────────────────────────────────

async function apiFetch(path, options = {}) {
  const { headers: extraHeaders, body: rawBody, ...restOptions } = options

  const res = await fetch(`${API_BASE}${path}`, {
    ...restOptions,
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: rawBody !== undefined ? JSON.stringify(rawBody) : undefined,
  })

  const data = await res.json().catch(() => ({}))

  if (!res.ok) {
    throw new Error(data.error || `API error ${res.status}`)
  }
  return data
}

/**
 * Authenticated write request — signs a dummy 0-ALGO self-payment as a
 * cryptographic proof of key ownership, then sends the signed transaction
 * bytes and firstValid round as headers for the backend to verify.
 */
async function authFetch(path, options = {}, signTransactions, address) {
  const resource = path.replace(/^\//, '')
  const { signedTxnB64, firstValid } = await signAuthChallenge(signTransactions, address, resource)
  return apiFetch(path, {
    ...options,
    headers: {
      ...options.headers,
      'x-algo-address':    address,
      'x-algo-signed-txn': signedTxnB64,
      'x-algo-first-valid': String(firstValid),
    },
  })
}

// ─── Public reads ─────────────────────────────────────────────────────────────

/**
 * Fetch a page of public projects from Supabase, newest first.
 * Returns { projects, total, page, pageSize }.
 */
export async function fetchPublicProjects({ page = 1, pageSize = 50 } = {}) {
  return apiFetch(`/projects?page=${page}&pageSize=${pageSize}`)
}

/**
 * Fetch platform-wide aggregate stats for the homepage hero.
 * Returns { totalRaisedMicro, fundedCount } across all public projects.
 */
export async function fetchPublicStats() {
  return apiFetch('/projects/stats')
}

export async function fetchProjectMeta(appId) {
  return apiFetch(`/projects/${appId}`)
}

export async function fetchCreatorProjectsMeta(creatorAddress) {
  return apiFetch(`/projects/by-creator/${creatorAddress}`)
}

// ─── Creator writes ───────────────────────────────────────────────────────────

/**
 * Register a newly deployed campaign in Supabase.
 * No wallet signature required — the backend verifies the caller is the
 * on-chain creator by reading KEY_CREATOR from algod global state.
 */
export async function registerProject({ address, appId, meta }) {
  return apiFetch('/projects', {
    method: 'POST',
    headers: { 'x-algo-address': address },
    body: {
      appId,
      name:                 meta.name,
      tagline:              meta.tagline,
      description:          meta.description,
      category:             meta.category,
      websiteUrl:           meta.websiteUrl,
      tokenName:            meta.tokenName,
      goalMicro:            meta.goalMicro,
      ratePerAlgo:          meta.ratePerAlgo,
      algoPerBundle:        meta.algoPerBundle,
      highlights:           meta.highlights,
      isDonation:           meta.isDonation,
      seriesId:             meta.seriesId,
      seriesGoalMicro:      meta.seriesGoalMicro,
      milestoneNumber:      meta.milestoneNumber,
      milestoneTitle:       meta.milestoneTitle,
      milestoneDescription: meta.milestoneDescription,
      plannedMilestones:    meta.plannedMilestones,
    },
  })
}

/**
 * Update lifecycle flags after a successful on-chain operation.
 * No wallet signature required — the on-chain transaction already proved
 * identity. Address header is sent for server-side creator/admin check.
 */
export async function updateStatus({ address, appId, flags }) {
  return apiFetch(`/projects/${appId}/status`, {
    method: 'PATCH',
    headers: { 'x-algo-address': address },
    body: { flags },
  })
}

/**
 * Update display metadata (token_name etc).
 * No wallet signature required — backend derives token_name from algod anyway.
 */
export async function updateProjectMeta({ address, appId, meta }) {
  return apiFetch(`/projects/${appId}/meta`, {
    method: 'PATCH',
    headers: { 'x-algo-address': address },
    body: { meta },
  })
}

// ─── Admin writes ─────────────────────────────────────────────────────────────

/**
 * Fetch all projects for admin dashboard.
 * Read operation — no wallet signature required.
 * Address header used for server-side admin check.
 */
export async function fetchAllProjectsAdmin({ address }) {
  return apiFetch('/projects/admin/all', {
    method: 'POST',
    headers: { 'x-algo-address': address },
  })
}

export async function setVisibility({ address, appId, hidden, signTransactions }) {
  return authFetch(`/projects/${appId}/visibility`, {
    method: 'PATCH',
    body: { hidden },
  }, signTransactions, address)
}

export async function setFeatured({ address, appId, featured, featureOrder, signTransactions }) {
  return authFetch(`/projects/${appId}/featured`, {
    method: 'PATCH',
    body: { featured, featureOrder },
  }, signTransactions, address)
}

export async function purgeProject({ address, appId, signTransactions }) {
  return authFetch(`/projects/${appId}`, {
    method: 'DELETE',
  }, signTransactions, address)
}

export async function fetchSeries(seriesId) {
  return apiFetch(`/projects/series/${seriesId}`)
}

export async function fetchCreatorSeries(creatorAddress) {
  // Fetch creator's projects that belong to a series
  const projects = await fetchCreatorProjectsMeta(creatorAddress)
  const series = {}
  for (const p of projects) {
    if (p.series_id) {
      if (!series[p.series_id]) series[p.series_id] = []
      series[p.series_id].push(p)
    }
  }
  return series
}

export async function markMilestoneComplete({ address, appId, signTransactions }) {
  return authFetch(`/projects/${appId}/milestone-complete`, {
    method: 'PATCH',
  }, signTransactions, address)
}
