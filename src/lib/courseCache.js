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
