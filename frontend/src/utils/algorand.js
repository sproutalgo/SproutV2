import algosdk from 'algosdk'

// Default to testnet — change as needed
const ALGOD_SERVER = import.meta.env.VITE_ALGOD_SERVER || 'https://testnet-api.algonode.cloud'
const ALGOD_PORT   = import.meta.env.VITE_ALGOD_PORT   || ''
const ALGOD_TOKEN  = import.meta.env.VITE_ALGOD_TOKEN  || ''

const INDEXER_SERVER = import.meta.env.VITE_INDEXER_SERVER || 'https://testnet-idx.algonode.cloud'
const INDEXER_PORT   = import.meta.env.VITE_INDEXER_PORT   || ''
const INDEXER_TOKEN  = import.meta.env.VITE_INDEXER_TOKEN  || ''

export const algodClient   = new algosdk.Algodv2(ALGOD_TOKEN, ALGOD_SERVER, ALGOD_PORT)
export const indexerClient = new algosdk.Indexer(INDEXER_TOKEN, INDEXER_SERVER, INDEXER_PORT)

export const ADMIN_ADDRESS = import.meta.env.VITE_ADMIN_ADDRESS || ''

export const microToAlgo = (micro) => Number(micro) / 1_000_000
export const algoToMicro = (algo)  => Math.floor(Number(algo) * 1_000_000)

/**
 * Canonical ALGO display formatter — the single source of truth for how an
 * ALGO amount is rendered anywhere in the UI. Locale is pinned to 'en-US' so
 * output is identical regardless of the viewer's browser locale (a German
 * browser must never render 45 as "45.000", which reads as 45,000).
 *
 * @param {number|bigint} microAlgos  amount in microAlgos
 * @param {object} [opts]
 * @param {number}  [opts.decimals=2] fixed decimal places (ignored when compact)
 * @param {boolean} [opts.compact=false] abbreviate ≥1000 as "k" (stat tiles)
 */
export function formatAlgo(microAlgos, opts = {}) {
  // Back-compat: formatAlgo(micro, 2) — second arg was previously `decimals`.
  if (typeof opts === 'number') opts = { decimals: opts }
  const { decimals = 2, compact = false } = opts
  return formatAlgoAmount(microToAlgo(microAlgos), { decimals, compact })
}

/**
 * Same formatting rules as formatAlgo() but takes a WHOLE-ALGO value rather
 * than microAlgos. This backs the `fmtAlgo` helper re-exported from UI.jsx,
 * whose ~30 call sites pass already-divided ALGO. Keeping both entry points
 * means one formatting policy with two convenient signatures.
 */
export function formatAlgoAmount(algo, opts = {}) {
  if (typeof opts === 'number') opts = { decimals: opts }
  const { decimals = 2, compact = false, smart = false } = opts
  const n = typeof algo === 'bigint' ? Number(algo) : Number(algo) || 0

  if (compact && Math.abs(n) >= 1000) {
    // Whole thousands render cleanly (50k); otherwise one decimal (50.5k).
    const k = n / 1000
    return `${k.toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: n % 1000 === 0 ? 0 : 1,
    })}k`
  }

  // Smart decimals: no fractional digits when the value is whole; otherwise
  // show up to `decimals` places, trimming trailing zeros (15 -> "15",
  // 15.5 -> "15.5", 15.125 -> "15.125"). `decimals` is the maximum here.
  if (smart) {
    return n.toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: decimals,
    })
  }

  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/**
 * Shorten an Algorand address for display. Exported as shortAddr throughout
 * the codebase — shortAddress is an alias kept for any remaining imports.
 */
export function shortAddr(addr) {
  if (!addr) return ''
  if (addr instanceof Uint8Array) {
    try { addr = algosdk.encodeAddress(addr) } catch { return '[invalid]' }
  }
  const s = String(addr)
  if (s.length < 10) return s
  return `${s.slice(0, 6)}…${s.slice(-4)}`
}

/** @deprecated Use shortAddr */
export const shortAddress = shortAddr

export function progressPercent(raised, goal) {
  if (!goal) return 0
  return Math.min(100, Math.floor((Number(raised) / Number(goal)) * 100))
}

