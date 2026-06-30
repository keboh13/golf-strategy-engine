// Fetch-once cache for course geometry. Mirrors the shape of courseCache.js
// (localStorage front, Supabase back) but stores the normalized
// FeatureCollection produced by exportCourseGeoJSON, the per-hole bbox map,
// the coverage map, and the tier classification.
//
// The DB table is public.course_geo (see migration create_course_geo); RLS
// allows any authenticated user to read and upsert.

import { supabase } from './supabase.js'
import { cacheKey } from './courseCache.js'

const LS_GEO_CACHE = 'gse_course_geo_cache'

export function loadGeoCache() {
  try { return JSON.parse(localStorage.getItem(LS_GEO_CACHE) || '{}') } catch { return {} }
}

export function saveGeoCache(obj) {
  try { localStorage.setItem(LS_GEO_CACHE, JSON.stringify(obj)) } catch {}
}

export function getCachedGeoLS(name, location) {
  return loadGeoCache()[cacheKey(name, location)] || null
}

export function setCachedGeoLS(name, location, record) {
  const cache = loadGeoCache()
  cache[cacheKey(name, location)] = { ...record, _cachedAt: Date.now() }
  saveGeoCache(cache)
}

// ── Supabase round-trip ─────────────────────────────────────────────────────

export async function getCachedGeoDB(name, location) {
  const key = cacheKey(name, location)
  const { data, error } = await supabase
    .from('course_geo')
    .select('tier, geojson, bbox_by_hole, coverage, source, updated_at')
    .eq('course_key', key)
    .maybeSingle()
  if (error || !data) return null
  return {
    tier:       data.tier,
    geojson:    data.geojson,
    bboxByHole: data.bbox_by_hole,
    coverage:   data.coverage,
    source:     data.source,
    _cachedAt:  new Date(data.updated_at).getTime(),
  }
}

export async function setCachedGeoDB(name, location, record) {
  const key = cacheKey(name, location)
  const { error } = await supabase
    .from('course_geo')
    .upsert({
      course_key:   key,
      tier:         record.tier,
      geojson:      record.geojson || null,
      bbox_by_hole: record.bboxByHole || null,
      coverage:     record.coverage || null,
      source:       record.source || 'osm',
      updated_at:   new Date().toISOString(),
    }, { onConflict: 'course_key' })
  if (error) console.warn('[course_geo] upsert error:', error.message)
}

// ── Convenience: LS-first, DB-backed ────────────────────────────────────────

export async function getCachedGeo(name, location) {
  const ls = getCachedGeoLS(name, location)
  if (ls) return ls
  const db = await getCachedGeoDB(name, location)
  if (db) setCachedGeoLS(name, location, db)
  return db
}

export async function setCachedGeo(name, location, record) {
  setCachedGeoLS(name, location, record)
  await setCachedGeoDB(name, location, record)
}

export async function deleteCachedGeoDB(name, location) {
  const key = cacheKey(name, location)
  const { error } = await supabase.from('course_geo').delete().eq('course_key', key)
  if (error) throw error
  // Also evict local LS entry
  const cache = loadGeoCache()
  if (cache[key]) {
    delete cache[key]
    saveGeoCache(cache)
  }
}
