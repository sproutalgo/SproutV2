import algosdk from 'algosdk'

// Token can be sent two ways depending on the provider:
//   • Default (Nodely/AlgoNode): algosdk sends the token as the `X-Algo-API-Token`
//     header. A bare string token (or empty for keyless) does this.
//   • Header-key providers (Tatum, NowNodes): the key goes in `x-api-key`. Set
//     ALGOD_TOKEN_HEADER=x-api-key and algosdk sends the token under that header
//     instead. This lets us switch providers with env vars, no code change.
function buildToken(tokenEnv, headerEnv) {
  const token = tokenEnv || ''
  const header = headerEnv || ''
  if (token && header) return { [header]: token }   // custom-header providers
  return token                                        // default X-Algo-API-Token (or keyless '')
}

// ─── Node-call counter ───────────────────────────────────────────────────────
// Ongoing visibility: count every algod request and log the rate once a minute, so a
// traffic spike (like the one that exhausted the free quota) is obvious in the logs
// immediately instead of being discovered only when the node starts 403ing. The count
// is incremented by the breakered helpers and by the sync job's fetchAndDecode — i.e.
// the two real call sites — via recordAlgodCall().
let _algodCallCount = 0
let _algodCallWindowStart = Date.now()
export function recordAlgodCall(n = 1) { _algodCallCount += n }

// Log the rate every 60s (only when non-zero, so idle periods stay quiet). unref() so
// this timer never keeps the process alive on its own.
const _callLogTimer = setInterval(() => {
  if (_algodCallCount > 0) {
    const secs = Math.max(1, (Date.now() - _algodCallWindowStart) / 1000)
    const perSec = (_algodCallCount / secs).toFixed(2)
    console.log(`[algod] ${_algodCallCount} node calls in last ${Math.round(secs)}s (${perSec}/s)`)
  }
  _algodCallCount = 0
  _algodCallWindowStart = Date.now()
}, 60_000)
if (_callLogTimer.unref) _callLogTimer.unref()

export const algodClient = new algosdk.Algodv2(
  buildToken(process.env.ALGOD_TOKEN, process.env.ALGOD_TOKEN_HEADER),
  process.env.ALGOD_SERVER || 'https://testnet-api.algonode.cloud',
  process.env.ALGOD_PORT   || ''
)

export const indexerClient = new algosdk.Indexer(
  buildToken(process.env.INDEXER_TOKEN, process.env.INDEXER_TOKEN_HEADER),
  process.env.INDEXER_SERVER || 'https://testnet-idx.algonode.cloud',
  process.env.INDEXER_PORT   || ''
)

export const ADMIN_ADDRESS = process.env.ADMIN_ADDRESS || ''

// ─── Cached current round + circuit breaker ──────────────────────────────────
// Per-request algod.status() calls (auth, health) were flooding the node and blowing
// past the free tier's daily quota, getting the whole IP 403'd. Two protections:
//
//  1. CACHE: the round advances ~every 2.8s, so one value on a short TTL serves all
//     callers — collapsing thousands of status() calls into a handful per minute.
//
//  2. CIRCUIT BREAKER: if a fetch FAILS (e.g. the node 403s us), we stop hitting the
//     node for a cooldown window. Without this, a cold cache under sustained failure
//     re-fetches on every call (the cache only throttles once it holds a good value),
//     so a flood of callers becomes a flood of node requests — exactly the runaway that
//     exhausted the quota. The breaker caps node attempts to ~one per cooldown no matter
//     how many callers arrive, so a bad provider can never be hammered.
const ROUND_TTL_MS      = 10_000   // serve a cached round for 10s between refreshes
const BREAKER_COOLDOWN_MS = 30_000 // after a failure, don't touch the node for 30s
let _roundCache = { round: 0, at: 0 }
let _roundInFlight = null
let _breakerUntil = 0              // timestamp until which the node is considered "open/failing"

/**
 * Current round, served from cache, guarded by a circuit breaker. Returns the last known
 * round (or 0) without touching the node while the breaker is tripped, so repeated
 * callers during an outage generate no node traffic.
 */
