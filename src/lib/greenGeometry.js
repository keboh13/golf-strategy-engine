// Derive a green's real shape, dimensions, and SVG outline from the OSM-
// extracted geojson (features with `properties.kind === 'green'`). When
// available, this replaces the AI's generic schematic in GreenView.
//
// Everything here is pure: no React, no fetch. Inputs are FeatureCollection
// objects (the same `displayGeo.geojson` rendered on CourseHoleMap) and a
// hole ref. All distances returned in yards to match the rest of the app.

import * as turf from '@turf/turf'

const M_TO_Y = 1.09361
const EARTH_R = 6378137 // WGS84 mean radius (m)

function holeFeatures(geojson, holeRef) {
  const out = { centerline: null, pin: null, tee: null, greens: [] }
  if (!geojson?.features) return out
  for (const f of geojson.features) {
    if (f.properties?.holeRef !== holeRef) continue
    const k = f.properties.kind
    if (k === 'centerline' && f.geometry?.type === 'LineString') out.centerline = f
    else if (k === 'pin' && f.geometry?.type === 'Point') out.pin = f
    else if (k === 'tee' && (f.geometry?.type === 'Polygon' || f.geometry?.type === 'Point')) out.tee = f
    else if (k === 'green' && (f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon')) out.greens.push(f)
  }
  return out
}

// Pick the largest-area outer ring across one Polygon or MultiPolygon feature.
function ringOf(feature) {
  if (!feature?.geometry) return null
  const g = feature.geometry
  if (g.type === 'Polygon') return g.coordinates[0] || null
  if (g.type === 'MultiPolygon') {
    let best = null, bestA = -1
    for (const poly of g.coordinates) {
      const ring = poly[0]
      if (!ring) continue
      try {
        const a = turf.area(turf.polygon([ring]))
        if (a > bestA) { bestA = a; best = ring }
      } catch {}
    }
    return best
  }
  return null
}

function ringCentroid(ring) {
  // Use turf so we match exactly what the rest of the codebase does.
  return turf.centroid(turf.polygon([ring])).geometry.coordinates
}

// Project a [lng,lat] to local meters relative to a [lng,lat] centroid using
// equirectangular at the centroid latitude (~accurate at the scale of a green).
function projectMeters(coord, centroidLngLat) {
  const clatRad = centroidLngLat[1] * Math.PI / 180
  const dx = (coord[0] - centroidLngLat[0]) * (Math.PI / 180) * EARTH_R * Math.cos(clatRad)
  const dy = (coord[1] - centroidLngLat[1]) * (Math.PI / 180) * EARTH_R
  return [dx, dy]
}

// Rotate a [dx,dy] point by `theta` radians around the origin.
function rotate(p, theta) {
  const c = Math.cos(theta), s = Math.sin(theta)
  return [p[0] * c - p[1] * s, p[0] * s + p[1] * c]
}

// Approach bearing: direction the player faces when hitting into the green
// (tee → pin), in degrees clockwise from north. Used to orient the green so
// "back of green" sits at the top of the SVG.
function approachBearing({ centerline, pin, tee, centroidLngLat }) {
  // Best signal: the last segment of the centerline (always ends near the pin).
  if (centerline?.geometry?.coordinates?.length >= 2) {
    const coords = centerline.geometry.coordinates
    const a = coords[coords.length - 2]
    const b = coords[coords.length - 1]
    try { return turf.bearing(turf.point(a), turf.point(b)) } catch {}
  }
  // Fallback: tee → pin (or tee → green centroid).
  if (tee && (pin || centroidLngLat)) {
    const teeCoord = tee.geometry.type === 'Point'
      ? tee.geometry.coordinates
      : ringCentroid(tee.geometry.coordinates[0])
    const target = pin?.geometry?.coordinates || centroidLngLat
    try { return turf.bearing(turf.point(teeCoord), turf.point(target)) } catch {}
  }
  return 0 // north — last-resort default
}

function classifyShape({ areaM2, perimeterM, widthY, depthY, rotatedRing }) {
  if (areaM2 <= 0 || perimeterM <= 0 || widthY <= 0 || depthY <= 0) return 'oval'
  const compactness = (4 * Math.PI * areaM2) / (perimeterM * perimeterM)
  const aspect = depthY / widthY
  if (compactness > 0.85) return 'round'
  if (aspect > 1.6 || aspect < 0.6) return 'oblong'
  // Concavity via convex-hull area in local meters (avoids re-projecting).
  try {
    const fc = turf.featureCollection(rotatedRing.map(p => turf.point(p)))
    const hull = turf.convex(fc)
    if (hull) {
      const hullArea = polygonAreaM2(hull.geometry.coordinates[0])
      const concavity = (hullArea - areaM2) / Math.max(hullArea, 1)
      if (concavity > 0.12) return 'kidney'
    }
  } catch {}
  return 'oval'
}

// Shoelace area on a ring of [x,y] points already in meters.
function polygonAreaM2(ring) {
  let s = 0
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[(i + 1) % n]
    s += x1 * y2 - x2 * y1
  }
  return Math.abs(s) / 2
}

function ringPerimeterM(ring) {
  let p = 0
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[(i + 1) % n]
    p += Math.hypot(x2 - x1, y2 - y1)
  }
  return p
}

