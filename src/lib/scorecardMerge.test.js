import { describe, it, expect, vi, afterEach } from 'vitest'
import { mergeUploadedScorecard, isSameCourseKey } from './scorecardMerge.js'

// Minimal course skeleton matching App.jsx setCourse shape — includes
// fields the merge MUST preserve so we can assert they survive.
const baseHole = (overrides = {}) => ({
  par: 4, yardage: '350', handicap: 1, notes: '', elevation: '',
  osmDesign: { hazards: [{ type: 'bunker' }] },
  webDesign: { dogleg: 'left' },
  ...overrides,
})

const baseCourse = (overrides = {}) => ({
  name: 'Wolfdancer Golf Club',
  location: 'Lost Pines, TX',
  yardage: '6500',
  rating: '71.5',
  slope: '130',
  par: 72,
  source: 'GolfCourseAPI',
  selectedTee: 'Blue',
  conditions: 'Normal',
  roundType: 'Stroke play tournament',
  // Preserve-me fields
  geojson: { type: 'FeatureCollection', features: [{ type: 'Feature' }] },
  bboxByHole: { 1: [0, 0, 1, 1] },
  coverage: { mapped: 18, total: 18 },
  tier: 1,
  osmEnriched: true,
  hazardsLoaded: false,
  contribByRef: { 5: { teeLng: 0, teeLat: 0, pinLng: 1, pinLat: 1 } },
  webDesignSource: 'greenskeeper.org',
  tees: [{ tee_name: 'Champion', total_yards: 7100 }],
  holes: Array.from({ length: 18 }, (_, i) => baseHole({ handicap: i + 1 })),
  ...overrides,
})

const uploadedPayload = (overrides = {}) => ({
  name: 'Wolfdancer Golf Club',
  location: 'Lost Pines, TX',
  yardage: 7205,
  rating: 74.4,
  slope: 138,
  par: 72,
  selectedTee: 'Champion',
  source: 'PDF (uploaded yardage book)',
  _confidence: 'high',
  _source: 'yardage_book',
  _sourcePdf: 'https://example.com/wolfdancer.pdf',
  holes: Array.from({ length: 18 }, (_, i) => ({
    par: [4,4,3,5,4,3,4,5,4,4,3,4,5,4,3,4,4,5][i],
    yardage: 380 + i * 5,
    handicap: ((i * 3) % 18) + 1,
  })),
  ...overrides,
})

afterEach(() => { vi.useRealTimers() })