export async function getCurrentRound() {
  const now = Date.now()
  // Fresh cached value — serve it.
  if (now - _roundCache.at < ROUND_TTL_MS && _roundCache.round > 0) {
    return _roundCache.round
  }
  // Breaker tripped — do NOT hit the node; serve last known (may be 0).
  if (now < _breakerUntil) {
    return _roundCache.round
  }
  // Coalesce concurrent refreshes into one fetch.
  if (_roundInFlight) return _roundInFlight
  _roundInFlight = (async () => {
    try {
      recordAlgodCall()
      const status = await algodClient.status().do()
      const round = Number(status['last-round'] ?? status.lastRound ?? 0)
      if (round > 0) _roundCache = { round, at: Date.now() }
      _breakerUntil = 0            // success — clear the breaker
      return _roundCache.round
    } catch {
      // Failure — trip the breaker so we stop hammering a rejecting/broken node.
      _breakerUntil = Date.now() + BREAKER_COOLDOWN_MS
      return _roundCache.round     // serve last known (0 if never succeeded); never throw
    } finally {
      _roundInFlight = null
    }
  })()
  return _roundInFlight
}

/** Reachability check for /health, served from the round cache + breaker — a health
 *  poll never hits the node directly and never during a breaker cooldown. */
export async function algodHealthy() {
  const r = await getCurrentRound()
  return r > 0
}

/** True when the circuit breaker is currently tripped (a recent node call failed and
 *  we're in cooldown). Callers that make their OWN node requests — e.g. the sync job's
 *  per-app getApplicationByID — check this and skip entirely rather than firing a batch
 *  of doomed calls that burn quota. */
export function isNodeInCooldown() {
  return Date.now() < _breakerUntil
}

// ─── State decoders (mirrors frontend algorand.js) ───────────────────────────

function decodeKey(raw) {
  if (raw instanceof Uint8Array) return new TextDecoder().decode(raw)
  try { return atob(raw) } catch { return String(raw) }
}

export function decodeGlobalState(gs = []) {
  const result = {}
  for (const item of gs) {
    const key = decodeKey(item.key)
    const val = item.value
    const isBytes =
      val.type === 1 || val.type === 'bytes' ||
      (val.type !== 2 && val.bytes !== undefined && val.bytes !== null && val.bytes !== '')

    if (isBytes) {
      const raw = val.bytes
      let bytes = null
      if (raw instanceof Uint8Array) {
        bytes = raw
      } else if (typeof raw === 'string' && raw.length > 0) {
        try {
          const bin = atob(raw)
          bytes = new Uint8Array(bin.length)
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        } catch { bytes = null }
      }
      if (bytes && bytes.length === 32) {
        try { result[key] = algosdk.encodeAddress(bytes) } catch { result[key] = '' }
      } else if (bytes) {
        try { result[key] = new TextDecoder().decode(bytes) } catch { result[key] = '' }
      } else {
        result[key] = ''
      }
    } else {
      result[key] = Number(val.uint ?? 0)
    }
  }
  return result
}

/**
 * Fetch and decode an application's global state from algod.
 * Returns { gs, deleted } — gs is {} if the app is deleted.
 */
export async function fetchAppGlobalState(appId) {
  try {
    recordAlgodCall()
    const info = await algodClient.getApplicationByID(Number(appId)).do()
    const rawGs = info.params?.['global-state'] ?? info.params?.globalState ?? []
    const gs = decodeGlobalState(rawGs)
    return { gs, deleted: !!info.deleted }
  } catch {
    return { gs: {}, deleted: true }
  }
}

/**
 * Verify a signed message from an Algorand wallet.
 *
 * The frontend should call:
 *   const sig = await signTransactions([encodedAuthTxn])
 * and send { address, signature, message } to protected endpoints.
 *
 * For simplicity we verify by checking the address matches ADMIN_ADDRESS.
 * A fuller implementation would verify the Ed25519 signature.
 */
export function isAdminAddress(address) {
  return address && ADMIN_ADDRESS && address === ADMIN_ADDRESS
}

// ─── Cached account lookup (for auth: rekey/auth-addr) ────────────────────────
// Auth verification needs an account's auth-addr to validate rekeyed-wallet signatures.
// The auth-addr changes only when the user rekeys (rare), so a short per-address cache
// keeps auth from making a node call on every request. Respects the circuit breaker:
// during a node cooldown it returns the last cached value (or null), never hammering.
const ACCT_TTL_MS = 60_000
const _acctCache = new Map()   // address -> { data, at }

export async function fetchAccountCached(address) {
  const now = Date.now()
  const hit = _acctCache.get(address)
  if (hit && now - hit.at < ACCT_TTL_MS) return hit.data
  if (isNodeInCooldown()) return hit?.data ?? null   // breaker open — don't hit the node
  try {
    recordAlgodCall()
    const data = await algodClient.accountInformation(address).do()
    _acctCache.set(address, { data, at: Date.now() })
    return data
  } catch {
    // On failure, trip nothing extra here (getCurrentRound owns the breaker); serve
    // last-known if we have it, else null so the caller falls back to the sender key.
    return hit?.data ?? null
  }
}
