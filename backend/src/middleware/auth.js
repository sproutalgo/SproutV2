import algosdk from 'algosdk'
import nacl from 'tweetnacl'
import { ADMIN_ADDRESS, algodClient, getCurrentRound, fetchAccountCached } from '../utils/algorand.js'

// Alias so the verification reads naturally.
const fetchAccount = fetchAccountCached

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

    // 1. Verify the signature. Algorand signs "TX" || msgpack(txn); txn.toByte() gives
    //    the msgpack bytes. The signing KEY is NOT always the sender's own key:
    //      • plain account  → signed by the sender's key (stxn.sig vs sender.publicKey)
    //      • REKEYED account → signed by the account's auth-addr key, which differs from
    //        the sender. Verifying against sender.publicKey wrongly rejects these — the
    //        cause of "signature invalid" for users who have rekeyed their wallet.
    //      • MULTISIG        → signature lives in stxn.msig, not stxn.sig.
    //    We handle all three, and log the specific reason so failures are diagnosable.
    const TX_TAG   = new TextEncoder().encode('TX')
    const rawTxn   = txn.toByte()
    const toVerify = new Uint8Array(TX_TAG.length + rawTxn.length)
    toVerify.set(TX_TAG, 0)
    toVerify.set(rawTxn, TX_TAG.length)

    const senderAddrEarly = algosdk.encodeAddress(txn.sender.publicKey)

    if (stxn.sig) {
      // Single-signature. The signer's key is the account's auth-addr if rekeyed, else
      // the sender's own key. Fetch the on-chain auth-addr and verify against it.
      const sig = stxn.sig
      if (sig.length !== 64) {
        return { ok: false, reason: 'Malformed signature (wrong length)' }
      }

      let signerPubKey = txn.sender.publicKey
      let authAddr = null
      try {
        const acct = await fetchAccount(senderAddrEarly)
        // The auth-addr (set when an account is rekeyed) comes back under different keys
        // depending on the provider / algosdk version: 'auth-addr' (algod REST JSON),
        // 'authAddr' (camelCase), or 'auth-address'. Normalize across all of them.
        const raw = acct?.['auth-addr'] ?? acct?.authAddr ?? acct?.['auth-address'] ?? null
        // The value may already be a string address, OR an Address instance / byte array
        // (algosdk-decoded). Coerce to a string address.
        if (raw) {
          if (typeof raw === 'string') authAddr = raw
          else if (raw.publicKey) authAddr = algosdk.encodeAddress(raw.publicKey)
          else if (raw instanceof Uint8Array && raw.length === 32) authAddr = algosdk.encodeAddress(raw)
          else authAddr = String(raw)
        }
        if (authAddr) signerPubKey = algosdk.decodeAddress(authAddr).publicKey
      } catch (e) {
        console.warn(`[auth] auth-addr lookup failed for ${senderAddrEarly}: ${e.message}`)
        // Fall back to the sender key — a non-rekeyed account still verifies correctly.
      }

      let valid = nacl.sign.detached.verify(toVerify, sig, signerPubKey)
      // If verification against the auth-addr fails, try the sender's own key too (in case
      // the lookup was stale or the account un-rekeyed since) — belt and suspenders.
      if (!valid && authAddr) {
        valid = nacl.sign.detached.verify(toVerify, sig, txn.sender.publicKey)
      }
      if (!valid) {
        console.warn(`[auth] sig invalid for ${senderAddrEarly} — authAddr=${authAddr || '(none found)'}`)
        return { ok: false, reason: 'Transaction signature invalid' }
      }
    } else if (stxn.msig) {
      // Multisig: verify that a threshold of the listed subsignatures are valid over the
      // transaction bytes. Reconstruct the multisig address and confirm it matches the
      // sender (so the msig actually controls the account), then count valid subsigs.
      const msig = stxn.msig
      const version = Number(msig.v ?? msig.version)
      const threshold = Number(msig.thr ?? msig.threshold)
      const subsigs = msig.subsig ?? msig.subsigs ?? []
      const pks = subsigs.map(s => s.pk ?? s.pubkey)
      try {
        const mparams = { version, threshold, addrs: pks.map(pk => algosdk.encodeAddress(pk)) }
        const msigAddr = algosdk.multisigAddress(mparams)
        // The controlling address is the auth-addr if rekeyed, else the sender.
        let controller = senderAddrEarly
        try {
          const acct = await fetchAccount(senderAddrEarly)
          const authAddr = acct?.['auth-addr'] ?? acct?.authAddr
          if (authAddr) controller = authAddr
        } catch { /* fall back to sender */ }
        if (msigAddr !== controller) {
          return { ok: false, reason: 'Multisig address does not control the account' }
        }
      } catch (e) {
        return { ok: false, reason: `Multisig verification error: ${e.message}` }
      }
      let validCount = 0
      for (const s of subsigs) {
        const subSig = s.s ?? s.sig
        const pk = s.pk ?? s.pubkey
        if (subSig && subSig.length === 64 && nacl.sign.detached.verify(toVerify, subSig, pk)) {
          validCount++
        }
      }
      if (validCount < threshold) {
        console.warn(`[auth] multisig threshold not met for ${senderAddrEarly}: ${validCount}/${threshold}`)
        return { ok: false, reason: 'Multisig signature threshold not met' }
      }
    } else {
      // Logic-sig or no signature — not supported for wallet auth.
      return { ok: false, reason: 'Unsupported signature type (expected single or multisig)' }
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

    // 5. Within validity window. Use the cached round (not a per-request status() call,
    // which previously hammered the node on every authenticated request).
    const currentRound = await getCurrentRound()
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

/**
 * Resource path for ANY router mount, matching the frontend's
 * `path.replace(/^\//, '')`. Derives the resource from the full mounted URL
 * minus the leading "/api/", so:
 *   /api/projects/123/status  → "projects/123/status"
 *   /api/directory/submit     → "directory/submit"
 * Use this for routers other than the legacy projects router.
 */
export function buildResourcePathFromReq(req) {
  return (`${req.baseUrl}${req.path}`).replace(/^\/api\//, '').replace(/\/$/, '')
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

/**
 * Generic signature middleware for routers other than the legacy projects router.
 * Identical to requireSignature but derives the resource from the full mounted
 * URL (via buildResourcePathFromReq) so it works under any mount, e.g. /directory.
 */
export function requireSignatureGeneric(req, res, next) {
  const address      = req.headers['x-algo-address']
  const signedTxnB64 = req.headers['x-algo-signed-txn']
  const firstValid   = req.headers['x-algo-first-valid']

  if (!address || !signedTxnB64 || !firstValid) {
    return res.status(401).json({
      error: 'Missing auth headers (x-algo-address, x-algo-signed-txn, x-algo-first-valid)',
    })
  }

  const resource = buildResourcePathFromReq(req)

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
 * Generic admin middleware (generic signature + admin-address check).
 */
export function requireAdminGeneric(req, res, next) {
  requireSignatureGeneric(req, res, () => {
    if (!ADMIN_ADDRESS) {
      return res.status(500).json({ error: 'ADMIN_ADDRESS not configured on server' })
    }
    if (req.verifiedAddress !== ADMIN_ADDRESS) {
      return res.status(403).json({ error: 'Not the admin address' })
    }
    next()
  })
}