describe('mergeUploadedScorecard', () => {
  it('updates top-level scorecard fields from the uploaded PDF payload', () => {
    const merged = mergeUploadedScorecard(baseCourse(), uploadedPayload())
    expect(merged.yardage).toBe('7205')          // stringified
    expect(merged.rating).toBe('74.4')
    expect(merged.slope).toBe('138')
    expect(merged.par).toBe(72)
    expect(merged.source).toBe('PDF (uploaded yardage book)')
    expect(merged.selectedTee).toBe('Champion')
  })

  it('overwrites per-hole par/yardage/handicap from the uploaded scorecard', () => {
    const merged = mergeUploadedScorecard(baseCourse(), uploadedPayload())
    expect(merged.holes).toHaveLength(18)
    expect(merged.holes[0].yardage).toBe('380')   // stringified
    expect(merged.holes[0].par).toBe(4)
    expect(merged.holes[0].handicap).toBe(1)
    expect(merged.holes[17].yardage).toBe('465')
  })

  it('preserves geometry, coverage, tier, OSM enrichment, and user contributions', () => {
    const before = baseCourse()
    const merged = mergeUploadedScorecard(before, uploadedPayload())
    expect(merged.geojson).toBe(before.geojson)
    expect(merged.bboxByHole).toBe(before.bboxByHole)
    expect(merged.coverage).toBe(before.coverage)
    expect(merged.tier).toBe(1)
    expect(merged.osmEnriched).toBe(true)
    expect(merged.contribByRef).toBe(before.contribByRef)
    expect(merged.webDesignSource).toBe('greenskeeper.org')
    expect(merged.tees).toBe(before.tees)   // uploaded has no tees[] → keep existing
    expect(merged.conditions).toBe('Normal')
  })

  it('replaces course.tees when the uploaded payload includes a tees[] array', () => {
    const pdfTees = [
      { name: 'Black', color: 'black', yardage: 7205, rating: 74.4, slope: 138, par: 72, holes: Array.from({ length: 18 }, () => ({ par: 4, yardage: 400, handicap: 1 })) },
      { name: 'Blue',  color: 'blue',  yardage: 6700, rating: 71.9, slope: 133, par: 72, holes: Array.from({ length: 18 }, () => ({ par: 4, yardage: 370, handicap: 1 })) },
      { name: 'White', color: 'white', yardage: 6200, rating: 69.5, slope: 128, par: 72, holes: Array.from({ length: 18 }, () => ({ par: 4, yardage: 345, handicap: 1 })) },
      { name: 'Gold',  color: 'gold',  yardage: 5500, rating: 66.7, slope: 121, par: 72, holes: Array.from({ length: 18 }, () => ({ par: 4, yardage: 310, handicap: 1 })) },
    ]
    const merged = mergeUploadedScorecard(baseCourse(), uploadedPayload({ tees: pdfTees }))
    expect(merged.tees).toBe(pdfTees)
    expect(merged.tees).toHaveLength(4)
    expect(merged.tees.map(t => t.name)).toEqual(['Black', 'Blue', 'White', 'Gold'])
  })

  it('keeps existing tees when the uploaded payload has an empty tees[] array', () => {
    const before = baseCourse()
    const merged = mergeUploadedScorecard(before, uploadedPayload({ tees: [] }))
    expect(merged.tees).toBe(before.tees)
  })

  it('preserves per-hole osmDesign and webDesign so the map overlay is not lost', () => {
    const merged = mergeUploadedScorecard(baseCourse(), uploadedPayload())
    expect(merged.holes[0].osmDesign).toEqual({ hazards: [{ type: 'bunker' }] })
    expect(merged.holes[0].webDesign).toEqual({ dogleg: 'left' })
  })

  it('merges hazardsByRef into the matching hole as hzDesign (1-based ref)', () => {
    const hazardsByRef = {
      1:  { dogleg: 'right', hazards: [{ type: 'water', side: 'L' }] },
      18: { dogleg: 'straight', hazards: [{ type: 'bunker', side: 'R' }] },
    }
    const merged = mergeUploadedScorecard(baseCourse(), uploadedPayload(), hazardsByRef)
    expect(merged.holes[0].hzDesign).toEqual(hazardsByRef[1])
    expect(merged.holes[17].hzDesign).toEqual(hazardsByRef[18])
    expect(merged.holes[5].hzDesign).toBeNull()              // no entry for ref=6
    expect(merged.hazardsLoaded).toBe(true)
  })

  it('keeps prior hzDesign on holes the upload did not refresh', () => {
    const prior = baseCourse({
      holes: baseCourse().holes.map((h, i) =>
        i === 0 ? { ...h, hzDesign: { hazards: [{ type: 'OB' }] } } : h
      ),
    })
    // hazardsByRef provided but does NOT cover hole 1
    const merged = mergeUploadedScorecard(prior, uploadedPayload(), { 2: { hazards: [] } })
    expect(merged.holes[0].hzDesign).toEqual({ hazards: [{ type: 'OB' }] })
  })

  it('is a no-op when uploaded payload is null/undefined/non-object', () => {
    const before = baseCourse()
    expect(mergeUploadedScorecard(before, null)).toBe(before)
    expect(mergeUploadedScorecard(before, undefined)).toBe(before)
    expect(mergeUploadedScorecard(before, 'not an object')).toBe(before)
  })

  it('returns course unchanged when course itself is null', () => {
    expect(mergeUploadedScorecard(null, uploadedPayload())).toBeNull()
  })

  it('leaves a hole untouched when the uploaded payload lacks that index', () => {
    const partialUpload = uploadedPayload({ holes: [{ par: 5, yardage: 555, handicap: 9 }] })
    const merged = mergeUploadedScorecard(baseCourse(), partialUpload)
    expect(merged.holes[0].yardage).toBe('555')
    expect(merged.holes[0].par).toBe(5)
    // hole 2..18 should retain their original base yardage of '350'
    expect(merged.holes[1].yardage).toBe('350')
    expect(merged.holes[17].yardage).toBe('350')
  })

  it('does not mutate the input course or its holes array', () => {
    const before = baseCourse()
    const beforeHoles = before.holes
    const beforeHole0 = { ...before.holes[0] }
    const merged = mergeUploadedScorecard(before, uploadedPayload())
    expect(merged).not.toBe(before)
    expect(merged.holes).not.toBe(beforeHoles)
    expect(before.holes[0]).toEqual(beforeHole0)            // unchanged
    expect(before.yardage).toBe('6500')                     // unchanged
  })

  it('stamps _scorecardUpdatedAt so downstream consumers can detect the refresh', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-17T12:00:00Z'))
    const merged = mergeUploadedScorecard(baseCourse(), uploadedPayload())
    expect(merged._scorecardUpdatedAt).toBe(new Date('2026-06-17T12:00:00Z').getTime())
  })
})

describe('isSameCourseKey', () => {
  it('matches courses with the same name+location regardless of case/whitespace', () => {
    expect(isSameCourseKey(
      { name: 'Wolfdancer Golf Club', location: 'Lost Pines, TX' },
      { name: '  wolfdancer golf club  ', location: 'LOST PINES, TX' },
    )).toBe(true)
  })

  it('distinguishes different courses', () => {
    expect(isSameCourseKey(
      { name: 'Wolfdancer Golf Club', location: 'Lost Pines, TX' },
      { name: 'Lost Pines Golf Club', location: 'Lost Pines, TX' },
    )).toBe(false)
  })

  it('handles missing fields without throwing', () => {
    expect(isSameCourseKey({}, {})).toBe(true)              // both empty → same key '|'
    expect(isSameCourseKey(null, undefined)).toBe(true)
    expect(isSameCourseKey({ name: 'X' }, { location: 'Y' })).toBe(false)
  })
})
