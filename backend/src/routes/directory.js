import { Router } from 'express'
import { requireAdminGeneric } from '../middleware/auth.js'
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

// POST /api/directory/submit — create a pending entry.
// NO signature required: the wallet is CONNECTED by the submitter but not
// cryptographically verified (we dropped the 0-ALGO signing challenge that was
// losing builders). The connected address is sent in the body and used for
// ownership. This is safe here because every submission is manually reviewed by
// an admin before going public — a spoofed address only produces queue spam,
// never a live listing.
router.post('/submit', async (req, res) => {
  try {
    const { walletAddress, name, tagline, description, category, websiteUrl, imageUrl, highlights } = req.body
    if (!walletAddress) return res.status(400).json({ error: 'Connect your wallet to submit' })
    const entry = await createEntry({
      walletAddress,
      name, tagline, description, category, websiteUrl, imageUrl, highlights,
    })
    res.json(entry)
  } catch (e) {
    console.error(e)
    res.status(400).json({ error: e.message || 'Failed to submit entry' })
  }
})

// PATCH /api/directory/:id — edit an existing entry (owner only, no signature).
// Ownership is checked by matching the connected walletAddress (from the body)
// against the entry's stored wallet_address. Not cryptographically proven — but
// edits re-enter admin review, so a spoofed edit only produces queue spam.
// Any edit resets the entry to 'pending' for re-approval.
router.patch('/:id', async (req, res) => {
  try {
    const { walletAddress, name, tagline, description, category, websiteUrl, imageUrl, highlights } = req.body
    if (!walletAddress) return res.status(400).json({ error: 'Connect your wallet to edit' })
    const entry = await updateEntry({
      id: req.params.id,
      walletAddress,
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
