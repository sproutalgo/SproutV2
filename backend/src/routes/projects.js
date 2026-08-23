import { Router } from 'express'
import { requireAdmin, requireSignature } from '../middleware/auth.js'
import {
  getPublicProjects,
  getPublicStats,
  getAllProjects,
  getProjectsByCreator,
  getProject,
  createProject,
  updateProjectStatus,
  updateProjectMeta,
  setProjectHidden,
  setProjectFeatured,
  deleteProject,
} from '../services/projects.js'
import { fetchAppGlobalState, algodClient, ADMIN_ADDRESS } from '../utils/algorand.js'
import { syncSingleProject } from '../services/sync.js'

const router = Router()

/** Parse and validate an integer appId from route params. */
function parseAppId(raw) {
  const id = parseInt(raw, 10)
  if (isNaN(id) || id <= 0) throw Object.assign(new Error('Invalid appId'), { status: 400 })
  return id
}

// ─── Public reads ─────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  try {
    const page     = Math.max(1, parseInt(req.query.page     ?? '1',  10) || 1)
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize ?? '50', 10) || 50))
    const result = await getPublicProjects({ page, pageSize })
    res.json(result)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to fetch projects' })
  }
})

// Platform-wide aggregate stats for the homepage hero (all projects, not paginated).
// Declared before '/:appId' so "stats" isn't parsed as an appId.
router.get('/stats', async (req, res) => {
  try {
    const stats = await getPublicStats()
    res.json(stats)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to fetch stats' })
  }
})

router.get('/by-creator/:address', async (req, res) => {
  try {
    const projects = await getProjectsByCreator(req.params.address)
    res.json(projects)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to fetch creator projects' })
  }
})

router.post('/admin/all', async (req, res) => {
  try {
    const address = req.headers['x-algo-address']
    if (!ADMIN_ADDRESS || address !== ADMIN_ADDRESS) {
      return res.status(403).json({ error: 'Not the admin address' })
    }
    res.setHeader('Cache-Control', 'no-store')
    const projects = await getAllProjects()
    res.json(projects)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to fetch all projects' })
  }
})

router.get('/:appId', async (req, res) => {
  try {
    const appId = parseAppId(req.params.appId)
    const project = await getProject(appId)
    res.json(project)
  } catch (e) {
    if (e.status === 400) return res.status(400).json({ error: e.message })
    if (e.code === 'PGRST116') return res.status(404).json({ error: 'Project not found' })
    console.error(e)
    res.status(500).json({ error: 'Failed to fetch project' })
  }
})

// ─── Creator writes ───────────────────────────────────────────────────────────

/**
 * POST /api/projects
 * Register a newly deployed project.
 * Requires Ed25519 signature + on-chain creator verification.
 */
router.post('/', async (req, res) => {
  try {
    const address = req.headers['x-algo-address']
    if (!address) return res.status(400).json({ error: 'Missing x-algo-address header' })
    const {
      appId: rawAppId, name, tagline, description, category,
      websiteUrl, deckUrl, imageUrl, goalMicro, ratePerAlgo, algoPerBundle,
      highlights,
      isDonation, seriesId, milestoneNumber, milestoneTitle,
      milestoneDescription, plannedMilestones, seriesGoalMicro, isHidden,
    } = req.body

    const appId = parseAppId(rawAppId)

    if (!name) {
      return res.status(400).json({ error: 'Missing required field: name' })
    }

    // Verify the address matches the on-chain creator
    const { gs, deleted } = await fetchAppGlobalState(appId)
    if (deleted) return res.status(400).json({ error: 'App not found on chain' })
    if (gs.creator && gs.creator !== address) {
      return res.status(403).json({ error: 'Address does not match on-chain creator' })
    }

    // Derive token_name from algod — do not trust client-supplied value
    let tokenName = ''
    const asaId = Number(gs.asa_id ?? 0)
    if (asaId > 0) {
      try {
        const asset = await algodClient.getAssetByID(asaId).do()
        const p = asset.asset?.params ?? asset.params ?? asset
        tokenName = p['unit-name'] ?? p.unitName ?? ''
      } catch { /* asa not yet set — setup hasn't run */ }
    }

    const project = await createProject({
      appId, creatorAddress: address,
      name, tagline, description, category,
      websiteUrl, deckUrl, imageUrl, tokenName,
      goalMicro, ratePerAlgo, algoPerBundle, highlights,
      isDonation, seriesId, milestoneNumber, milestoneTitle,
      milestoneDescription, plannedMilestones, seriesGoalMicro, isHidden,
    })

    // Populate on_chain_* cache immediately so the explore and My Projects
    // pages show correct data without waiting for the next sync cycle.
    syncSingleProject(appId).catch(e =>
      console.error(`[sync] Post-registration sync failed for app ${appId}:`, e.message)
    )

    res.status(201).json(project)
  } catch (e) {
    if (e.status === 400) return res.status(400).json({ error: e.message })
    if (e.code === '23505') return res.status(409).json({ error: 'Project already registered' })
    console.error(e)
    res.status(e.status || 500).json({ error: e.message || 'Failed to create project' })
  }
})

/**
 * PATCH /api/projects/:appId/status
 * Update lifecycle flags. Requires signature; caller must be creator or admin.
 */
