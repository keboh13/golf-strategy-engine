// Turf-backed distance math for Tier 1 holes. Distances are measured **from
// the tee along the centerline** — carry distances to hazards make sense off
// the tee, not around the green. Front/center/back of green stay useful for
// approach planning.
//
// All distances are returned in yards (`m * 1.09361`) to match the rest of the
// app (see metersToYards in osmCourseData.js).

import * as turf from '@turf/turf'

const M_TO_Y = 1.09361

// ── Phase 6 polish: shrink the persisted/state geometry ─────────────────────
// At Esri zoom 17–18 we don't need polygons with sub-meter precision, and the
// network/storage payload matters (course_geo rows are jsonb). Two cheap wins:
//   1. turf.simplify each polygon/line (tolerance ~1e-5 ≈ 1m at the equator)
//   2. trim every coord to 6 decimals (~11cm — well below render precision)
// Pin points stay full-precision (one Point per hole — saves nothing).

function trimCoord(c) {
  return [Math.round(c[0] * 1e6) / 1e6, Math.round(c[1] * 1e6) / 1e6]
}
function trimRing(ring) { return ring.map(trimCoord) }

export function simplifyAndTrimGeoJSON(geojson) {
  if (!geojson?.features) return geojson
  const out = { ...geojson, features: [] }
  for (const f of geojson.features) {
    if (!f.geometry) continue
    let g = f.geometry
    if (g.type === 'Polygon') {
      try {
        const simplified = turf.simplify(turf.polygon(g.coordinates), { tolerance: 0.00001, highQuality: false, mutate: false })
        g = { type: 'Polygon', coordinates: simplified.geometry.coordinates.map(trimRing) }
      } catch {
        g = { type: 'Polygon', coordinates: g.coordinates.map(trimRing) }
      }
    } else if (g.type === 'LineString') {
      try {
        const simplified = turf.simplify(turf.lineString(g.coordinates), { tolerance: 0.00001, highQuality: false, mutate: false })
        g = { type: 'LineString', coordinates: simplified.geometry.coordinates.map(trimCoord) }
      } catch {
        g = { type: 'LineString', coordinates: g.coordinates.map(trimCoord) }
      }
    }
    out.features.push({ ...f, geometry: g })
  }
  return out
}

function holeFeatures(geojson, holeRef) {
  const out = { centerline: null, green: null, pin: null, hazards: [] }
  if (!geojson?.features) return out
  for (const f of geojson.features) {
    if (f.properties?.holeRef !== holeRef) continue
    const k = f.properties.kind
    if (k === 'centerline' && f.geometry?.type === 'LineString') out.centerline = f
    else if (k === 'green' && f.geometry?.type === 'Polygon' && !out.green) out.green = f
    else if (k === 'pin' && f.geometry?.type === 'Point') out.pin = f
    else if ((k === 'bunker' || k === 'water') && f.geometry?.type === 'Polygon') out.hazards.push(f)
  }
  return out
}

function distanceAlongLineY(line, point) {
  // Project the point onto the line and return the along-line distance from
  // the start of the line, in yards.
  const snapped = turf.nearestPointOnLine(line, point, { units: 'meters' })
  // `location` on the snapped point is the cumulative distance in km along
  // the line by default. We pass units:'meters' above which means location is
  // in meters.
  const meters = snapped.properties?.location ?? 0
  return meters * M_TO_Y
}

function pointFromCoords(coords) {
  return turf.point(coords)
}

// Returns `null` when the hole has no centerline or no green/pin to anchor
// distances against. Callers should suppress distance UI and brief lines for
// holes where this returns null (don't fabricate numbers).
export function computeHoleDistances(geojson, holeRef) {
  const { centerline, green, pin, hazards } = holeFeatures(geojson, holeRef)
  if (!centerline) return null

  const line = centerline
  const teeCoord = line.geometry.coordinates[0]
  const tee = pointFromCoords(teeCoord)

  // Pin: prefer explicit `pin` point; fall back to green centroid; fall back
  // to last centerline vertex.
  let pinPoint = pin
  if (!pinPoint && green) pinPoint = turf.centroid(green)
  if (!pinPoint) {
    const last = line.geometry.coordinates[line.geometry.coordinates.length - 1]
    pinPoint = pointFromCoords(last)
  }
  const teeToPin = Math.round(turf.distance(tee, pinPoint, { units: 'meters' }) * M_TO_Y)

  // Front / center / back of green — along the centerline (so they read as
  // "yards from the tee", matching how the rest of the brief talks).
  let frontY = null, centerY = null, backY = null
  if (green) {
    const ringCoords = green.geometry.coordinates[0]
    let minAlong = Infinity, maxAlong = -Infinity
    for (const c of ringCoords) {
      const along = distanceAlongLineY(line, pointFromCoords(c))
      if (along < minAlong) minAlong = along
      if (along > maxAlong) maxAlong = along
    }
    if (Number.isFinite(minAlong) && Number.isFinite(maxAlong)) {
      frontY = Math.round(minAlong)
      backY = Math.round(maxAlong)
      centerY = Math.round(distanceAlongLineY(line, turf.centroid(green)))
    }
  }

  // Carry-to-hazard from the TEE along the centerline. We measure to the
  // nearest edge of the hazard polygon so the number reads as "you must carry
  // at least this far to clear it." Side (L/R) is from the bearing tee→pin.
  const teeToPinBearing = turf.bearing(tee, pinPoint)
  const carries = []
  for (const h of hazards) {
    const ring = h.geometry.coordinates[0]
    let nearest = null, nearestAlong = Infinity
    for (const c of ring) {
      const along = distanceAlongLineY(line, pointFromCoords(c))
      if (along < nearestAlong) {
        nearestAlong = along
        nearest = c
      }
    }
    if (!Number.isFinite(nearestAlong) || nearestAlong <= 0) continue
    if (nearestAlong >= teeToPin - 10) continue // skip hazards beyond the green
    const hazCentroid = turf.centroid(h)
    const hazBearing = turf.bearing(tee, hazCentroid)
    const rel = ((hazBearing - teeToPinBearing + 540) % 360) - 180 // -180..180
    const side = Math.abs(rel) < 3 ? 'center' : rel > 0 ? 'right' : 'left'
    carries.push({
      kind: h.properties.kind, // 'bunker' | 'water'
      side,
      yards: Math.round(nearestAlong),
    })
  }
  carries.sort((a, b) => a.yards - b.yards)

  return { teeToPin, frontY, centerY, backY, carries }
}