/**
 * Sign an auth challenge using a dummy 0-ALGO self-payment transaction.
 * Works with all Algorand wallets via the universal signTransactions API.
 *
 * Resource path canonical form (must match buildResourcePath in backend/middleware/auth.js):
 *   path.replace(/^\//, '')  →  "projects", "projects/123/status", etc.
 *
 * The note embedded in the transaction:
 *   "algolaunch-auth:<resource>:<firstValid>"
 *
 * @param {Function} signTransactions - from useWallet()
 * @param {string}   sender           - the user's Algorand address
 * @param {string}   resource         - canonical resource path (no leading slash)
 * @returns {{ signedTxnB64: string, firstValid: number }}
 */
export async function signAuthChallenge(signTransactions, sender, resource) {
  const sp = await algodClient.getTransactionParams().do()
  const firstValid = Number(sp.firstRound ?? sp['first-round'] ?? sp.firstValid ?? 0)

  const note = new TextEncoder().encode(`algolaunch-auth:${resource}:${firstValid}`)

  const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender,
    receiver:        sender,
    amount:          0,
    note,
    suggestedParams: {
      ...sp,
      flatFee:   true,
      fee:       0,
      firstRound: firstValid,
      lastRound:  firstValid + 1,
    },
  })

  const signed  = await signTransactions([txn.toByte()])
  const sigBytes = signed[0]
  const signedTxnB64 = btoa(String.fromCharCode(...sigBytes))
  return { signedTxnB64, firstValid }
}

// ---------------------------------------------------------------------------
// algosdk v3 returns objects whose fields are camelCase JS objects, not the
// old REST-JSON with base64 strings. Global/local state items look like:
//   { key: Uint8Array, value: { type: 1|2, bytes: Uint8Array, uint: bigint } }
// But when fetched via the REST client (not msgpack) they may still be
// base64 strings.  We handle both forms here.
// ---------------------------------------------------------------------------
function decodeKey(raw) {
  if (raw instanceof Uint8Array) return new TextDecoder().decode(raw)
  try { return atob(raw) } catch { return String(raw) }
}

export function decodeGlobalState(gs) {
  const result = {}
  for (const item of gs) {
    const key = decodeKey(item.key)
    const val = item.value

    const isBytes = val.type === 1 || val.type === 'bytes' ||
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
        try { result[key] = algosdk.encodeAddress(bytes) }
        catch { result[key] = '' }
      } else if (bytes) {
        try { result[key] = new TextDecoder().decode(bytes) }
        catch { result[key] = '' }
      } else {
        result[key] = ''
      }
    } else {
      result[key] = Number(val.uint ?? 0)
    }
  }
  return result
}

export async function fetchAppInfo(appId) {
  const info = await algodClient.getApplicationByID(Number(appId)).do()
  const rawGs = info.params?.['global-state'] ?? info.params?.globalState ?? []
  const gs = decodeGlobalState(rawGs)
  return { ...info, gs }
}

/**
 * Fetch on-chain state for all app IDs in the given array in parallel.
 * Used by the Supabase-first pagination in Home.jsx.
 * Returns a map of appId -> { gs, deleted }.
 */
/**
 * Build a gs-shaped object from Supabase on_chain_* columns.
 * Returns null if the cache is empty (all fields null) — caller falls back to algod.
 * This is the rollback-safe pattern: null cache → algod call, no code change needed.
 */
export function gsFromCache(meta) {
  if (!meta) return null
  // If synced_at is null, cache has never been populated — fall back to algod
  if (!meta.on_chain_synced_at) return null
  return {
    raised:          meta.on_chain_raised          ?? 0,
    funded_round:    meta.on_chain_funded_round    ?? 0,
    deadline:        meta.on_chain_deadline        ?? 0,
    asa_id:          meta.on_chain_asa_id          ?? 0,
    cancelled:       meta.on_chain_cancelled       ? 1 : 0,
    creator_claimed: meta.on_chain_creator_claimed ? 1 : 0,
    admin_fee_claimed: meta.on_chain_admin_fee_claimed ? 1 : 0,
    admin_claimed:   meta.on_chain_admin_claimed   ? 1 : 0,
    // Pass through fields that never change (written at creation, not synced)
    goal:            meta.goal_micro               ?? 0,
    rate:            meta.rate_per_algo            ?? 0,
  }
}