router.patch('/:appId/status', async (req, res) => {
  try {
    const appId   = parseAppId(req.params.appId)
    const address = req.headers['x-algo-address']
    const { flags } = req.body

    if (!address) return res.status(400).json({ error: 'Missing x-algo-address header' })
    if (!flags)   return res.status(400).json({ error: 'Missing flags' })

    const isAdmin = address === ADMIN_ADDRESS

    if (!isAdmin) {
      // Verify caller is on-chain creator — prevents spoofed address headers
      const { gs, deleted } = await fetchAppGlobalState(appId)
      if (deleted) return res.status(400).json({ error: 'App not found on chain' })
      if (!gs.creator || gs.creator !== address) {
        return res.status(403).json({ error: 'Not authorised — must be on-chain creator or admin' })
      }
    }

    const updated = await updateProjectStatus(appId, flags)
    res.json(updated)
  } catch (e) {
    if (e.status === 400) return res.status(400).json({ error: e.message })
    console.error(e)
    res.status(500).json({ error: e.message || 'Failed to update status' })
  }
})

/**
 * PATCH /api/projects/:appId/meta
 * Update display metadata. Derives token_name from algod — ignores client value.
 * Requires signature; caller must be creator or admin.
 */
router.patch('/:appId/meta', async (req, res) => {
  try {
    const appId   = parseAppId(req.params.appId)
    const address = req.headers['x-algo-address']
    const { meta } = req.body

    if (!address) return res.status(400).json({ error: 'Missing x-algo-address header' })
    if (!meta)    return res.status(400).json({ error: 'Missing meta' })

    const isAdmin = address === ADMIN_ADDRESS

    if (!isAdmin) {
      // Verify caller is on-chain creator — prevents spoofed address headers
      const { gs, deleted } = await fetchAppGlobalState(appId)
      if (deleted) return res.status(400).json({ error: 'App not found on chain' })
      if (!gs.creator || gs.creator !== address) {
        return res.status(403).json({ error: 'Not authorised — must be on-chain creator or admin' })
      }
    }

    // Derive token_name from algod if an ASA ID is provided
    const resolvedMeta = { ...meta }
    if (meta.asaId) {
      try {
        const asset = await algodClient.getAssetByID(Number(meta.asaId)).do()
        const p = asset.asset?.params ?? asset.params ?? asset
        resolvedMeta.tokenName = p['unit-name'] ?? p.unitName ?? meta.tokenName ?? ''
      } catch {
        return res.status(400).json({ error: `ASA ${meta.asaId} not found on-chain` })
      }
    }

    const updated = await updateProjectMeta(appId, resolvedMeta)

    // Refresh on-chain cache immediately — setup just completed so asa_id
    // is now set on-chain. Without this, My Projects shows "Needs setup"
    // until the next 2-minute sync cycle.
    syncSingleProject(appId).catch(e =>
      console.error(`[sync] Post-meta sync failed for app ${appId}:`, e.message)
    )

    res.json(updated)
  } catch (e) {
    if (e.status === 400) return res.status(400).json({ error: e.message })
    console.error(e)
    res.status(500).json({ error: 'Failed to update meta' })
  }
})

// ─── Admin ────────────────────────────────────────────────────────────────────

router.patch('/:appId/visibility', requireAdmin, async (req, res) => {
  try {
    const appId = parseAppId(req.params.appId)
    const { hidden } = req.body
    const project = await setProjectHidden(appId, hidden)
    res.json(project)
  } catch (e) {
    if (e.status === 400) return res.status(400).json({ error: e.message })
    console.error(e)
    res.status(500).json({ error: 'Failed to update visibility' })
  }
})

router.patch('/:appId/featured', requireAdmin, async (req, res) => {
  try {
    const appId = parseAppId(req.params.appId)
    const { featured, featureOrder } = req.body
    const project = await setProjectFeatured(appId, featured, featureOrder ?? 0)
    res.json(project)
  } catch (e) {
    if (e.status === 400) return res.status(400).json({ error: e.message })
    console.error(e)
    res.status(500).json({ error: 'Failed to update featured status' })
  }
})

router.delete('/:appId', requireAdmin, async (req, res) => {
  try {
    const appId = parseAppId(req.params.appId)
    const result = await deleteProject(appId)
    res.json(result)
  } catch (e) {
    if (e.status === 400) return res.status(400).json({ error: e.message })
    console.error(e)
    res.status(500).json({ error: 'Failed to delete project' })
  }
})

// Get all campaigns in a series by series_id
router.get('/series/:seriesId', async (req, res) => {
  try {
    const { seriesId } = req.params
    const { data, error } = await (await import('../utils/supabase.js')).supabasePublic
      .from('projects')
      .select('app_id, name, tagline, goal_micro, series_goal_micro, milestone_number, milestone_title, milestone_description, milestone_completed_at, is_funded, is_distributed, on_chain_raised, on_chain_funded_round, created_at')
      .eq('series_id', seriesId)
      .order('milestone_number', { ascending: true })
    if (error) throw error
    res.json(data ?? [])
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to fetch series' })
  }
})

// Mark a milestone as complete (creator only, signature verified)
router.patch('/:appId/milestone-complete', requireSignature, async (req, res) => {
  try {
    const appId   = parseAppId(req.params.appId)
    const address = req.verifiedAddress

    const { gs, deleted } = await fetchAppGlobalState(appId)
    if (deleted) return res.status(400).json({ error: 'App not found on chain' })
    if (!gs.creator || gs.creator !== address) {
      return res.status(403).json({ error: 'Not authorised — must be on-chain creator' })
    }

    const { supabase } = await import('../utils/supabase.js')
    const { data, error } = await supabase
      .from('projects')
      .update({ milestone_completed_at: new Date().toISOString() })
      .eq('app_id', Number(appId))
      .select()
      .single()
    if (error) throw error
    res.json(data)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to mark milestone complete' })
  }
})

export default router
