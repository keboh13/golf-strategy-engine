// Turf-backed distance math for Tier 1 holes. Distances are measured **from
// the tee along the centerline** — carry distances to hazards make sense off
// the tee, not around the green. Front/center/back of green stay useful for
// approach planning.
//
// All distances are returned in yards (`m * 1.09361`) to match the rest of the
// app (see metersToYards in osmCourseData.js).

import * as turf from '@turf/turf'

const M_TO_Y = 1.09361

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
