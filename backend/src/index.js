import 'dotenv/config'
import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import rateLimit from 'express-rate-limit'

import projectsRouter from './routes/projects.js'
import healthRouter   from './routes/health.js'
import { startSyncJob } from './jobs/syncJob.js'

const app  = express()
const PORT = process.env.PORT || 3001

// ─── Security headers ─────────────────────────────────────────────────────────
app.use(helmet())

// ─── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map(o => o.trim())

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (server-to-server, health checks)
    if (!origin) return cb(null, true)
    if (allowedOrigins.includes(origin)) return cb(null, true)
    cb(new Error(`CORS: origin ${origin} not allowed`))
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'x-algo-address',
    'x-algo-signed-txn',
    'x-algo-first-valid',
  ],
}))

// ─── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '256kb' }))

// ─── Rate limiting ────────────────────────────────────────────────────────────
// Global limiter — 200 requests per minute per IP
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again shortly.' },
}))

// Stricter limiter for write operations
const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'Too many write requests, please try again shortly.' },
})
app.use('/api/projects', (req, res, next) => {
  if (['POST', 'PATCH', 'DELETE'].includes(req.method)) return writeLimiter(req, res, next)
  next()
})

// ─── Header size guard ────────────────────────────────────────────────────────
// A base64-encoded signed Algorand transaction is ~400 bytes at most.
// Reject anything significantly larger to prevent memory exhaustion attacks.
const MAX_SIGNED_TXN_HEADER_BYTES = 4096
app.use((req, res, next) => {
  const signedTxn = req.headers['x-algo-signed-txn']
  if (signedTxn && signedTxn.length > MAX_SIGNED_TXN_HEADER_BYTES) {
    return res.status(400).json({ error: 'x-algo-signed-txn header exceeds maximum allowed size' })
  }
  next()
})

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/health',   healthRouter)
app.use('/api/projects', projectsRouter)

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` })
})

// Global error handler
app.use((err, req, res, next) => {
  console.error(err)
  res.status(500).json({ error: err.message || 'Internal server error' })
})

app.listen(PORT, () => {
  console.log(`✦ Sprout API running on port ${PORT}`)
  console.log(`  Health:   http://localhost:${PORT}/api/health`)
  console.log(`  Projects: http://localhost:${PORT}/api/projects`)
  // ─── Start on-chain state sync job ─────────────────────────────────────────
  // ROLLBACK: comment out the line below. Frontend falls back to algod automatically.
  startSyncJob()
})
