import { describe, it, expect } from 'vitest'
import { computeHoleDistances, formatDistancesLine } from './courseGeometry.js'

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