// Resolve tee/pin anchor coordinates for one hole from whatever the
// FeatureCollection actually contains. Used by CourseHoleMap to auto-frame
// per hole and to render carry-distance rings around the tee — even when the
// hole has no OSM bbox, we can still center on the tee if there's *any*
// source of coordinates.
//
// Preference order:
//   tee: contribution/OSM centerline start → tee polygon centroid → null
//   pin: explicit pin point → green centroid → centerline end → null
export function getHoleAnchor(geojson, holeRef) {
  if (!geojson?.features) return null
  let centerline = null, green = null, pin = null, teePoly = null
  for (const f of geojson.features) {
    if (f.properties?.holeRef !== holeRef) continue
    const k = f.properties.kind
    if (k === 'centerline' && f.geometry?.type === 'LineString') centerline = f
    else if (k === 'green' && f.geometry?.type === 'Polygon' && !green) green = f
    else if (k === 'pin' && f.geometry?.type === 'Point') pin = f
    else if (k === 'tee' && f.geometry?.type === 'Polygon' && !teePoly) teePoly = f
  }
  let tee = null
  if (centerline) tee = centerline.geometry.coordinates[0]
  else if (teePoly) tee = turf.centroid(teePoly).geometry.coordinates
  let pinCoord = null
  if (pin) pinCoord = pin.geometry.coordinates
  else if (green) pinCoord = turf.centroid(green).geometry.coordinates
  else if (centerline) pinCoord = centerline.geometry.coordinates[centerline.geometry.coordinates.length - 1]
  if (!tee && !pinCoord) return null
  let bearing = null
  if (tee && pinCoord) {
    bearing = turf.bearing(turf.point(tee), turf.point(pinCoord))
  }
  return { tee, pin: pinCoord, bearing }
}

// Build carry-distance ring polygons around a tee, one per club, filtered to
// the range that actually fits between the tee and the pin (so a 275y driver
// ring doesn't cover the pin on a 155y par-3). Returned as a FeatureCollection
// ready to feed into a maplibre 'line' layer. Pure so the map can memoize.
//
//   clubs: [{ club, carry }, ...]   — carry in yards
//   options.maxYards: cap so rings don't spill way past the pin (default = teeToPin + 15)
const Y_TO_M = 0.9144
export function buildCarryRings(tee, clubs, options = {}) {
  if (!tee || !Array.isArray(clubs) || !clubs.length) {
    return { type: 'FeatureCollection', features: [] }
  }
  const maxYards = Number.isFinite(options.maxYards) ? options.maxYards : Infinity
  const teePt = turf.point(tee)
  const features = []
  for (const c of clubs) {
    const yards = Number(c?.carry)
    if (!Number.isFinite(yards) || yards <= 20) continue
    if (yards > maxYards + 15) continue
    const km = (yards * Y_TO_M) / 1000
    const circle = turf.circle(teePt, km, { steps: 64, units: 'kilometers' })
    circle.properties = { kind: 'carry-ring', club: c.club || '', carry: yards }
    features.push(circle)
  }
  return { type: 'FeatureCollection', features }
}

// Straight-line yardage between two [lng, lat] pairs. Used by the map to cap
// carry rings against the pin so a 275y driver doesn't spill past a 155y
// par-3 green.
export function computeTeeToPinYards(tee, pin) {
  if (!tee || !pin) return null
  const meters = turf.distance(turf.point(tee), turf.point(pin), { units: 'meters' })
  return meters * M_TO_Y
}

// Return the [lng, lat] you land on if you travel `yards` on the given
// bearing from `from`. Bearing is degrees clockwise from true north.
export function pointAtBearing(from, yards, bearing) {
  const km = (yards * Y_TO_M) / 1000
  const d = turf.destination(turf.point(from), km, bearing, { units: 'kilometers' })
  return d.geometry.coordinates
}

// Format a distance set into a short, prompt-friendly line. Returns an empty
// string when there's nothing meaningful to say (so callers can `if (line)`).
export function formatDistancesLine(d) {
  if (!d) return ''
  const parts = []
  if (d.frontY != null && d.centerY != null && d.backY != null) {
    parts.push(`green ${d.frontY}/${d.centerY}/${d.backY}y (F/C/B)`)
  }
  if (d.carries.length) {
    const c = d.carries
      .map(x => `carry ${x.kind[0].toUpperCase()}${x.kind.slice(1)} ${x.side[0].toUpperCase()} ${x.yards}y`)
      .join('; ')
    parts.push(c)
  }
  return parts.join('; ')
}
