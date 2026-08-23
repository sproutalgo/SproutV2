import { supabase, supabasePublic } from '../utils/supabase.js'

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Get all projects visible on the Explore page:
 * - not hidden
 * - not refunded
 * - either distributed (contract deleted) or has been set up (asa_id known)
 *
 * Cancelled projects ARE included so investors can find them and claim refunds.
 * The frontend renders them with a cancelled badge and excludes them from
 * category filters, showing them only under "All" and "Cancelled".
 *
 * Note: asa_id lives on-chain; the backend doesn't store it.
 * The frontend merges on-chain data with metadata from this API.
 * Filtering for "set up" projects is done by the frontend after the merge.
 */
/**
 * Get a page of projects visible on the Explore page, newest first.
 * Returns { projects, total, page, pageSize }.
 * Includes refunded/failed campaigns so investors can find them to claim refunds.
 * Only excludes hidden projects and distributed ones (fully closed, nothing left to do).
 */
export async function getPublicProjects({ page = 1, pageSize = 50 } = {}) {
  const from = (page - 1) * pageSize
  const to   = from + pageSize - 1

  const { data, error, count } = await supabasePublic
    .from('projects')
    .select('*', { count: 'exact' })
    .or('is_hidden.is.null,is_hidden.eq.false')
    .order('created_at', { ascending: false })
    .range(from, to)

  if (error) throw error
  return { projects: data ?? [], total: count ?? 0, page, pageSize }
}

/**
 * Platform-wide aggregate stats for the homepage hero, computed across ALL
 * public projects (not just the first page). Sums on_chain_raised and counts
 * funded/distributed campaigns. Excludes hidden and on-chain-deleted rows.
 * Returns { totalRaisedMicro, fundedCount }.
 */
export async function getPublicStats() {
  // Note: we intentionally do NOT filter on on_chain_deleted here.
  // A successfully funded campaign's contract is typically closed/deleted
  // on-chain after distribution, so on_chain_deleted=true is the signature
  // of success — those rows must be counted in the traction totals.
  // Hidden rows are still excluded (admin-hidden = intentionally suppressed).
  const { data, error } = await supabasePublic
    .from('projects')
    .select('on_chain_raised, is_funded, is_distributed')
    .or('is_hidden.is.null,is_hidden.eq.false')

  if (error) throw error

  let totalRaisedMicro = 0
  let fundedCount = 0
  for (const p of data ?? []) {
    totalRaisedMicro += Number(p.on_chain_raised ?? 0)
    if (p.is_funded || p.is_distributed) fundedCount += 1
  }

  return { totalRaisedMicro, fundedCount }
}

/**
 * Get all projects regardless of status — for the admin dashboard.
 */
export async function getAllProjects() {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw error
  return data ?? []
}

/**
 * Get projects created by a specific address — for My Projects page.
 */
export async function getProjectsByCreator(creatorAddress) {
  const { data, error } = await supabasePublic
    .from('projects')
    .select('*')
    .eq('creator_address', creatorAddress)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data ?? []
}

/**
 * Get a single project by app ID.
 */
export async function getProject(appId) {
  const { data, error } = await supabasePublic
    .from('projects')
    .select('*')
    .eq('app_id', Number(appId))
    .single()

  if (error) throw error
  return data ?? []
}

// ─── Write ────────────────────────────────────────────────────────────────────

const ALLOWED_WEBSITE_DOMAINS = ['x.com', 'twitter.com', 'github.com', 'linkedin.com']

function validateWebsiteUrl(url) {
  if (!url) return null
  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) return 'URL must use http or https'
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
    if (!ALLOWED_WEBSITE_DOMAINS.includes(host)) {
      return `Website must be from one of: ${ALLOWED_WEBSITE_DOMAINS.join(', ')}`
    }
    return null
  } catch {
    return 'Invalid URL format'
  }
}

