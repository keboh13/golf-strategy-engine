import { supabase } from '../supabase.js'
import { cacheKey as makeCacheKey, isLocalCacheStale, setCachedCourse } from '../courseCache.js'

// ── Global course cache helpers ───────────────────────────────────────────────

export async function getCachedCourseDB(name, location) {
  const key = makeCacheKey(name, location)
  let { data, error } = await supabase
    .from('course_cache')
    .select('course_data, source, cached_at, edit_version, cache_key')
    .eq('cache_key', key)
    .maybeSingle()

  // No direct hit — fall back to course_aliases (admin renamed the course)
  if (!error && !data) {
    const { data: alias } = await supabase
      .from('course_aliases')
      .select('canonical_key')
      .eq('alias_key', key)
      .maybeSingle()
    if (alias?.canonical_key) {
      const r = await supabase
        .from('course_cache')
        .select('course_data, source, cached_at, edit_version, cache_key')
        .eq('cache_key', alias.canonical_key)
        .maybeSingle()
      data = r.data
      error = r.error
    }
  }

  // Still no hit — try a name-fuzzy fallback against course_data->>'name'.
  // This covers the post-rename case where the user types the new name but
  // doesn't supply (or supplies a different) location — the cache_key won't
  // match exactly but the row is clearly the right course.
  if (!error && !data && name?.trim()) {
    const needle = name.trim().toLowerCase()
    const { data: rows } = await supabase
      .from('course_cache')
      .select('course_data, source, cached_at, edit_version, cache_key')
      .ilike('course_data->>name', `%${needle}%`)
      .order('updated_at', { ascending: false, nullsFirst: false })
      .limit(5)
    if (rows && rows.length) {
      // Prefer exact name match (case-insensitive); else take most-recently-updated.
      const exact = rows.find(r => (r.course_data?.name || '').toLowerCase() === needle)
      data = exact || rows[0]
    }
  }

  if (error || !data) return null
  supabase.rpc('increment_cache_hit', { p_cache_key: data.cache_key }).then(() => {})
  const result = {
    ...data.course_data,
    source: data.source,
    _cachedAt: new Date(data.cached_at).getTime(),
    _editVersion: data.edit_version ?? 0,
    _canonicalKey: data.cache_key,
  }

  // If the local cache is stale (lower edit_version than DB), update it (#161)
  const courseName = data.course_data?.name
  const courseLocation = data.course_data?.location
  if (courseName && isLocalCacheStale(courseName, courseLocation, data.edit_version ?? 0)) {
    setCachedCourse(result)
  }

  return result
}

export async function setCachedCourseDB(normalized) {
  const key = makeCacheKey(normalized.name, normalized.location)
  const { error } = await supabase
    .from('course_cache')
    .upsert({
      cache_key:   key,
      course_data: normalized,
      source:      normalized.source || 'unknown',
      cached_at:   new Date().toISOString(),
    }, { onConflict: 'cache_key' })
  if (error) console.warn('[course_cache] upsert error:', error.message)
}

export async function getAllCachedCoursesDB() {
  const { data, error } = await supabase
    .from('course_cache')
    .select('*')
    .order('cached_at', { ascending: false })
  if (error) throw error
  return (data || []).map(r => ({ ...r.course_data, source: r.source, _cachedAt: new Date(r.cached_at).getTime(), _cacheKey: r.cache_key, _hitCount: r.hit_count, _editVersion: r.edit_version ?? 0, _updatedAt: r.updated_at, is_public: !!r.is_public }))
}

// Shared course_cache query builder. Encapsulates column selection, filtering,
// sorting, and pagination so every call site stays in sync when the schema
// changes.  Options:
//   search:     ilike filter on cache_key
//   publicOnly: restrict to is_public = true
//   sort:       'recent' (default) | 'popular' | 'name'
//   limit:      max rows (default 500)
//   offset:     pagination offset (default 0)
//   count:      if true, request Supabase row count
//   columns:    override the default select string
//   raw:        if true, return raw Supabase rows without normalization
const COURSE_CACHE_COLS = 'cache_key,course_data,source,cached_at,hit_count,is_public,updated_at,edit_version'

export async function queryCourseCacheDB(opts = {}) {
  const {
    search, publicOnly, sort = 'recent',
    limit: lim = 500, offset = 0, count: wantCount = false,
    columns = COURSE_CACHE_COLS, raw = false,
  } = opts

  let query = supabase
    .from('course_cache')
    .select(columns, wantCount ? { count: 'exact' } : undefined)

  if (publicOnly) query = query.eq('is_public', true)
  if (search && search.trim()) query = query.ilike('cache_key', `%${search.trim().toLowerCase()}%`)

  if (sort === 'popular') query = query.order('hit_count', { ascending: false })
  else if (sort === 'name') query = query.order('cache_key', { ascending: true })
  else query = query.order('cached_at', { ascending: false })

  query = query.range(offset, offset + lim - 1)

  const { data, error, count: totalCount } = await query
  if (error) throw error

  if (raw) return { rows: data || [], count: totalCount }

  const normalized = (data || []).map(r => ({
    ...r.course_data,
    source: r.source,
    _cachedAt: new Date(r.cached_at).getTime(),
    _cacheKey: r.cache_key,
    _hitCount: r.hit_count,
    _editVersion: r.edit_version ?? 0,
    _updatedAt: r.updated_at,
    is_public: !!r.is_public,
  }))
  return { rows: normalized, count: totalCount }
}

