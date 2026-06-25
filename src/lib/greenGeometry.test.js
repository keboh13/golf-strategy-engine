import { describe, it, expect } from 'vitest'
import { extractGreenForHole, polygonToSvgPath, mergeGreen } from './greenGeometry.js'

// Build all fixtures at the equator (lat 0) so 1° ≈ 111320m in BOTH axes,
// keeping the maths simple.
const ORIGIN = [-77, 0]
const M_PER_DEG = 111320

function metersToLngLat([dxM, dyM], origin = ORIGIN) {
  return [origin[0] + dxM / M_PER_DEG, origin[1] + dyM / M_PER_DEG]
}

function ringFromMeters(metersRing, origin = ORIGIN) {
  const ll = metersRing.map(p => metersToLngLat(p, origin))
  if (ll[0][0] !== ll[ll.length - 1][0] || ll[0][1] !== ll[ll.length - 1][1]) ll.push(ll[0])
  return ll
}

function greenFeature(metersRing, holeRef, origin = ORIGIN) {
  return {
    type: 'Feature',
    properties: { kind: 'green', holeRef },
    geometry: { type: 'Polygon', coordinates: [ringFromMeters(metersRing, origin)] },
  }
}

function centerlineFeature(metersLine, holeRef, origin = ORIGIN) {
  return {
    type: 'Feature',
    properties: { kind: 'centerline', holeRef },
    geometry: { type: 'LineString', coordinates: metersLine.map(p => metersToLngLat(p, origin)) },
  }
}

function fc(...features) {
  return { type: 'FeatureCollection', features }
}

function regularPolygon(n, rM) {
  const out = []
  for (let i = 0; i < n; i++) {
    const t = (i / n) * 2 * Math.PI
    out.push([rM * Math.cos(t), rM * Math.sin(t)])
  }
  return out
}

describe('extractGreenForHole', () => {
  it('classifies a near-circle as round', () => {
    const ring = regularPolygon(24, 12)
    const g = extractGreenForHole(fc(greenFeature(ring, 1)), 1)
    expect(g).not.toBeNull()
    expect(g.shape).toBe('round')
    expect(g.widthY).toBeGreaterThan(20)
    expect(g.widthY).toBeLessThan(30)
    expect(Math.abs(g.widthY - g.depthY)).toBeLessThanOrEqual(2)
  })

  it('classifies an elongated rectangle as oblong with orientation set by the centerline', () => {
    // 30m E–W, 10m N–S, centred at origin.
    const ring = [[-15, -5], [15, -5], [15, 5], [-15, 5]]
    // Centerline approaching from the west — last segment points due east → bearing 90°.
    const line = [[-100, 0], [-20, 0]]
    const g = extractGreenForHole(fc(greenFeature(ring, 7), centerlineFeature(line, 7)), 7)
    expect(g).not.toBeNull()
    expect(g.shape).toBe('oblong')
    // After rotation, the 30m E–W extent becomes depth (along approach), and
    // the 10m N–S extent becomes width (cross-approach).
    expect(g.depthY).toBeGreaterThan(g.widthY * 2)
    expect(g.depthY).toBeGreaterThan(30) // 30m → 32.8y
    expect(g.widthY).toBeLessThan(13)    // 10m → 10.9y
  })

  it('classifies a clearly concave (C-shaped) polygon as kidney', () => {
    // 20×20 square with a 10×10 bite removed from the right side.
    const ring = [
      [-10, -10], [10, -10], [10, -5],
      [0, -5], [0, 5], [10, 5],
      [10, 10], [-10, 10],
    ]
    const g = extractGreenForHole(fc(greenFeature(ring, 3)), 3)
    expect(g).not.toBeNull()
    expect(g.shape).toBe('kidney')
  })

  it('picks the largest green when multiple are tagged to the same hole', () => {
    const small = regularPolygon(16, 4)     // r=4m → area ~50 m²
    const big   = regularPolygon(16, 12)    // r=12m → area ~452 m²
    const g = extractGreenForHole(fc(
      greenFeature(small, 9),
      greenFeature(big, 9),
    ), 9)
    expect(g).not.toBeNull()
    // Picked the big one — widthY should be ~26y, not ~9y.
    expect(g.widthY).toBeGreaterThan(20)
  })

  it('returns null when the hole has no green feature', () => {
    const ring = regularPolygon(16, 10)
    const g = extractGreenForHole(fc(greenFeature(ring, 5)), 6)
    expect(g).toBeNull()
  })

  it('returns null on an empty / malformed FeatureCollection', () => {
    expect(extractGreenForHole(null, 1)).toBeNull()
    expect(extractGreenForHole({ features: [] }, 1)).toBeNull()
  })
})

describe('polygonToSvgPath', () => {
  it('produces a closed SVG path centred in the viewport', () => {
    const ring = regularPolygon(16, 10)
    const path = polygonToSvgPath(ring, 300, 200, 10)
    expect(path).toMatch(/^M/)
    expect(path).toMatch(/Z$/)
    // 17 commands (16 vertices + close) — at minimum every coord pair.
    expect((path.match(/[ML]/g) || []).length).toBe(16)
  })

  it('returns null for a degenerate ring', () => {
    expect(polygonToSvgPath(null, 100, 100)).toBeNull()
    expect(polygonToSvgPath([[0, 0]], 100, 100)).toBeNull()
  })
})

describe('mergeGreen', () => {
  const aiGreen = {
    shape: 'oval', width_y: 24, depth_y: 28, pin: 'back-right',
    slope: 'back-to-front', tiers: 2, tier_desc: 'small upper shelf',
    green_notes: 'firm', hazards: [{ type: 'bunker', loc: 'right' }],
    confidence: 'estimated',
  }
  const osmGreen = {
    shape: 'kidney', widthY: 31, depthY: 22,
    rotatedRingM: [[0, 0], [10, 0], [10, 10]], centroidLngLat: [-77, 39],
    approachBearing: 12, areaM2: 350,
  }

  it('OSM geometry overrides AI shape/dimensions; AI semantics overlay', () => {
    const merged = mergeGreen(aiGreen, osmGreen)
    expect(merged.shape).toBe('kidney')
    expect(merged.width_y).toBe(31)
    expect(merged.depth_y).toBe(22)
    expect(merged.pin).toBe('back-right')
    expect(merged.slope).toBe('back-to-front')
    expect(merged.tiers).toBe(2)
    expect(merged.hazards).toHaveLength(1)
    expect(merged.polygonRingM).toEqual(osmGreen.rotatedRingM)
    expect(merged._source).toBe('osm+ai')
  })

  it('returns AI verbatim with _source=ai when osmGreen is null', () => {
    const merged = mergeGreen(aiGreen, null)
    expect(merged.shape).toBe('oval')
    expect(merged.width_y).toBe(24)
    expect(merged._source).toBe('ai')
  })

  it('returns null when both inputs are null', () => {
    expect(mergeGreen(null, null)).toBeNull()
  })

  it('returns OSM-only with _source=osm when AI is missing', () => {
    const merged = mergeGreen(null, osmGreen)
    expect(merged.shape).toBe('kidney')
    expect(merged.width_y).toBe(31)
    expect(merged._source).toBe('osm')
  })
})