/**
 * Create a new project record at deployment time.
 * Length limits enforced here match the frontend maxLength attributes.
 */
export async function createProject({
  appId,
  creatorAddress,
  name,
  tagline,
  description,
  category,
  websiteUrl,
  deckUrl,
  imageUrl,
  tokenName,
  goalMicro,
  ratePerAlgo,
  algoPerBundle,
  highlights,
  isDonation,
  seriesId,
  milestoneNumber,
  milestoneTitle,
  milestoneDescription,
  plannedMilestones,
  seriesGoalMicro,
  isHidden,
}) {
  if (!name || String(name).trim().length === 0) throw new Error('name is required')
  if (String(name).length > 60)          throw new Error('name exceeds 60 characters')
  if (String(tagline || '').length > 120) throw new Error('tagline exceeds 120 characters')
  if (String(description || '').length > 5000) throw new Error('description exceeds 5000 characters')
  if (String(websiteUrl || '').length > 200)   throw new Error('websiteUrl exceeds 200 characters')
  const urlError = validateWebsiteUrl(websiteUrl)
  if (urlError) throw new Error(urlError)

  // Highlights: up to 3 scannable reasons, each ≤ 500 chars.
  if (highlights != null) {
    if (!Array.isArray(highlights)) throw new Error('highlights must be a list')
    if (highlights.length > 3) throw new Error('highlights cannot exceed 3 items')
    for (const h of highlights) {
      if (String(h || '').length > 500) throw new Error('each highlight exceeds 500 characters')
    }
  }
  // Milestone fields (series campaigns).
  if (String(milestoneTitle || '').length > 80) throw new Error('milestone title exceeds 80 characters')
  if (String(milestoneDescription || '').length > 500) throw new Error('milestone description exceeds 500 characters')
  // Planned future milestones: up to 4, each title ≤ 80 chars (+ optional short desc).
  if (plannedMilestones != null) {
    if (!Array.isArray(plannedMilestones)) throw new Error('plannedMilestones must be a list')
    if (plannedMilestones.length > 4) throw new Error('plannedMilestones cannot exceed 4 items')
    for (const m of plannedMilestones) {
      if (String(m?.title || '').length > 80) throw new Error('each planned milestone title exceeds 80 characters')
      if (String(m?.description || '').length > 500) throw new Error('each planned milestone description exceeds 500 characters')
    }
  }

  // Series total goal: only meaningful for series members, must be a sane
  // positive integer at least as large as this campaign's own goal.
  let seriesGoal = null
  if (seriesGoalMicro != null && seriesGoalMicro !== '') {
    seriesGoal = Number(seriesGoalMicro)
    if (!Number.isFinite(seriesGoal) || seriesGoal <= 0) throw new Error('seriesGoalMicro must be a positive number')
    if (!seriesId) throw new Error('seriesGoalMicro requires the campaign to be part of a series')
    if (Number(goalMicro) > 0 && seriesGoal < Number(goalMicro)) {
      throw new Error('seriesGoalMicro cannot be smaller than this campaign\'s own goal')
    }
    seriesGoal = Math.round(seriesGoal)
  }

  const { data, error } = await supabase
    .from('projects')
    // Upsert (not insert) so registration is idempotent: donation campaigns now
    // register at deploy AND again after funding, and a creator may re-run
    // registration. Conflicting on app_id updates the existing row instead of
    // failing on a duplicate key.
    .upsert({
      app_id:               Number(appId),
      creator_address:      creatorAddress,
      name:                 String(name).slice(0, 60),
      tagline:              String(tagline    || '').slice(0, 120),
      description:          String(description || '').slice(0, 5000),
      category:             category   || 'Other',
      website_url:          String(websiteUrl || '').slice(0, 200),
      deck_url:             deckUrl    || '',
      image_url:            imageUrl   || '',
      token_name:           tokenName  || '',
      goal_micro:           Number(goalMicro),
      rate_per_algo:        Number(ratePerAlgo),
      algo_per_bundle:      algoPerBundle != null ? Number(algoPerBundle) : 1,
      is_donation:          Boolean(isDonation),
      is_hidden:            Boolean(isHidden),
      highlights:           Array.isArray(highlights)
                              ? highlights.slice(0, 3).map(h => String(h || '').slice(0, 500))
                              : null,
      series_id:            seriesId || null,
      series_goal_micro:    seriesGoal,
      milestone_number:     milestoneNumber ? Number(milestoneNumber) : null,
      milestone_title:      milestoneTitle ? String(milestoneTitle).slice(0, 80) : null,
      milestone_description: milestoneDescription ? String(milestoneDescription).slice(0, 500) : null,
      planned_milestones:   Array.isArray(plannedMilestones)
                              ? plannedMilestones.slice(0, 4).map(m => ({
                                  title:       String(m?.title || '').slice(0, 80),
                                  description: String(m?.description || '').slice(0, 500),
                                }))
                              : null,
    }, { onConflict: 'app_id' })
    .select()
    .single()

  if (error) throw error
  return data ?? []
}

