import { Router } from 'express'
import { supabase } from '../utils/supabase.js'
import { algodClient } from '../utils/algorand.js'

const router = Router()

router.get('/', async (req, res) => {
  const checks = { api: 'ok', db: 'unknown', algod: 'unknown' }

  // Check Supabase
  try {
    const { error } = await supabase.from('projects').select('app_id').limit(1)
    checks.db = error ? `error: ${error.message}` : 'ok'
  } catch (e) {
    checks.db = `error: ${e.message}`
  }

  // Check algod
  try {
    const status = await algodClient.status().do()
    checks.algod = status ? 'ok' : 'error'
  } catch (e) {
    checks.algod = `error: ${e.message}`
  }

  const healthy = checks.db === 'ok' && checks.algod === 'ok'
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'healthy' : 'degraded',
    checks,
    timestamp: new Date().toISOString(),
  })
})

export default router
