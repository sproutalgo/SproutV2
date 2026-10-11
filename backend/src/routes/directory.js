import { Router } from 'express'
import { requireSignatureGeneric, requireAdminGeneric } from '../middleware/auth.js'
import {
  getApprovedEntries, getEntry, getEntriesByWallet,
  getPendingEntries, createEntry, updateEntry, setEntryStatus,
} from '../services/directory.js'

const router = Router()

// ─── Public reads ────────────────────────────────────────────────────────────

// GET /api/directory — approved entries (public grid)
router.get('/', async (req, res) => {
  try {
    const page     = Math.max(1, Number(req.query.page) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 50))
    const result = await getApprovedEntries({ page, pageSize })
    res.json(result)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to fetch directory' })
  }
})

// GET /api/directory/by-wallet/:address — a poster's own entries (any status)
router.get('/by-wallet/:address', async (req, res) => {
  try {
    const entries = await getEntriesByWallet(req.params.address)
    res.json(entries)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to fetch entries' })
  }
})

// GET /api/directory/:id — a single entry
router.get('/:id', async (req, res) => {
  try {
    const entry = await getEntry(req.params.id)
    res.json(entry)
  } catch (e) {
    if (e.code === 'PGRST116') return res.status(404).json({ error: 'Entry not found' })
    console.error(e)
    res.status(500).json({ error: 'Failed to fetch entry' })
  }
})

// ─── Submit (wallet-signature verified) ──────────────────────────────────────

// POST /api/directory/submit — create a pending entry. The poster is the
// verified signer (req.verifiedAddress), never taken from the body.
router.post('/submit', requireSignatureGeneric, async (req, res) => {
  try {
    const { name, tagline, description, category, websiteUrl, imageUrl, highlights } = req.body
    const entry = await createEntry({
      walletAddress: req.verifiedAddress,
      name, tagline, description, category, websiteUrl, imageUrl, highlights,
    })
    res.json(entry)
  } catch (e) {
    console.error(e)
    res.status(400).json({ error: e.message || 'Failed to submit entry' })
  }
})

// PATCH /api/directory/:id — edit an existing entry (owner only, signature
// verified). Ownership is enforced in the service against the verified signer.
// Any edit resets the entry to 'pending' for re-approval.
router.patch('/:id', requireSignatureGeneric, async (req, res) => {
  try {
    const { name, tagline, description, category, websiteUrl, imageUrl, highlights } = req.body
    const entry = await updateEntry({
      id: req.params.id,
      walletAddress: req.verifiedAddress,
      name, tagline, description, category, websiteUrl, imageUrl, highlights,
    })
    res.json(entry)
  } catch (e) {
    console.error(e)
    res.status(e.status || 400).json({ error: e.message || 'Failed to update entry' })
  }
})

// ─── Admin moderation ────────────────────────────────────────────────────────

// GET /api/directory/admin/pending — review queue (admin only)
router.get('/admin/pending', requireAdminGeneric, async (req, res) => {
  try {
    const entries = await getPendingEntries()
    res.json(entries)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to fetch pending entries' })
  }
})

// PATCH /api/directory/admin/:id/status — approve or reject (admin only)
router.patch('/admin/:id/status', requireAdminGeneric, async (req, res) => {
  try {
    const { status } = req.body
    const entry = await setEntryStatus({
      id: req.params.id,
      status,
      adminAddress: req.verifiedAddress,
    })
    res.json(entry)
  } catch (e) {
    console.error(e)
    res.status(400).json({ error: e.message || 'Failed to update entry' })
  }
})

export default router
