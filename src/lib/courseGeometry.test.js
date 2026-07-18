import { describe, it, expect } from 'vitest'
import { computeHoleDistances, formatDistancesLine, simplifyAndTrimGeoJSON, getHoleAnchor, buildCarryRings } from './courseGeometry.js'

// Build a straight north-pointing hole at the equator (where 1° lng ≈ 1° lat
// in length, makes mental arithmetic simpler). 1° lat ≈ 111_111 meters.
const M_TO_Y = 1.09361

const lineFeature = (coords) => ({
  type: 'Feature',
  properties: { kind: 'centerline', holeRef: 1, par: 4 },
  geometry: { type: 'LineString', coordinates: coords },
})

const polyFeature = (kind, ring, holeRef = 1) => ({
  type: 'Feature',
  properties: { kind, holeRef },
  geometry: { type: 'Polygon', coordinates: [ring] },
})

const pointFeature = (coord, holeRef = 1) => ({
  type: 'Feature',
  properties: { kind: 'pin', holeRef },
  geometry: { type: 'Point', coordinates: coord },
})

// 50m-wide square ring centered at [lng, lat], in degrees.
const ringAround = (lng, lat, halfMeters = 25) => {
  const dLat = halfMeters / 111111
  const dLng = halfMeters / 111111 // close enough at the equator
  return [
    [lng - dLng, lat - dLat],
    [lng + dLng, lat - dLat],
    [lng + dLng, lat + dLat],
    [lng - dLng, lat + dLat],
    [lng - dLng, lat - dLat],
  ]
}

const fc = (features) => ({ type: 'FeatureCollection', features })

describe('computeHoleDistances', () => {
  it('returns null when there is no centerline', () => {
    const gj = fc([polyFeature('green', ringAround(0, 0.001))])
    expect(computeHoleDistances(gj, 1)).toBe(null)
  })

  it('computes tee→pin for a straight north line, falling back to last vertex when no green/pin', () => {
    // 400m line ≈ 437 yards
    const gj = fc([lineFeature([[0, 0], [0, 0.0036]])])
    const d = computeHoleDistances(gj, 1)
    expect(d).not.toBeNull()
    expect(d.teeToPin).toBeGreaterThanOrEqual(430)
    expect(d.teeToPin).toBeLessThanOrEqual(445)
  })

  it('uses the explicit pin point when present', () => {
    const gj = fc([
      lineFeature([[0, 0], [0, 0.005]]),
      pointFeature([0, 0.004]), // ~444m north → ~485y
    ])
    const d = computeHoleDistances(gj, 1)
    expect(d.teeToPin).toBeGreaterThanOrEqual(480)
    expect(d.teeToPin).toBeLessThanOrEqual(490)
  })

  it('computes front/center/back of green along the centerline', () => {
    // Green centered at lat 0.003 (≈333m ≈ 364y) with ±25m extent.
    const gj = fc([
      lineFeature([[0, 0], [0, 0.004]]),
      polyFeature('green', ringAround(0, 0.003)),
    ])
    const d = computeHoleDistances(gj, 1)
    expect(d.frontY).toBeLessThan(d.centerY)
    expect(d.centerY).toBeLessThan(d.backY)
    expect(d.frontY).toBeGreaterThanOrEqual(330)
    expect(d.backY).toBeLessThanOrEqual(395)
  })

  it('reports carry distances from the tee, excludes hazards beyond the green, and sorts ascending', () => {
    const gj = fc([
      lineFeature([[0, 0], [0, 0.004]]),
      polyFeature('green', ringAround(0, 0.0035)),
      // Bunker at ~150m from tee, right of centerline
      polyFeature('bunker', ringAround(0.0003, 0.00135)),
      // Water at ~250m from tee, left of centerline
      polyFeature('water', ringAround(-0.0003, 0.00225)),
      // Bunker BEHIND the green (should be excluded)
      polyFeature('bunker', ringAround(0, 0.0042)),
    ])
    const d = computeHoleDistances(gj, 1)
    const carryYards = d.carries.map(c => c.yards)
    expect(carryYards).toEqual([...carryYards].sort((a, b) => a - b)) // ascending
    expect(d.carries.length).toBe(2)
    const bunker = d.carries.find(c => c.kind === 'bunker')
    const water  = d.carries.find(c => c.kind === 'water')
    expect(bunker.side).toBe('right')
    expect(water.side).toBe('left')
    // Hazards are ~25m-radius squares; carry is to the nearest edge along the
    // centerline, so it lands ~25m short of the centroid.
    expect(bunker.yards).toBeGreaterThanOrEqual(125)
    expect(bunker.yards).toBeLessThanOrEqual(165)
    expect(water.yards).toBeGreaterThanOrEqual(215)
    expect(water.yards).toBeLessThanOrEqual(265)
  })

  it('ignores features for other holes', () => {
    const gj = fc([
      lineFeature([[0, 0], [0, 0.004]]),
      polyFeature('green', ringAround(0, 0.0035)),
      polyFeature('bunker', ringAround(0.0003, 0.00135), 2), // hole 2
    ])
    const d = computeHoleDistances(gj, 1)
    expect(d.carries.length).toBe(0)
  })
})

