// Per-course, per-inputs cache for generated round-prep briefs. The point of
// the audit's I1 initiative is to make second visits feel instant — even if
// the cold-start model call still takes 60–90s, hitting Generate again for
// the same course + inputs should replay from cache in under a second.
//
// Cache key is a SHA-256 of (prompt || model || style). Prompt is already a
// stable serialization of the player, bag, course, weather, and history, so
// changing any of those invalidates the cache automatically. Entries expire
// after 7 days so stale weather doesn't linger.
//
// Storage: localStorage under `gse_plan_cache`. Up to 20 entries with LRU
// eviction; each entry is small (~5–20 KB of markdown text).

const LS_KEY = 'gse_plan_cache'
const MAX_ENTRIES = 20
const TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// Compose the cache key from the inputs that fully determine the model output.
export async function planCacheKey({ prompt, model, style }) {
  const parts = `${model || ''}|${style || ''}|${prompt || ''}`
  return await sha256Hex(parts)
}

function loadAll() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return {}
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function saveAll(obj) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(obj))
  } catch { /* quota / private mode — silent */ }
}

export function getCachedPlan(key, { nowMs = Date.now(), ttlMs = TTL_MS } = {}) {
  if (!key) return null
  const all = loadAll()
  const entry = all[key]
  if (!entry || typeof entry.plan !== 'string' || !entry.plan.trim()) return null
  if (typeof entry.cachedAt !== 'number' || nowMs - entry.cachedAt > ttlMs) return null
  // Refresh LRU timestamp so recently-read entries survive eviction longer.
  entry.lastReadAt = nowMs
  all[key] = entry
  saveAll(all)
  return { plan: entry.plan, cachedAt: entry.cachedAt }
}

export function putCachedPlan(key, plan, { nowMs = Date.now(), maxEntries = MAX_ENTRIES } = {}) {
  if (!key || typeof plan !== 'string' || !plan.trim()) return
  const all = loadAll()
  all[key] = { plan, cachedAt: nowMs, lastReadAt: nowMs }
  // Evict oldest-read entries once we're over cap.
  const keys = Object.keys(all)
  if (keys.length > maxEntries) {
    keys.sort((a, b) => (all[a].lastReadAt || 0) - (all[b].lastReadAt || 0))
    for (const k of keys.slice(0, keys.length - maxEntries)) delete all[k]
  }
  saveAll(all)
}

export function clearCachedPlan(key) {
  if (!key) return
  const all = loadAll()
  if (all[key]) {
    delete all[key]
    saveAll(all)
  }
}

// Sizes / age helpers for the settings panel to surface cache footprint.
export function planCacheStats({ nowMs = Date.now() } = {}) {
  const all = loadAll()
  const entries = Object.values(all)
  return {
    count: entries.length,
    oldestAgeMs: entries.length ? nowMs - Math.min(...entries.map(e => e.cachedAt || 0)) : 0,
    approxBytes: (localStorage.getItem(LS_KEY) || '').length,
  }
}
