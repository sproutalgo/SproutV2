import algosdk from 'algosdk'
import nacl from 'tweetnacl'
import { ADMIN_ADDRESS, algodClient } from '../utils/algorand.js'

/**
 * Verify a dummy auth transaction signed by an Algorand wallet.
 *
 * The frontend builds a 0-ALGO self-payment with:
 *   note      = "algolaunch-auth:<resource>:<firstValid>"
 *   lastValid = firstValid + 1  (2-round window ~6 seconds)
 *   rekeyTo   = undefined / zero
 *
 * We verify (using algosdk v3 field names):
 *   1. Ed25519 signature via tweetnacl against "TX" + msgpack bytes
 *   2. rekeyTo is absent or zero address
 *   3. sender == receiver (self-payment)
 *   4. amount == 0
 *   5. note matches expected challenge string
 *   6. currentRound <= lastValid (within validity window)
 */
export async function verifyAuthTransaction({ address, signedTxnB64, firstValid, resource }) {
  try {
    // Decode base64 → Uint8Array
    const sigBin  = atob(signedTxnB64)
    const sigBytes = new Uint8Array(sigBin.length)
    for (let i = 0; i < sigBin.length; i++) sigBytes[i] = sigBin.charCodeAt(i)

    const stxn = algosdk.decodeSignedTransaction(sigBytes)
    const txn  = stxn.txn  // algosdk v3 Transaction instance

    // 1. Verify Ed25519 signature.
    //    Algorand signs: "TX" || msgpack(txn)
    //    txn.toByte() returns the raw msgpack bytes.
    const TX_TAG   = new TextEncoder().encode('TX')
    const rawTxn   = txn.toByte()
    const toVerify = new Uint8Array(TX_TAG.length + rawTxn.length)
    toVerify.set(TX_TAG, 0)
    toVerify.set(rawTxn, TX_TAG.length)

    const sig = stxn.sig
    if (!sig || sig.length !== 64) {
      return { ok: false, reason: 'Missing or malformed signature' }
    }
    // algosdk v3: sender is an Address instance with .publicKey Uint8Array
    const pubKey = txn.sender.publicKey
    const valid  = nacl.sign.detached.verify(toVerify, sig, pubKey)
    if (!valid) {
      return { ok: false, reason: 'Transaction signature invalid' }
    }

    // 2. rekeyTo must be absent or zero (prevent rekeying via auth txn)
    if (txn.rekeyTo) {
      const zeroAddr  = algosdk.encodeAddress(new Uint8Array(32))
      const rekeyAddr = algosdk.encodeAddress(txn.rekeyTo.publicKey)
      if (rekeyAddr !== zeroAddr) {
        return { ok: false, reason: 'rekeyTo must be zero address' }
      }
    }

    // 3. sender == receiver and amount == 0
    //    algosdk v3: PaymentTransaction has sender on txn and receiver in txn.payment
    const senderAddr   = algosdk.encodeAddress(txn.sender.publicKey)
    const paymentFields = txn.payment  // PaymentTransactionFields
    if (!paymentFields) {
      return { ok: false, reason: 'Transaction is not a payment transaction' }
    }
    const receiverAddr = algosdk.encodeAddress(paymentFields.receiver.publicKey)
    if (senderAddr !== address) {
      return { ok: false, reason: `Sender mismatch: got ${senderAddr}, expected ${address}` }
    }
    if (senderAddr !== receiverAddr) {
      return { ok: false, reason: 'Transaction must be a self-payment (sender == receiver)' }
    }
    if (Number(paymentFields.amount) !== 0) {
      return { ok: false, reason: 'Transaction amount must be 0' }
    }

    // 4. Note matches expected challenge
    const noteText     = txn.note ? new TextDecoder().decode(txn.note) : ''
    const expectedNote = `algolaunch-auth:${resource}:${firstValid}`
    if (noteText !== expectedNote) {
      return { ok: false, reason: `Note mismatch. Got: "${noteText}", expected: "${expectedNote}"` }
    }

    // 5. Within validity window
    const status       = await algodClient.status().do()
    const currentRound = Number(status['last-round'] ?? status.lastRound ?? 0)
    const lastValid    = Number(txn.lastValid)
    if (currentRound > lastValid) {
      return { ok: false, reason: `Auth transaction expired (current: ${currentRound}, lastValid: ${lastValid})` }
    }

    return { ok: true }
  } catch (e) {
    console.error('[auth] verifyAuthTransaction error:', e.message)
    return { ok: false, reason: e.message || 'Verification error' }
  }
}

/**
 * Build the canonical resource string used in the auth challenge note.
 * Must match exactly what the frontend produces in signAuthChallenge.
 *
 * Frontend:  path.replace(/^\//, '')          e.g. "projects/123/status"
 * Backend:  `projects${req.path}`.replace trailing slash
 *
 * Canonical form: "projects" + path-without-leading-slash, no trailing slash.
 * Examples:
 *   POST /api/projects           → "projects"
 *   PATCH /api/projects/123/status → "projects/123/status"
 *   POST /api/projects/admin/all   → "projects/admin/all"
 */
export function buildResourcePath(reqPath) {
  return (`projects${reqPath}`).replace(/\/$/, '')
}
export function requireSignature(req, res, next) {
  const address      = req.headers['x-algo-address']
  const signedTxnB64 = req.headers['x-algo-signed-txn']
  const firstValid   = req.headers['x-algo-first-valid']

  if (!address || !signedTxnB64 || !firstValid) {
    return res.status(401).json({
      error: 'Missing auth headers (x-algo-address, x-algo-signed-txn, x-algo-first-valid)',
    })
  }

  const resource = buildResourcePath(req.path)

  verifyAuthTransaction({ address, signedTxnB64, firstValid: Number(firstValid), resource })
    .then(result => {
      if (!result.ok) {
        return res.status(401).json({ error: `Auth failed: ${result.reason}` })
      }
      req.verifiedAddress = address
      next()
    })
    .catch(e => res.status(500).json({ error: e.message || 'Auth verification error' }))
}

/**
 * requireAdmin: verify signature AND address is the admin.
 */
export function requireAdmin(req, res, next) {
  requireSignature(req, res, () => {
    if (!ADMIN_ADDRESS) {
      return res.status(500).json({ error: 'ADMIN_ADDRESS not configured on server' })
    }
    if (req.verifiedAddress !== ADMIN_ADDRESS) {
      return res.status(403).json({ error: 'Not the admin address' })
    }
    next()
  })
}