describe('formatDistancesLine', () => {
  it('returns an empty string when given null', () => {
    expect(formatDistancesLine(null)).toBe('')
  })

  it('omits the green section when F/C/B are missing', () => {
    const out = formatDistancesLine({ teeToPin: 400, frontY: null, centerY: null, backY: null, carries: [] })
    expect(out).toBe('')
  })

  it('formats green and carries together', () => {
    const out = formatDistancesLine({
      teeToPin: 425, frontY: 142, centerY: 158, backY: 168,
      carries: [{ kind: 'bunker', side: 'right', yards: 235 }, { kind: 'water', side: 'left', yards: 250 }],
    })
    expect(out).toContain('green 142/158/168y (F/C/B)')
    expect(out).toContain('carry Bunker R 235y')
    expect(out).toContain('carry Water L 250y')
  })
})

describe('simplifyAndTrimGeoJSON', () => {
  it('returns the same shape with trimmed coordinates', () => {
    const fc = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature', properties: { kind: 'centerline', holeRef: 1 },
          geometry: { type: 'LineString', coordinates: [[-116.123456789, 33.123456789], [-116.123456788, 33.124456789]] },
        },
        {
          type: 'Feature', properties: { kind: 'green', holeRef: 1 },
          geometry: { type: 'Polygon', coordinates: [[
            [-116.123456789, 33.123456789], [-116.123, 33.123], [-116.124, 33.124], [-116.123456789, 33.123456789],
          ]] },
        },
        {
          type: 'Feature', properties: { kind: 'pin', holeRef: 1 },
          geometry: { type: 'Point', coordinates: [-116.123456789, 33.123456789] },
        },
      ],
    }
    const out = simplifyAndTrimGeoJSON(fc)
    expect(out.features).toHaveLength(3)
    const decimals = (n) => (n.toString().split('.')[1] || '').length
    // Centerline first vertex
    const lineFirst = out.features[0].geometry.coordinates[0]
    expect(decimals(lineFirst[0])).toBeLessThanOrEqual(6)
    expect(decimals(lineFirst[1])).toBeLessThanOrEqual(6)
    // Polygon first vertex
    const polyFirst = out.features[1].geometry.coordinates[0][0]
    expect(decimals(polyFirst[0])).toBeLessThanOrEqual(6)
    expect(decimals(polyFirst[1])).toBeLessThanOrEqual(6)
    // Pin coords are kept full-precision (we don't trim Points)
    expect(out.features[2].geometry.coordinates).toEqual([-116.123456789, 33.123456789])
  })

  it('is a no-op when geojson has no features', () => {
    expect(simplifyAndTrimGeoJSON(null)).toBe(null)
    expect(simplifyAndTrimGeoJSON({ type: 'FeatureCollection', features: [] }).features).toEqual([])
  })
})

describe('getHoleAnchor', () => {
  it('pulls tee & pin from the centerline vertices', () => {
    const gj = fc([lineFeature([[0, 0], [0, 0.004]])])
    const a = getHoleAnchor(gj, 1)
    expect(a.tee).toEqual([0, 0])
    expect(a.pin).toEqual([0, 0.004])
    expect(a.bearing).toBeCloseTo(0, 1) // due north
  })
  it('prefers an explicit pin point over the centerline endpoint', () => {
    const gj = fc([lineFeature([[0, 0], [0, 0.004]]), pointFeature([0, 0.003])])
    expect(getHoleAnchor(gj, 1).pin).toEqual([0, 0.003])
  })
  it('falls back to the green centroid when there is no pin', () => {
    const gj = fc([lineFeature([[0, 0], [0, 0.004]]), polyFeature('green', ringAround(0, 0.0035))])
    const a = getHoleAnchor(gj, 1)
    expect(a.pin[1]).toBeCloseTo(0.0035, 5)
  })
  it('returns null when the hole has no relevant features', () => {
    const gj = fc([polyFeature('bunker', ringAround(0, 0.002), 2)])
    expect(getHoleAnchor(gj, 1)).toBeNull()
  })
})

describe('buildCarryRings', () => {
  it('emits one polygon per playable club, filtering the driver on a short par-3', () => {
    const clubs = [
      { club: 'Driver', carry: 275 },
      { club: '7-iron', carry: 160 },
      { club: 'PW',     carry: 120 },
      { club: 'putter', carry: 0 },    // ignored (carry <= 20)
    ]
    const fc1 = buildCarryRings([0, 0], clubs, { maxYards: 155 })
    const carries = fc1.features.map(f => f.properties.carry).sort((a, b) => a - b)
    // PW (120) and 7-iron (160 — within 15y grace) fit; Driver dropped.
    expect(carries).toEqual([120, 160])
  })
  it('is a no-op without a tee or without clubs', () => {
    expect(buildCarryRings(null, [{ club: 'Driver', carry: 275 }]).features).toEqual([])
    expect(buildCarryRings([0, 0], []).features).toEqual([])
  })
})
