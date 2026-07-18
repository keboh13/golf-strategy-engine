import { describe, it, expect, beforeEach } from 'vitest'
import { webcrypto } from 'node:crypto'

// The module reaches for `localStorage` and `crypto.subtle`. Vitest runs the
// unit suite in Node, so we polyfill both before importing.
class MemoryStorage {
  constructor() { this.store = new Map() }
  getItem(k) { return this.store.has(k) ? this.store.get(k) : null }
  setItem(k, v) { this.store.set(k, String(v)) }
  removeItem(k) { this.store.delete(k) }
  clear() { this.store.clear() }
}
globalThis.localStorage = new MemoryStorage()
if (!globalThis.crypto) globalThis.crypto = webcrypto

const {
  planCacheKey,
  getCachedPlan,
  putCachedPlan,
  clearCachedPlan,
  planCacheStats,
} = await import('./planCache.js')

beforeEach(() => globalThis.localStorage.clear())

describe('planCacheKey', () => {
  it('is deterministic for identical inputs', async () => {
    const k1 = await planCacheKey({ prompt: 'x', model: 'sonnet', style: 'aggro' })
    const k2 = await planCacheKey({ prompt: 'x', model: 'sonnet', style: 'aggro' })
    expect(k1).toBe(k2)
  })
  it('changes when any component changes', async () => {
    const base = { prompt: 'x', model: 'sonnet', style: 'aggro' }
    const k = await planCacheKey(base)
    expect(await planCacheKey({ ...base, prompt: 'y' })).not.toBe(k)
    expect(await planCacheKey({ ...base, model: 'haiku' })).not.toBe(k)
    expect(await planCacheKey({ ...base, style: 'safe' })).not.toBe(k)
  })
})

describe('get/put/clear cachedPlan', () => {
  it('round-trips a plan string', () => {
    putCachedPlan('k1', '## Round strategy\nbody')
    expect(getCachedPlan('k1').plan).toBe('## Round strategy\nbody')
  })
  it('returns null for an unknown key', () => {
    expect(getCachedPlan('missing')).toBeNull()
  })
  it('ignores empty / whitespace-only plans', () => {
    putCachedPlan('k1', '   ')
    expect(getCachedPlan('k1')).toBeNull()
  })
  it('expires entries past the TTL', () => {
    putCachedPlan('k1', 'body', { nowMs: 0 })
    expect(getCachedPlan('k1', { nowMs: 8 * 24 * 60 * 60 * 1000 })).toBeNull()
  })
  it('clear removes just the requested key', () => {
    putCachedPlan('k1', 'a')
    putCachedPlan('k2', 'b')
    clearCachedPlan('k1')
    expect(getCachedPlan('k1')).toBeNull()
    expect(getCachedPlan('k2').plan).toBe('b')
  })
  it('evicts oldest-read entries once over the cap', () => {
    const base = Date.now()
    for (let i = 0; i < 25; i++) putCachedPlan(`k${i}`, `body-${i}`, { nowMs: base + i, maxEntries: 20 })
    const stats = planCacheStats({ nowMs: base + 100 })
    expect(stats.count).toBe(20)
    expect(getCachedPlan('k0', { nowMs: base + 100 })).toBeNull()   // oldest evicted
    expect(getCachedPlan('k24', { nowMs: base + 100 })?.plan).toBe('body-24') // newest kept
  })
})
