// User-contributed hole geometry. When a course is Tier 3 (or a specific hole
// has no OSM polygons), the player can tap two points on the satellite —
// tee, then pin — and we synthesize a centerline + bbox for that hole. The
// contribution is persisted both locally and to Supabase so the next player
// on the same course gets the benefit. This is the data-floor that lets the
// distance UI and "Hole N" overlay light up on courses OSM hasn't reached.
//
// Storage shape (in localStorage and in the course_hole_contrib table):
//   key:  cacheKey(name, location)
//   value: { [ref]: { teeLng, teeLat, pinLng, pinLat, source, updatedAt } }

import { supabase } from './supabase.js'
import { cacheKey } from './courseCache.js'

const LS_CONTRIB_CACHE = 'gse_hole_contrib_cache'

function loadAll() {
  try { return JSON.parse(localStorage.getItem(LS_CONTRIB_CACHE) || '{}') } catch { return {} }
}
function saveAll(obj) {
  try { localStorage.setItem(LS_CONTRIB_CACHE, JSON.stringify(obj)) } catch {}
}

export function getContribLS(name, location) {
  return loadAll()[cacheKey(name, location)] || {}
}

export function setContribLS(name, location, byRef) {
  const all = loadAll()
  all[cacheKey(name, location)] = byRef
  saveAll(all)
}

export async function getContribDB(name, location) {
  const key = cacheKey(name, location)
  const { data, error } = await supabase
    .from('course_hole_contrib')
    .select('hole_ref, tee_lng, tee_lat, pin_lng, pin_lat, source, updated_at')
    .eq('course_key', key)
  if (error || !data) return {}
  const out = {}
  for (const r of data) {
    out[r.hole_ref] = {
      teeLng: r.tee_lng, teeLat: r.tee_lat,
      pinLng: r.pin_lng, pinLat: r.pin_lat,
      source: r.source || 'user',
      updatedAt: r.updated_at,
    }
  }
  return out
}

export async function upsertContribDB(name, location, ref, contrib) {
  const key = cacheKey(name, location)
  const { error } = await supabase
    .from('course_hole_contrib')
    .upsert({
      course_key: key,
      hole_ref: ref,
      tee_lng: contrib.teeLng, tee_lat: contrib.teeLat,
      pin_lng: contrib.pinLng, pin_lat: contrib.pinLat,
      source: contrib.source || 'user',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'course_key,hole_ref' })
  if (error) console.warn('[course_hole_contrib] upsert error:', error.message)
}

export async function getContrib(name, location) {
  const ls = getContribLS(name, location)
  if (Object.keys(ls).length) return ls
  const db = await getContribDB(name, location)
  if (Object.keys(db).length) setContribLS(name, location, db)
  return db
}

export async function saveContrib(name, location, ref, contrib) {
  const all = getContribLS(name, location)
  all[ref] = contrib
  setContribLS(name, location, all)
  try { await upsertContribDB(name, location, ref, contrib) } catch {}
}

// Build a synthetic GeoJSON FeatureCollection from contributed tee/pin pairs.
// Emits a centerline LineString and a pin Point per hole — same property shape
// the OSM exporter uses, so downstream consumers (CourseHoleMap layers,
// computeHoleDistances) treat them identically.
export function contribToFeatures(byRef) {
  const features = []
  const bboxByHole = {}
  for (const refStr of Object.keys(byRef || {})) {
    const ref = parseInt(refStr)
    const c = byRef[refStr]
    if (!Number.isFinite(c?.teeLng) || !Number.isFinite(c?.pinLng)) continue
    const line = [[c.teeLng, c.teeLat], [c.pinLng, c.pinLat]]
    features.push({
      type: 'Feature',
      properties: { kind: 'centerline', holeRef: ref, source: c.source || 'user' },
      geometry: { type: 'LineString', coordinates: line },
    })
    features.push({
      type: 'Feature',
      properties: { kind: 'pin', holeRef: ref, source: c.source || 'user' },
      geometry: { type: 'Point', coordinates: [c.pinLng, c.pinLat] },
    })
    const w = Math.min(c.teeLng, c.pinLng), e = Math.max(c.teeLng, c.pinLng)
    const s = Math.min(c.teeLat, c.pinLat), n = Math.max(c.teeLat, c.pinLat)
    // Pad bbox slightly so fitBounds doesn't render at max zoom on top of the line.
    const padLng = Math.max((e - w) * 0.25, 0.0006)
    const padLat = Math.max((n - s) * 0.25, 0.0006)
    bboxByHole[ref] = [w - padLng, s - padLat, e + padLng, n + padLat]
  }
  return { type: 'FeatureCollection', features, bboxByHole }
}

// Merge contributed features INTO an existing OSM-derived FeatureCollection,
// only filling in holes the OSM data doesn't already cover. Returns a fresh
// FC; never mutates the inputs. Also returns the merged bboxByHole.
export function mergeContribIntoGeojson(osmGeojson, osmBboxByHole, byRef) {
  const contribFC = contribToFeatures(byRef || {})
  const haveOsmFor = new Set()
  if (osmGeojson?.features) {
    for (const f of osmGeojson.features) {
      const ref = f.properties?.holeRef
      const k = f.properties?.kind
      if (ref != null && (k === 'centerline' || k === 'pin')) haveOsmFor.add(`${ref}|${k}`)
    }
  }
  const merged = {
    type: 'FeatureCollection',
    features: [
      ...(osmGeojson?.features || []),
      ...contribFC.features.filter(f => !haveOsmFor.has(`${f.properties.holeRef}|${f.properties.kind}`)),
    ],
  }
  const mergedBbox = { ...(osmBboxByHole || {}) }
  for (const ref of Object.keys(contribFC.bboxByHole)) {
    if (!mergedBbox[ref]) mergedBbox[ref] = contribFC.bboxByHole[ref]
  }
  return { geojson: merged, bboxByHole: mergedBbox }
}
