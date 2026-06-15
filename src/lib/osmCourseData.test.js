import { describe, it, expect } from 'vitest'
import { enrichHolesWithOSM, exportCourseGeoJSON, classifyTier, computeCoverage } from './osmCourseData.js'

describe('enrichHolesWithOSM', () => {
  const baseHoles = Array.from({ length: 18 }, (_, i) => ({
    par: i < 4 ? 4 : i === 4 ? 5 : i === 5 ? 3 : 4,
    yardage: String(350 + i * 10),
    handicap: i + 1,
    notes: '',
  }))

  it('returns unchanged holes when osmData is null', () => {
    const result = enrichHolesWithOSM(baseHoles, null)
    expect(result.hasDesignData).toBe(false)
    expect(result.holes).toBe(baseHoles)
  })

  it('returns unchanged holes when fewer than 3 pins', () => {
    const osmData = {
      pins: [{ lat: 33.65, lng: -116.26 }],
      bunkers: [],
      waterHazards: [],
      greens: [],
      tees: [],
      holes: [],
    }
    const result = enrichHolesWithOSM(baseHoles, osmData)
    expect(result.hasDesignData).toBe(false)
  })

  it('enriches holes from golf=hole ways with ref tags', () => {
    const osmHoles = Array.from({ length: 18 }, (_, i) => ({
      ref: i + 1,
      par: 4,
      nodes: [
        { lat: 33.64 + i * 0.001, lng: -116.26 },
        { lat: 33.64 + i * 0.001 + 0.002, lng: -116.26 },
        { lat: 33.64 + i * 0.001 + 0.003, lng: -116.26 },
      ],
    }))

    // Place a bunker near hole 1's green (last node)
    const greenLat = osmHoles[0].nodes[2].lat
    const greenLng = osmHoles[0].nodes[2].lng
    const bunkers = [{ lat: greenLat + 0.0002, lng: greenLng + 0.0003 }]

    const osmData = {
      pins: [],
      bunkers,
      waterHazards: [],
      greens: [],
      tees: [],
      holes: osmHoles,
    }

    const result = enrichHolesWithOSM(baseHoles, osmData)
    expect(result.hasDesignData).toBe(true)
    expect(result.holes[0].osmDesign).toBeDefined()
    expect(result.holes[0].osmDesign.source).toBe('OpenStreetMap')
    expect(result.holes[0].osmDesign.hazards.length).toBeGreaterThan(0)
    expect(result.holes[0].osmDesign.hazards[0].type).toBe('bunker')
  })

  it('detects dogleg from intermediate nodes', () => {
    // Create a hole that doglegs right: tee heads north, mid shifts east, green continues north
    const osmHoles = [{
      ref: 1,
      par: 4,
      nodes: [
        { lat: 33.64, lng: -116.26 },       // tee
        { lat: 33.642, lng: -116.258 },      // mid - shifted east (right for northbound hole)
        { lat: 33.644, lng: -116.258 },      // green
      ],
    }]
    // Fill remaining 17 holes
    for (let i = 2; i <= 18; i++) {
      osmHoles.push({
        ref: i, par: 4,
        nodes: [
          { lat: 33.64 + i * 0.005, lng: -116.26 },
          { lat: 33.64 + i * 0.005 + 0.002, lng: -116.26 },
          { lat: 33.64 + i * 0.005 + 0.003, lng: -116.26 },
        ],
      })
    }

    const osmData = {
      pins: [], bunkers: [], waterHazards: [], greens: [], tees: [],
      holes: osmHoles,
    }

    const result = enrichHolesWithOSM(baseHoles, osmData)
    expect(['left', 'right']).toContain(result.holes[0].osmDesign.dogleg)
  })

  it('does not overwrite user-entered notes', () => {
    const holesWithNotes = baseHoles.map((h, i) =>
      i === 0 ? { ...h, notes: 'user note: water right' } : h
    )
    const osmHoles = Array.from({ length: 18 }, (_, i) => ({
      ref: i + 1, par: 4,
      nodes: [
        { lat: 33.64 + i * 0.005, lng: -116.26 },
        { lat: 33.64 + i * 0.005 + 0.003, lng: -116.26 },
      ],
    }))

    const osmData = {
      pins: [], bunkers: [{ lat: 33.643, lng: -116.2598 }],
      waterHazards: [], greens: [], tees: [],
      holes: osmHoles,
    }

    const result = enrichHolesWithOSM(holesWithNotes, osmData)
    expect(result.holes[0].notes).toBe('user note: water right')
  })

  it('classifies water hazards near greens', () => {
    const osmHoles = Array.from({ length: 18 }, (_, i) => ({
      ref: i + 1, par: 4,
      nodes: [
        { lat: 33.64 + i * 0.005, lng: -116.26 },
        { lat: 33.64 + i * 0.005 + 0.003, lng: -116.26 },
      ],
    }))

    // Water hazard to the left of hole 1's green
    const greenLat = osmHoles[0].nodes[1].lat
    const greenLng = osmHoles[0].nodes[1].lng
    const waterHazards = [{ lat: greenLat, lng: greenLng - 0.0003 }]

    const osmData = {
      pins: [], bunkers: [], waterHazards, greens: [], tees: [],
      holes: osmHoles,
    }

    const result = enrichHolesWithOSM(baseHoles, osmData)
    const h1Hazards = result.holes[0].osmDesign.hazards
    expect(h1Hazards.some(h => h.type === 'water')).toBe(true)
  })
})

