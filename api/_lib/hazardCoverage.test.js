import { describe, it, expect } from 'vitest'
import { computeHazardCoverage, validateHazardDesignBatch } from './hazardCoverage.js'

describe('computeHazardCoverage', () => {
  it('reports zero coverage for an empty array', () => {
    const result = computeHazardCoverage([])
    expect(result).toEqual({
      covered: 0,
      total: 18,
      missingHoles: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18],
    })
  })

  it('reports full coverage when all 18 holes are present', () => {
    const hazardsByHole = Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, hazards: [] }))
    const result = computeHazardCoverage(hazardsByHole)
    expect(result).toEqual({ covered: 18, total: 18, missingHoles: [] })
  })

  it('reports partial coverage, listing exactly which holes are missing', () => {
    const hazardsByHole = [{ hole: 1 }, { hole: 2 }, { hole: 5 }]
    const result = computeHazardCoverage(hazardsByHole)
    expect(result.covered).toBe(3)
    expect(result.missingHoles).toEqual([3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18])
  })

  it('counts a duplicated hole number once', () => {
    const hazardsByHole = [{ hole: 1 }, { hole: 1 }, { hole: 2 }]
    const result = computeHazardCoverage(hazardsByHole)
    expect(result.covered).toBe(2)
  })

  it('ignores entries with a missing, null, or out-of-range hole number', () => {
    const hazardsByHole = [{ hole: 1 }, { hole: null }, {}, { hole: 0 }, { hole: 19 }, { hole: '3' }]
    const result = computeHazardCoverage(hazardsByHole)
    expect(result.covered).toBe(1)
  })

  it('respects a custom totalHoles for non-18-hole courses', () => {
    const hazardsByHole = [{ hole: 1 }, { hole: 9 }]
    const result = computeHazardCoverage(hazardsByHole, 9)
    expect(result).toEqual({ covered: 2, total: 9, missingHoles: [2, 3, 4, 5, 6, 7, 8] })
  })
})

describe('validateHazardDesignBatch', () => {
  function goodEntry(hole) {
    return {
      hole,
      dogleg: 'left',
      hazards: [{ type: 'bunker', side: 'R', carry_yards: 220, notes: 'fairway' }],
      green_notes: 'severe back-to-front',
      greenDepth: 30,
      holeName: 'The Gap',
      description: 'A medium-length dogleg left.',
      visualNotes: 'FW pinches at 240y',
      distanceMarkers: [{ label: 'sprinkler to front', yards: 62 }],
    }
  }

  it('returns no issues for a well-formed batch', () => {
    expect(validateHazardDesignBatch([goodEntry(1), goodEntry(2)])).toEqual([])
  })

  it('flags non-array input', () => {
    expect(validateHazardDesignBatch({})).toEqual(['not_array'])
    expect(validateHazardDesignBatch(null)).toEqual(['not_array'])
  })

  it('flags an out-of-range or non-integer hole number', () => {
    expect(validateHazardDesignBatch([{ ...goodEntry(0) }])).toContain('bad_hole_number')
    expect(validateHazardDesignBatch([{ ...goodEntry(19) }])).toContain('bad_hole_number')
    expect(validateHazardDesignBatch([{ ...goodEntry('3') }])).toContain('bad_hole_number')
  })

  it('flags a duplicate hole number', () => {
    expect(validateHazardDesignBatch([goodEntry(1), goodEntry(1)])).toContain('duplicate_hole')
  })

  it('flags an invalid dogleg value', () => {
    const bad = { ...goodEntry(1), dogleg: 'sideways' }
    expect(validateHazardDesignBatch([bad])).toContain('bad_dogleg')
  })

  it('flags an invalid hazard type or side', () => {
    const badType = { ...goodEntry(1), hazards: [{ type: 'lava', side: 'R' }] }
    const badSide = { ...goodEntry(2), hazards: [{ type: 'bunker', side: 'up' }] }
    expect(validateHazardDesignBatch([badType])).toContain('bad_hazard_type')
    expect(validateHazardDesignBatch([badSide])).toContain('bad_hazard_side')
  })

  it('flags greenDepth outside the plausible range', () => {
    const tooShallow = { ...goodEntry(1), greenDepth: 5 }
    const tooDeep = { ...goodEntry(2), greenDepth: 90 }
    expect(validateHazardDesignBatch([tooShallow])).toContain('bad_green_depth')
    expect(validateHazardDesignBatch([tooDeep])).toContain('bad_green_depth')
  })

  it('treats null/absent optional fields as valid (nothing to report)', () => {
    const minimal = { hole: 1 }
    expect(validateHazardDesignBatch([minimal])).toEqual([])
  })
})
