import { Router } from 'express'
import { requireSignatureGeneric, requireAdminGeneric } from '../middleware/auth.js'
import {
  getTally, getMyVote, getTopN, getRoundResults,
  castVote, withdrawVote, resetTally, getCurrentRound,
} from '../services/nominations.js'

const router = Router()

// ─── Public reads ────────────────────────────────────────────────────────────

// GET /api/nominations/tally — the live public tally for the current round.
// Every approved project with its vote count, highest first.
router.get('/tally', async (req, res) => {
  try {
    const result = await getTally()
    res.json(result)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to fetch tally' })
  }
})

// GET /api/nominations/round — just the current round number (cheap poll).
router.get('/round', async (req, res) => {
  try {
    const round = await getCurrentRound()
    res.json({ round })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to fetch round' })
  }
})

// GET /api/nominations/my-vote/:address — what this wallet currently backs (or null).
router.get('/my-vote/:address', async (req, res) => {
  try {
    const vote = await getMyVote(req.params.address)
    res.json(vote)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to fetch vote' })
  }
})

// ─── Vote (wallet-signature verified) ──────────────────────────────────────────

// POST /api/nominations/vote — cast or change this wallet's vote. The voter is the
// VERIFIED signer (req.verifiedAddress), never taken from the body, so no wallet can
// vote as another.
router.post('/vote', requireSignatureGeneric, async (req, res) => {
  try {
    const { directoryEntryId } = req.body
    const vote = await castVote({
      walletAddress: req.verifiedAddress,
      directoryEntryId,
    })
    res.json(vote)
  } catch (e) {
    console.error(e)
    res.status(400).json({ error: e.message || 'Failed to cast vote' })
  }
})

// POST /api/nominations/withdraw — clear this wallet's vote for the current round.
router.post('/withdraw', requireSignatureGeneric, async (req, res) => {
  try {
    const result = await withdrawVote({ walletAddress: req.verifiedAddress })
    res.json(result)
  } catch (e) {
    console.error(e)
    res.status(400).json({ error: e.message || 'Failed to withdraw vote' })
  }
})

// ─── Admin ─────────────────────────────────────────────────────────────────────

// GET /api/nominations/admin/top — the top N (default 8) by votes, payout pre-resolved,
// for the admin to register on-chain.
router.get('/admin/top', requireAdminGeneric, async (req, res) => {
  try {
    const n = Math.min(20, Math.max(1, Number(req.query.n) || 8))
    const result = await getTopN(n)
    res.json(result)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to fetch shortlist' })
  }
})

// GET /api/nominations/admin/round/:n — the results of a PAST (or current) round, for
// history. Resets don't delete votes, so any round's standings are reconstructable.
router.get('/admin/round/:n', requireAdminGeneric, async (req, res) => {
  try {
    const n = Number(req.params.n)
    if (!Number.isInteger(n) || n < 1) return res.status(400).json({ error: 'invalid round' })
    const result = await getRoundResults(n)
    res.json(result)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to fetch round results' })
  }
})

// POST /api/nominations/admin/reset — start a fresh tally (bump the round). Call this
// when accepting a tally and opening a new on-chain epoch.
router.post('/admin/reset', requireAdminGeneric, async (req, res) => {
  try {
    const result = await resetTally({ adminAddress: req.verifiedAddress })
    console.log(`[nominations] round reset by ${req.verifiedAddress}: ` +
                `${result.previousRound} -> ${result.currentRound}`)
    res.json(result)
  } catch (e) {
    console.error(e)
    res.status(400).json({ error: e.message || 'Failed to reset tally' })
  }
})

export default router
