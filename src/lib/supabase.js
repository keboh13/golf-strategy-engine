import { createClient } from '@supabase/supabase-js'

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
  // Full replace: delete all rows for user, reinsert
  const { error: delErr } = await supabase
    .from('scoring_history')
    .delete()
    .eq('user_id', userId)
  if (delErr) throw delErr

  if (rounds.length === 0) return
  const rows = rounds.map(r => {
    const { _rowId, ...round } = r
    return { user_id: userId, round_data: round }
  })
  const { error } = await supabase.from('scoring_history').insert(rows)
  if (error) throw error
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
  const { data, error } = await supabase
    .from('course_cache')
    .select('course_data, source, cached_at')
    .eq('cache_key', key)
    .maybeSingle()
  if (error || !data) return null
  // Bump hit count async (fire and forget)
  supabase.from('course_cache').update({ hit_count: supabase.raw('hit_count + 1') }).eq('cache_key', key).then(() => {})
  return { ...data.course_data, source: data.source, _cachedAt: new Date(data.cached_at).getTime() }
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
  return (data || []).map(r => ({ ...r.course_data, source: r.source, _cachedAt: new Date(r.cached_at).getTime(), _cacheKey: r.cache_key, _hitCount: r.hit_count }))
}

export async function deleteCachedCourseDB(name, location) {
  const key = makeCacheKey(name, location)
  const { error } = await supabase.from('course_cache').delete().eq('cache_key', key)
  if (error) throw error
}

function makeCacheKey(name, location) {
  return `${(name || '').toLowerCase().trim()}|${(location || '').toLowerCase().trim()}`
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
