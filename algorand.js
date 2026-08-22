import algosdk from 'algosdk'

export const algodClient = new algosdk.Algodv2(
  process.env.ALGOD_TOKEN  || '',
  process.env.ALGOD_SERVER || 'https://testnet-api.algonode.cloud',
  process.env.ALGOD_PORT   || ''
)

export const indexerClient = new algosdk.Indexer(
  process.env.INDEXER_TOKEN  || '',
  process.env.INDEXER_SERVER || 'https://testnet-idx.algonode.cloud',
  process.env.INDEXER_PORT   || ''
)

export const ADMIN_ADDRESS = process.env.ADMIN_ADDRESS || ''

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