describe('exportCourseGeoJSON', () => {
  // Helper: build a square ring of `nodes` ~30m wide around (lat, lng).
  const ring = (lat, lng, d = 0.0003) => [
    { lat: lat - d, lng: lng - d },
    { lat: lat - d, lng: lng + d },
    { lat: lat + d, lng: lng + d },
    { lat: lat + d, lng: lng - d },
  ]

  const makeOsm = ({ holes = [], greens = [], bunkers = [], waterHazards = [], fairways = [], tees = [], pins = [] } = {}) =>
    ({ holes, greens, bunkers, waterHazards, fairways, tees, pins })

  it('returns an empty FeatureCollection when osmData is null', () => {
    const gj = exportCourseGeoJSON(null)
    expect(gj.type).toBe('FeatureCollection')
    expect(gj.features).toEqual([])
    expect(gj.bboxByHole).toEqual({})
  })

  it('emits centerlines from golf=hole ways with valid refs', () => {
    const osm = makeOsm({
      holes: [
        { ref: 1, par: 4, nodes: [{ lat: 33.64, lng: -116.26 }, { lat: 33.643, lng: -116.26 }] },
        { ref: 2, par: 3, nodes: [{ lat: 33.645, lng: -116.26 }, { lat: 33.647, lng: -116.26 }] },
      ],
    })
    const gj = exportCourseGeoJSON(osm)
    const lines = gj.features.filter(f => f.properties.kind === 'centerline')
    expect(lines).toHaveLength(2)
    // Coordinate order is [lng, lat]
    expect(lines[0].geometry.coordinates[0]).toEqual([-116.26, 33.64])
    expect(lines[0].properties.holeRef).toBe(1)
    expect(lines[0].properties.par).toBe(4)
  })

  it('emits polygons as closed rings in [lng, lat] order', () => {
    const greenLat = 33.643, greenLng = -116.26
    const osm = makeOsm({
      holes: [{ ref: 1, par: 4, nodes: [{ lat: 33.64, lng: -116.26 }, { lat: greenLat, lng: greenLng }] }],
      greens: [{ lat: greenLat, lng: greenLng, nodes: ring(greenLat, greenLng) }],
    })
    const gj = exportCourseGeoJSON(osm)
    const green = gj.features.find(f => f.properties.kind === 'green')
    expect(green).toBeDefined()
    expect(green.geometry.type).toBe('Polygon')
    const r = green.geometry.coordinates[0]
    // closed: first === last
    expect(r[0]).toEqual(r[r.length - 1])
    // [lng, lat]
    expect(r[0][0]).toBeCloseTo(greenLng - 0.0003)
    expect(r[0][1]).toBeCloseTo(greenLat - 0.0003)
    expect(green.properties.holeRef).toBe(1)
  })

  it('assigns bunker/water/fairway/tee to nearest hole within tolerance', () => {
    const greenLat = 33.643, greenLng = -116.26
    const osm = makeOsm({
      holes: [{ ref: 1, par: 4, nodes: [{ lat: 33.64, lng: -116.26 }, { lat: greenLat, lng: greenLng }] }],
      bunkers: [{ lat: greenLat + 0.0002, lng: greenLng, nodes: ring(greenLat + 0.0002, greenLng) }],
      waterHazards: [{ lat: greenLat - 0.0002, lng: greenLng + 0.0002, nodes: ring(greenLat - 0.0002, greenLng + 0.0002) }],
      fairways: [{ lat: 33.642, lng: -116.26, nodes: ring(33.642, -116.26, 0.001) }],
      tees: [{ lat: 33.64, lng: -116.26, nodes: ring(33.64, -116.26) }],
    })
    const gj = exportCourseGeoJSON(osm)
    const byKind = (k) => gj.features.find(f => f.properties.kind === k)
    expect(byKind('bunker').properties.holeRef).toBe(1)
    expect(byKind('water').properties.holeRef).toBe(1)
    expect(byKind('fairway').properties.holeRef).toBe(1)
    expect(byKind('tee').properties.holeRef).toBe(1)
  })

  it('emits pins as Points and prefers pin.ref when present', () => {
    const osm = makeOsm({
      holes: [{ ref: 1, par: 4, nodes: [{ lat: 33.64, lng: -116.26 }, { lat: 33.643, lng: -116.26 }] }],
      pins: [{ lat: 40.0, lng: -100.0, ref: '7' }],
    })
    const gj = exportCourseGeoJSON(osm)
    const pin = gj.features.find(f => f.properties.kind === 'pin')
    expect(pin.geometry.type).toBe('Point')
    expect(pin.geometry.coordinates).toEqual([-100.0, 40.0])
    expect(pin.properties.holeRef).toBe(7)
  })

  it('computes a bbox per hole that covers the centerline and assigned features', () => {
    const osm = makeOsm({
      holes: [{ ref: 1, par: 4, nodes: [{ lat: 33.64, lng: -116.26 }, { lat: 33.643, lng: -116.258 }] }],
      greens: [{ lat: 33.643, lng: -116.258, nodes: ring(33.643, -116.258) }],
    })
    const gj = exportCourseGeoJSON(osm)
    const [w, s, e, n] = gj.bboxByHole[1]
    expect(w).toBeLessThanOrEqual(-116.26)
    expect(e).toBeGreaterThanOrEqual(-116.258)
    expect(s).toBeLessThanOrEqual(33.64)
    expect(n).toBeGreaterThanOrEqual(33.643)
  })
})