// Returns the set of canonical cache_keys currently in course_cache. Used by
// the client on boot to purge orphaned localStorage entries (courses that
// were renamed away from a key the user previously visited).
export async function listCanonicalCacheKeys() {
  const { data, error } = await supabase.from('course_cache').select('cache_key')
  if (error) return null
  return new Set((data || []).map(r => r.cache_key))
}

// Returns a Map<cache_key, edit_version> for every row in course_cache. Used
// by the client on boot to detect stale localStorage entries — anything whose
// local _editVersion is behind the DB's gets purged so the next lookup pulls
// the fresh row (admin edits, PDF re-parses, etc.).
export async function listCanonicalCacheVersions() {
  const { data, error } = await supabase.from('course_cache').select('cache_key,edit_version')
  if (error) return null
  return new Map((data || []).map(r => [r.cache_key, Number(r.edit_version) || 0]))
}

export async function listAliasKeys() {
  const { data, error } = await supabase.from('course_aliases').select('alias_key, canonical_key')
  if (error) return null
  return data || []
}

export async function deleteCachedCourseDB(name, location) {
  const key = makeCacheKey(name, location)
  const { error } = await supabase.from('course_cache').delete().eq('cache_key', key)
  if (error) throw error
}


// ── Course hole hazards ──────────────────────────────────────────────────────

export async function loadCourseHazards(name, location) {
  const key = makeCacheKey(name, location)
  const { data, error } = await supabase
    .from('course_hole_hazards')
    .select('hole_ref, hazards, source, image_path, confidence')
    .eq('course_key', key)
  if (error || !data) return {}
  const byRef = {}
  for (const row of data) byRef[row.hole_ref] = { ...row.hazards, _source: row.source, _confidence: row.confidence }
  return byRef
}

function courseKeySlug(name, location) {
  return makeCacheKey(name, location).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

export async function listCoursePdfs(name, location) {
  const prefix = courseKeySlug(name, location)
  const { data, error } = await supabase.storage.from('course-art').list(prefix, { limit: 100 })
  if (error || !data) return []
  return data
    .filter(o => o.name && o.name.toLowerCase().endsWith('.pdf'))
    .map(o => {
      const path = `${prefix}/${o.name}`
      const { data: u } = supabase.storage.from('course-art').getPublicUrl(path)
      return { path, name: o.name, url: u?.publicUrl || '', created_at: o.created_at || null }
    })
}

export async function uploadCoursePdfToBucket(name, location, file) {
  const slug = courseKeySlug(name, location)
  const objectPath = `${slug}/yardage-book-${Date.now()}.pdf`
  const { error } = await supabase.storage.from('course-art').upload(objectPath, file, {
    contentType: 'application/pdf',
    upsert: true,
  })
  if (error) throw error
  const { data } = supabase.storage.from('course-art').getPublicUrl(objectPath)
  if (!data?.publicUrl) throw new Error('Could not resolve public URL for uploaded PDF')
  return { path: objectPath, url: data.publicUrl }
}

export async function deleteAllCoursePdfs(name, location) {
  const objs = await listCoursePdfs(name, location)
  if (!objs.length) return 0
  const { error } = await supabase.storage.from('course-art').remove(objs.map(o => o.path))
  if (error) throw error
  return objs.length
}

export async function deleteCourseHazards(name, location) {
  const key = makeCacheKey(name, location)
  const { error } = await supabase.from('course_hole_hazards').delete().eq('course_key', key)
  if (error) throw error
}

export async function clearCachedScorecardPdfRef(name, location) {
  const key = makeCacheKey(name, location)
  const { data: row } = await supabase.from('course_cache').select('course_data').eq('cache_key', key).maybeSingle()
  if (!row) return
  const course_data = { ...(row.course_data || {}) }
  delete course_data._sourcePdf
  delete course_data.hazardsByHole
  delete course_data._sourceHtml
  delete course_data._discoveryTitle
  course_data._needs_review = true
  const { error } = await supabase.from('course_cache').update({ course_data }).eq('cache_key', key)
  if (error) throw error
}

export async function saveCourseHazards(name, location, holeRef, hazardsJson, { source = 'vision', imagePath = null, confidence = 'medium' } = {}) {
  const key = makeCacheKey(name, location)
  const { error } = await supabase
    .from('course_hole_hazards')
    .upsert({
      course_key: key,
      hole_ref: holeRef,
      hazards: hazardsJson,
      source,
      image_path: imagePath,
      confidence,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'course_key,hole_ref' })
  if (error) console.warn('[course_hole_hazards] upsert error:', error.message)
}