/**
 * Update display metadata fields (e.g. token_name from on-chain ASA).
 * Only whitelisted fields are updated.
 */
export async function updateProjectMeta(appId, meta) {
  const allowed = ['token_name']
  const update = {}
  if (meta.tokenName !== undefined) update.token_name = String(meta.tokenName).slice(0, 8)

  if (Object.keys(update).length === 0) return

  const { data, error } = await supabase
    .from('projects')
    .update(update)
    .eq('app_id', Number(appId))
    .select()
    .single()

  if (error) throw error
  return data ?? []
}

/**
 * Update lifecycle flags — funded, distributed, refunded, cancelled.
 * Enforces mutual exclusivity: distributed and refunded/cancelled cannot
 * coexist; funded and refunded/cancelled cannot coexist.
 */
export async function updateProjectStatus(appId, flags) {
  const allowed = ['is_funded', 'is_distributed', 'is_refunded', 'is_cancelled']
  const update = {}
  for (const key of allowed) {
    if (key in flags) update[key] = Boolean(flags[key])
  }

  if (Object.keys(update).length === 0) return

  // Mutual exclusivity checks
  const setting = (k) => update[k] === true
  if (setting('is_distributed') && (setting('is_refunded') || setting('is_cancelled'))) {
    throw new Error('is_distributed cannot be set alongside is_refunded or is_cancelled')
  }
  if (setting('is_funded') && setting('is_refunded')) {
    throw new Error('is_funded and is_refunded cannot both be set true')
  }

  const { data, error } = await supabase
    .from('projects')
    .update(update)
    .eq('app_id', Number(appId))
    .select()
    .single()

  if (error) throw error
  return data ?? []
}

/**
 * Admin: set or unset a project as featured in the hero art.
 * feature_order controls position (1, 2, 3).
 */
export async function setProjectFeatured(appId, featured, featureOrder = 0) {
  const { data, error } = await supabase
    .from('projects')
    .update({ is_featured: Boolean(featured), feature_order: featured ? Number(featureOrder) : 0 })
    .eq('app_id', Number(appId))
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * Admin: hide or unhide a project from the Explore page.
 */
export async function setProjectHidden(appId, hidden) {
  const { data, error } = await supabase
    .from('projects')
    .update({ is_hidden: Boolean(hidden) })
    .eq('app_id', Number(appId))
    .select()
    .single()

  if (error) throw error
  return data ?? []
}

/**
 * Admin: permanently delete a project record from the database.
 * Use only after the contract is fully closed and the project has
 * been hidden for a suitable period.
 */
export async function deleteProject(appId) {
  const { error } = await supabase
    .from('projects')
    .delete()
    .eq('app_id', Number(appId))

  if (error) throw error
  return { deleted: true, appId: Number(appId) }
}
