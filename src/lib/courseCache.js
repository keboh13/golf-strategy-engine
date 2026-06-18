const LS_COURSE_CACHE = 'gse_course_cache'

export function loadCourseCache() {
  try { return JSON.parse(localStorage.getItem(LS_COURSE_CACHE) || '{}') } catch { return {} }
}

export function saveCourseCache(obj) {
  try { localStorage.setItem(LS_COURSE_CACHE, JSON.stringify(obj)) } catch {}
}

export function cacheKey(name, location) {
  return `${(name || '').toLowerCase().trim()}|${(location || '').toLowerCase().trim()}`
}

export function getCachedCourse(name, location) {
  return loadCourseCache()[cacheKey(name, location)] || null
}

export function setCachedCourse(normalized) {
  const cache = loadCourseCache()
  cache[cacheKey(normalized.name, normalized.location)] = { ...normalized, _cachedAt: Date.now() }
  saveCourseCache(cache)
}

// Drop a single entry by exact key. Used after a rename: the local entry for
// the old key is dead because the shared DB no longer holds that row.
export function removeCachedCourseByKey(key) {
  const cache = loadCourseCache()
  if (cache[key]) {
    delete cache[key]
    saveCourseCache(cache)
  }
}

// Returns true if the locally cached entry is older (lower edit_version) than
// the supplied DB row. Used by the search ladder + course-load flow so that
// admin edits surface on every client without a manual refresh.
export function isLocalCacheStale(name, location, dbEditVersion) {
  const local = getCachedCourse(name, location)
  if (!local) return true
  const localV = local._editVersion ?? 0
  return Number(dbEditVersion ?? 0) > localV
}

// Boot-time purge: drop any local entries whose key no longer exists in the
// shared DB and isn't covered by an alias mapping. Caller passes the
// authoritative sets (one DB round-trip on app boot).
export function purgeOrphanedLocalEntries(canonicalKeys, aliasMap) {
  if (!canonicalKeys) return 0
  const cache = loadCourseCache()
  const aliasLookup = new Map(
    Array.isArray(aliasMap) ? aliasMap.map(a => [a.alias_key, a.canonical_key]) : []
  )
  let removed = 0
  for (const key of Object.keys(cache)) {
    if (canonicalKeys.has(key)) continue
    if (aliasLookup.has(key)) continue
    delete cache[key]
    removed++
  }
  if (removed) saveCourseCache(cache)
  return removed
}