describe('classifyTier', () => {
  const baseHoles = Array.from({ length: 18 }, () => ({ par: 4 }))

  const fc = (features) => ({ type: 'FeatureCollection', features })
  const greenFeat = (ref) => ({ type: 'Feature', properties: { kind: 'green', holeRef: ref }, geometry: { type: 'Polygon', coordinates: [[]] } })
  const centerlineFeat = (ref) => ({ type: 'Feature', properties: { kind: 'centerline', holeRef: ref }, geometry: { type: 'LineString', coordinates: [] } })
  const fairwayFeat = (ref) => ({ type: 'Feature', properties: { kind: 'fairway', holeRef: ref }, geometry: { type: 'Polygon', coordinates: [[]] } })

  it('returns 1 when ≥70% greens and ≥70% holeways are present', () => {
    const feats = []
    for (let i = 1; i <= 14; i++) feats.push(greenFeat(i), centerlineFeat(i))
    expect(classifyTier(fc(feats), baseHoles)).toBe(1)
  })

  it('returns 1 when ≥70% greens and ≥50% fairways are present (no centerlines)', () => {
    const feats = []
    for (let i = 1; i <= 14; i++) feats.push(greenFeat(i))
    for (let i = 1; i <= 9; i++) feats.push(fairwayFeat(i))
    expect(classifyTier(fc(feats), baseHoles)).toBe(1)
  })

  it('returns 2 when only some greens or holeways are present', () => {
    const feats = []
    for (let i = 1; i <= 11; i++) feats.push(greenFeat(i)) // 11 of 18 → not enough for Tier 1
    expect(classifyTier(fc(feats), baseHoles)).toBe(2)
  })

  it('returns 2 with exactly 3 greens', () => {
    const feats = [greenFeat(1), greenFeat(2), greenFeat(3)]
    expect(classifyTier(fc(feats), baseHoles)).toBe(2)
  })

  it('returns 3 with <3 greens and no holeways', () => {
    expect(classifyTier(fc([greenFeat(1), greenFeat(2)]), baseHoles)).toBe(3)
    expect(classifyTier(fc([]), baseHoles)).toBe(3)
    expect(classifyTier(null, baseHoles)).toBe(3)
  })
})

describe('computeCoverage', () => {
  it('reports per-hole feature presence', () => {
    const baseHoles = Array.from({ length: 18 }, () => ({ par: 4 }))
    const features = [
      { properties: { kind: 'green', holeRef: 1 }, geometry: { type: 'Polygon', coordinates: [[]] } },
      { properties: { kind: 'bunker', holeRef: 1 }, geometry: { type: 'Polygon', coordinates: [[]] } },
      { properties: { kind: 'centerline', holeRef: 2 }, geometry: { type: 'LineString', coordinates: [] } },
    ]
    const cov = computeCoverage({ type: 'FeatureCollection', features }, baseHoles)
    expect(cov[1].green).toBe(true)
    expect(cov[1].bunker).toBe(true)
    expect(cov[1].centerline).toBe(false)
    expect(cov[2].centerline).toBe(true)
    expect(cov[3].green).toBe(false)
  })
})
