import { createClient } from '@supabase/supabase-js'
import { cacheKey as makeCacheKey, isLocalCacheStale, setCachedCourse } from './courseCache.js'

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL  || ''
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

if (!SUPABASE_URL || !SUPABASE_ANON) {
  console.warn('[supabase] VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY not set — auth and DB disabled')
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    flowType: 'implicit',
  },
})

// ── Per-user data helpers ─────────────────────────────────────────────────────

export async function loadUserProfiles(userId) {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
  if (error) throw error
  // Convert rows → { profileName: playerData }
  return Object.fromEntries((data || []).map(r => [r.profile_name, r.player_data]))
}

export async function saveUserProfile(userId, profileName, playerData) {
  const { error } = await supabase
    .from('user_profiles')
    .upsert({ user_id: userId, profile_name: profileName, player_data: playerData, updated_at: new Date().toISOString() },
             { onConflict: 'user_id,profile_name' })
  if (error) throw error
}

export async function deleteUserProfile(userId, profileName) {
  const { error } = await supabase
    .from('user_profiles')
    .delete()
    .eq('user_id', userId)
    .eq('profile_name', profileName)
  if (error) throw error
}

export async function loadUserHistory(userId) {
  const { data, error } = await supabase
    .from('scoring_history')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data || []).map(r => ({ ...r.round_data, _rowId: r.id }))
}

export async function saveUserHistory(userId, rounds) {
  const { data: existing } = await supabase
    .from('scoring_history')
    .select('id')
    .eq('user_id', userId)
  const existingIds = new Set((existing || []).map(r => r.id))

  const toUpsert = []
  const keepIds = new Set()
  for (const r of rounds) {
    const { _rowId, ...round } = r
    if (_rowId) {
      keepIds.add(_rowId)
      toUpsert.push({ id: _rowId, user_id: userId, round_data: round })
    } else {
      toUpsert.push({ user_id: userId, round_data: round })
    }
  }

  const toDelete = [...existingIds].filter(id => !keepIds.has(id))
  if (toDelete.length > 0) {
    const { error } = await supabase.from('scoring_history').delete().in('id', toDelete)
    if (error) throw error
  }

  if (toUpsert.length > 0) {
    const { error } = await supabase.from('scoring_history').upsert(toUpsert, { onConflict: 'id' })
    if (error) throw error
  }
}

export async function loadUserSettings(userId) {
  const { data, error } = await supabase
    .from('user_settings')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return data || {}
}

export async function saveUserSettings(userId, patch) {
  const { error } = await supabase
    .from('user_settings')
    .upsert({ user_id: userId, ...patch, updated_at: new Date().toISOString() },
             { onConflict: 'user_id' })
  if (error) throw error
}

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

// ── Saved game plans ─────────────────────────────────────────────────────────

export async function loadSavedPlans(userId) {
  const { data, error } = await supabase
    .from('saved_plans')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(10)
  if (error) throw error
  return (data || []).map(r => ({
    id: r.id,
    course: r.course_name,
    date: r.created_at?.slice(0, 10),
    plan: r.plan_text,
    tee: r.tee_name || '',
  }))
}

export async function savePlan(userId, courseName, planText, teeName) {
  const { error } = await supabase
    .from('saved_plans')
    .insert({
      user_id: userId,
      course_name: courseName,
      plan_text: planText,
      tee_name: teeName || null,
    })
  if (error) throw error
}

export async function deleteSavedPlan(planId) {
  const { error } = await supabase
    .from('saved_plans')
    .delete()
    .eq('id', planId)
  if (error) throw error
}

// ── prep_sessions ────────────────────────────────────────────────────────────
// Cross-device resume for the Round Prep flow (Part 1.2 of the optimization
// plan). One row per (user, profile). `state` is a minimal jsonb slice the
// client knows how to rehydrate — see PrepTab / AppInner for the shape.

export async function loadPrepSession(userId, profileName = 'Default') {
  const { data, error } = await supabase
    .from('prep_sessions')
    .select('state, updated_at')
    .eq('user_id', userId)
    .eq('profile_name', profileName)
    .maybeSingle()
  if (error) throw error
  return data || null
}

// ── rec_quality ──────────────────────────────────────────────────────────────
// Upserts a user rating for a single rec_log entry. The unique index on
// (rec_log_id, rater_id, dimension) means calling this again just updates the
// existing row — so "change your mind" is safe.

export async function saveRecQuality(recLogId, raterId, rating, dimension = 'overall', notes = null) {
  const { error } = await supabase
    .from('rec_quality')
    .upsert(
      { rec_log_id: recLogId, rater_id: raterId, rating, dimension, notes: notes || null },
      { onConflict: 'rec_log_id,rater_id,dimension' }
    )
  if (error) throw error
}

export async function savePrepSession(userId, profileName, state) {
  const { error } = await supabase
    .from('prep_sessions')
    .upsert(
      { user_id: userId, profile_name: profileName || 'Default', state, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,profile_name' }
    )
  if (error) throw error
}

// Wipes the saved prep slice for (user, profile) so the next mount / other
// device starts blank instead of restoring the previous course.
export async function clearPrepSession(userId, profileName = 'Default') {
  if (!userId) return
  const { error } = await supabase
    .from('prep_sessions')
    .delete()
    .eq('user_id', userId)
    .eq('profile_name', profileName || 'Default')
  if (error) throw error
}
