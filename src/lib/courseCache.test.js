import { describe, it, expect, beforeEach } from 'vitest'
import { searchLocalCache, setCachedCourse, saveCourseCache } from './courseCache.js'

// Vitest runs in node by default — stub a minimal localStorage so the cache
// helpers behave the same as in the browser.
function installFakeLocalStorage() {
  let store = {}
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v) },
    removeItem: (k) => { delete store[k] },
    clear: () => { store = {} },
  }
}

describe('searchLocalCache', () => {
  beforeEach(() => {
    installFakeLocalStorage()
    saveCourseCache({})
  })

  it('returns nothing for an empty query', () => {
    setCachedCourse({ name: 'Pebble Beach Golf Links', location: 'Pebble Beach, CA' })
    expect(searchLocalCache('')).toEqual([])
    expect(searchLocalCache('   ')).toEqual([])
  })

  it('matches case-insensitively on the course name substring', () => {
    setCachedCourse({ name: 'Pebble Beach Golf Links', location: 'Pebble Beach, CA' })
    setCachedCourse({ name: 'Spyglass Hill', location: 'Pebble Beach, CA' })
    const hits = searchLocalCache('pebble')
    expect(hits).toHaveLength(2)
  })

  it('narrows by location substring when provided', () => {
    setCachedCourse({ name: 'TPC Sawgrass', location: 'Ponte Vedra Beach, FL' })
    setCachedCourse({ name: 'TPC Scottsdale', location: 'Scottsdale, AZ' })
    const az = searchLocalCache('tpc', 'AZ')
    expect(az).toHaveLength(1)
    expect(az[0].name).toBe('TPC Scottsdale')
  })

  it('sorts freshest entry first by _cachedAt', () => {
    saveCourseCache({
      'a|':       { name: 'A Course', location: '', _cachedAt: 100 },
      'a-newer|': { name: 'A Course Newer', location: '', _cachedAt: 500 },
      'a-old|':   { name: 'A Course Old', location: '', _cachedAt: 1 },
    })
    const hits = searchLocalCache('a course')
    expect(hits.map(h => h._cachedAt)).toEqual([500, 100, 1])
  })

  it('caps results at the limit', () => {
    const cache = {}
    for (let i = 0; i < 20; i++) cache[`c${i}|`] = { name: `Course ${i}`, location: '', _cachedAt: i }
    saveCourseCache(cache)
    expect(searchLocalCache('course', '', 3)).toHaveLength(3)
  })

  it('returns empty when nothing matches', () => {
    setCachedCourse({ name: 'Pebble Beach', location: 'CA' })
    expect(searchLocalCache('augusta')).toEqual([])
  })
})