export function extractGreenForHole(geojson, holeRef) {
  const { centerline, pin, tee, greens } = holeFeatures(geojson, holeRef)
  if (greens.length === 0) return null

  // Pick the largest-area green for the hole (handles courses where multiple
  // polygons share the same holeRef tag).
  let best = null, bestArea = -1
  for (const f of greens) {
    const ring = ringOf(f)
    if (!ring || ring.length < 4) continue
    let a = 0
    try { a = turf.area(turf.polygon([ring])) } catch {}
    if (a > bestArea) { bestArea = a; best = ring }
  }
  if (!best) return null

  const centroidLngLat = ringCentroid(best)
  const bearing = approachBearing({ centerline, pin, tee, centroidLngLat })
  // Rotate so the approach direction aligns with +Y (north → up). Bearing is
  // clockwise from north; the local-meter +Y already points north, so we
  // rotate the ring by -bearing radians.
  const theta = -bearing * Math.PI / 180
  const rotated = best.map(c => rotate(projectMeters(c, centroidLngLat), theta))

  // Axis-aligned bbox in the rotated frame: cross-approach = width, along-
  // approach = depth.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const [x, y] of rotated) {
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
  }
  const widthM = maxX - minX
  const depthM = maxY - minY
  const widthY = Math.round(widthM * M_TO_Y)
  const depthY = Math.round(depthM * M_TO_Y)

  const perimeterM = ringPerimeterM(rotated)
  const shape = classifyShape({ areaM2: bestArea, perimeterM, widthY, depthY, rotatedRing: rotated })

  return {
    polygonLngLat: best,
    rotatedRingM: rotated,
    centroidLngLat,
    approachBearing: bearing,
    widthY,
    depthY,
    shape,
    areaM2: bestArea,
  }
}

// Convert the rotated-meter ring into an SVG path string sized to fit a
// viewW × viewH viewport, with a uniform `margin` (px) on all sides. Preserves
// aspect ratio; flips Y because SVG's +Y points down while our rotated frame's
// +Y points to "back of green" (we want back at top of image).
export function polygonToSvgPath(rotatedRingM, viewW, viewH, margin = 14) {
  if (!Array.isArray(rotatedRingM) || rotatedRingM.length < 3) return null
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const [x, y] of rotatedRingM) {
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
  }
  const wM = Math.max(maxX - minX, 0.01)
  const hM = Math.max(maxY - minY, 0.01)
  const sx = (viewW - 2 * margin) / wM
  const sy = (viewH - 2 * margin) / hM
  const scale = Math.min(sx, sy) // uniform scaling preserves shape
  const cxM = (minX + maxX) / 2
  const cyM = (minY + maxY) / 2
  const cxPx = viewW / 2
  const cyPx = viewH / 2
  const parts = []
  for (let i = 0; i < rotatedRingM.length; i++) {
    const [xM, yM] = rotatedRingM[i]
    const px = cxPx + (xM - cxM) * scale
    const py = cyPx - (yM - cyM) * scale // flip Y for SVG
    parts.push(`${i === 0 ? 'M' : 'L'}${px.toFixed(2)},${py.toFixed(2)}`)
  }
  parts.push('Z')
  return parts.join(' ')
}

// Merge OSM-derived geometry with the AI-generated semantic green. OSM wins
// for shape/dimensions/outline; AI overlays pin, slope, tiers, hazards, notes.
export function mergeGreen(aiGreen, osmGreen) {
  if (!osmGreen) {
    if (!aiGreen) return null
    return { ...aiGreen, _source: 'ai' }
  }
  const base = aiGreen || {}
  return {
    ...base,
    shape: osmGreen.shape,
    width_y: osmGreen.widthY,
    depth_y: osmGreen.depthY,
    polygonRingM: osmGreen.rotatedRingM,
    _source: aiGreen ? 'osm+ai' : 'osm',
  }
}