export async function fetchOnChainBatch(appIds) {
  const results = {}
  await Promise.all(appIds.map(async (id) => {
    try {
      const info = await algodClient.getApplicationByID(Number(id)).do()
      const rawGs = info.params?.['global-state'] ?? info.params?.globalState ?? []
      results[id] = { gs: decodeGlobalState(rawGs), deleted: !!info.deleted }
    } catch {
      results[id] = { gs: {}, deleted: true }
    }
  }))
  return results
}

/**
 * Fetch creator's projects from the indexer, including deleted apps.
 * Deleted apps are included so My Projects shows the full history.
 */
export async function fetchCreatorProjects(creatorAddress) {
  try {
    const result = await indexerClient
      .searchForApplications()
      .creator(creatorAddress)
      .includeAll(true)
      .do()
    const apps = result.applications || []
    const projects = []
    for (const app of apps) {
      try {
        const rawGs = app.params?.['global-state'] ?? app.params?.globalState ?? []
        const gs = decodeGlobalState(rawGs)
        if (gs.goal) {
          projects.push({ id: Number(app.id), gs, deleted: !!app.deleted })
        }
      } catch { /* skip */ }
    }
    return projects
  } catch (err) {
    console.error('fetchCreatorProjects error', err)
    return []
  }
}

export async function fetchLocalState(appId, address) {
  try {
    const info = await algodClient.accountApplicationInformation(address, Number(appId)).do()
    const localStateBlock =
      info['app-local-state'] ??
      info.appLocalState ??
      null

    if (!localStateBlock) return null

    const rawLs =
      localStateBlock['key-value'] ??
      localStateBlock.keyValue ??
      []

    const decoded = decodeGlobalState(rawLs)
    if (!('contrib' in decoded)) decoded.contrib = 0
    return decoded
  } catch (e) {
    return null
  }
}

/**
 * Fetch all accounts opted into an app.
 * Returns addresses from the indexer directly without per-account algod
 * verification. The contract itself rejects sweep/refund calls for accounts
 * with contrib == 0, so the indexer list is sufficient for the admin flow.
 */
export async function fetchInvestors(appId) {
  try {
    const acctResult = await indexerClient
      .searchAccounts()
      .applicationID(Number(appId))
      .do()
    const accounts = acctResult.accounts || []
    return accounts.map(a => a.address)
  } catch (err) {
    console.error('fetchInvestors error', err)
    return []
  }
}

/** Poll until txn confirmed, return confirmation object */
export async function waitForConfirmation(txId, maxRounds = 20) {
  const statusResp = await algodClient.status().do()
  let lastRound = Number(statusResp['last-round'] ?? statusResp.lastRound ?? 0)
  for (let i = 0; i < maxRounds; i++) {
    const pending = await algodClient.pendingTransactionInformation(txId).do()
    const confirmedRound = pending['confirmed-round'] ?? pending.confirmedRound ?? 0
    if (confirmedRound > 0) return pending
    await algodClient.statusAfterBlock(lastRound + 1).do()
    lastRound++
  }
  throw new Error(`Transaction ${txId} not confirmed after ${maxRounds} rounds (~${Math.round(maxRounds * 2.8)}s). Check the block explorer for status.`)
}

/**
 * Sign and broadcast a transaction group, then wait for confirmation.
 */
export async function signAndSend(signTransactions, encodedTxns) {
  const signed = await signTransactions(encodedTxns)
  const result = await algodClient.sendRawTransaction(signed).do()
  const txId = result.txid ?? result.txId
  if (!txId) throw new Error('sendRawTransaction returned no txid: ' + JSON.stringify(result))
  return waitForConfirmation(txId)
}

/**
 * Sign and broadcast a transaction group, then wait for confirmation of a
 * SPECIFIC transaction in the group (by txid).
 *
 * sendRawTransaction returns only the FIRST transaction's id. When the txn you
 * care about (e.g. the ApplicationCreate that yields application-index) is not
 * first in the group — as with ARC-4 method calls that place a pay/axfer arg
 * before the app call — use this and pass that txn's id so the returned
 * confirmation carries the fields you need.
 */
export async function signAndConfirmGroup(signTransactions, encodedTxns, confirmTxId) {
  const signed = await signTransactions(encodedTxns)
  const result = await algodClient.sendRawTransaction(signed).do()
  const firstTxId = result.txid ?? result.txId
  if (!firstTxId) throw new Error('sendRawTransaction returned no txid: ' + JSON.stringify(result))
  return waitForConfirmation(confirmTxId || firstTxId)
}
