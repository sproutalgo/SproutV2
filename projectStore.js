/**
 * Off-chain project metadata store.
 * Maps appId -> { name, tagline, description, category, websiteUrl, deckUrl, imageUrl, tokenName, createdAt }
 *
 * In a real app this would be a backend API / IPFS. For this demo we use localStorage.
 */

const STORE_KEY = 'algolaunch_projects'

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || '{}')
  } catch {
    return {}
  }
}

function save(data) {
  localStorage.setItem(STORE_KEY, JSON.stringify(data))
}

export function saveProjectMeta(appId, meta) {
  const store = load()
  store[String(appId)] = { ...meta, updatedAt: Date.now() }
  save(store)
}

export function markProjectCancelled(appId) {
  const store = load()
  if (store[String(appId)]) {
    store[String(appId)].cancelledLocally = true
    store[String(appId)].updatedAt = Date.now()
    save(store)
  }
}

export function markProjectRefunded(appId) {
  const store = load()
  if (store[String(appId)]) {
    store[String(appId)].refundedLocally = true
    store[String(appId)].updatedAt = Date.now()
    save(store)
  }
}

export function markProjectFunded(appId) {
  const store = load()
  if (store[String(appId)]) {
    store[String(appId)].fundedLocally = true
    store[String(appId)].updatedAt = Date.now()
    save(store)
  }
}

export function markProjectDistributed(appId) {
  const store = load()
  if (store[String(appId)]) {
    store[String(appId)].distributedLocally = true
    store[String(appId)].updatedAt = Date.now()
    save(store)
  }
}

export function markProjectHidden(appId, hidden = true) {
  const store = load()
  if (store[String(appId)]) {
    store[String(appId)].hiddenByAdmin = hidden
    store[String(appId)].updatedAt = Date.now()
    save(store)
  }
}

export function getProjectMeta(appId) {
  const store = load()
  return store[String(appId)] || null
}

export function getAllProjectMeta() {
  return load()
}
