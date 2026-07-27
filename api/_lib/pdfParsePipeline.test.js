import { describe, it, expect } from 'vitest'
import { buildScorecardTeesMessages, buildHazardDesignMessages } from './pdfParseMessages.js'
import {
  computeHazardCoverage,
  validateHazardDesignBatch,
  validateHazardPlausibility,
  buildHazardRows,
} from './hazardCoverage.js'
import {
  SAMPLE_COURSE_NAME,
  SAMPLE_LOCATION,
  SAMPLE_SCORECARD,
  SAMPLE_HAZARDS_BY_HOLE,
  IMPLAUSIBLE_HAZARDS,
} from './__fixtures__/sampleScorecard.js'

// ---------------------------------------------------------------------------
// Integration tests for the PDF parsing pipeline:
//   PDF text -> parsing prompt -> structured output -> validation
//
// These tests exercise the full pipeline using fixture data instead of real
// Claude API calls. They verify:
//   1. Prompt construction includes the right schema requirements
//   2. Structural validation accepts well-formed fixture data
//   3. Plausibility cross-checks catch data-accuracy issues
//   4. Coverage computation and hazard row building work end-to-end
//   5. Edge cases: partial data, missing holes, empty arrays
// ---------------------------------------------------------------------------

describe('PDF parsing pipeline integration', () => {

  // -- Step 1: Prompt construction ------------------------------------------

  describe('prompt construction', () => {
    it('scorecard prompt requests the expanded tee schema', () => {
      const msgs = buildScorecardTeesMessages('https://example.com/book.pdf', SAMPLE_COURSE_NAME, SAMPLE_LOCATION)
      const text = msgs[0].content.find(b => b.type === 'text').text
      expect(text).toContain(SAMPLE_COURSE_NAME)
      expect(text).toContain(SAMPLE_LOCATION)
      expect(text).toMatch(/tees/)
      expect(text).toMatch(/selectedTee/)
      expect(text).toMatch(/rating/)
      expect(text).toMatch(/slope/)
    })

    it('hazard prompt requests the expanded schema fields', () => {
      const msgs = buildHazardDesignMessages('https://example.com/book.pdf', SAMPLE_COURSE_NAME, SAMPLE_LOCATION)
      const text = msgs[0].content.find(b => b.type === 'text').text
      // New fields from issue #172
      expect(text).toContain('category')
      expect(text).toContain('greenside')
      expect(text).toContain('fairway')
      expect(text).toContain('tee')
      expect(text).toContain('distances_by_tee')
      expect(text).toContain('position_description')
      // Existing fields still present
      expect(text).toContain('hazardsByHole')
      expect(text).toContain('carry_yards')
      expect(text).toContain('visualNotes')
      expect(text).toContain('distanceMarkers')
    })

    it('hazard prompt example JSON includes the new fields', () => {
      const msgs = buildHazardDesignMessages('https://example.com/book.pdf', SAMPLE_COURSE_NAME, SAMPLE_LOCATION)
      const text = msgs[0].content.find(b => b.type === 'text').text
      // The example JSON should include category, distances_by_tee, position_description
      expect(text).toMatch(/"category"\s*:\s*"fairway"/)
      expect(text).toMatch(/"distances_by_tee"/)
      expect(text).toMatch(/"position_description"/)
    })
  })

  // -- Step 2: Structural validation of fixture data -----------------------

  describe('structural validation with fixture data', () => {
    it('accepts well-formed 18-hole hazard fixture', () => {
      const issues = validateHazardDesignBatch(SAMPLE_HAZARDS_BY_HOLE)
      expect(issues).toEqual([])
    })

    it('detects bad hazard types', () => {
      const bad = [{ hole: 1, hazards: [{ type: 'lava', side: 'L' }] }]
      const issues = validateHazardDesignBatch(bad)
      expect(issues).toContain('bad_hazard_type')
    })

    it('detects bad hazard sides', () => {
      const bad = [{ hole: 1, hazards: [{ type: 'bunker', side: 'underneath' }] }]
      const issues = validateHazardDesignBatch(bad)
      expect(issues).toContain('bad_hazard_side')
    })

    it('detects duplicate hole numbers', () => {
      const dup = [
        { hole: 1, hazards: [] },
        { hole: 1, hazards: [] },
      ]
      const issues = validateHazardDesignBatch(dup)
      expect(issues).toContain('duplicate_hole')
    })

    it('detects bad dogleg values', () => {
      const bad = [{ hole: 1, dogleg: 'sideways', hazards: [] }]
      const issues = validateHazardDesignBatch(bad)
      expect(issues).toContain('bad_dogleg')
    })

    it('detects out-of-range green depth', () => {
      const bad = [{ hole: 1, greenDepth: 60, hazards: [] }]
      const issues = validateHazardDesignBatch(bad)
      expect(issues).toContain('bad_green_depth')
    })
  })

  // -- Step 3: Coverage computation ----------------------------------------

  describe('coverage computation', () => {
    it('reports full coverage for 18-hole fixture', () => {
      const cov = computeHazardCoverage(SAMPLE_HAZARDS_BY_HOLE)
      expect(cov.covered).toBe(18)
      expect(cov.total).toBe(18)
      expect(cov.missingHoles).toEqual([])
    })

    it('reports missing holes when partial data is provided', () => {
      const partial = SAMPLE_HAZARDS_BY_HOLE.slice(0, 5)
      const cov = computeHazardCoverage(partial)
      expect(cov.covered).toBe(5)
      expect(cov.missingHoles).toHaveLength(13)
      expect(cov.missingHoles).toContain(6)
      expect(cov.missingHoles).toContain(18)
    })

    it('handles empty array', () => {
      const cov = computeHazardCoverage([])
      expect(cov.covered).toBe(0)
      expect(cov.total).toBe(18)
      expect(cov.missingHoles).toHaveLength(18)
    })

    it('ignores entries with invalid hole numbers', () => {
      const bad = [{ hole: 0 }, { hole: 19 }, { hole: null }]
      const cov = computeHazardCoverage(bad)
      expect(cov.covered).toBe(0)
    })
  })

  // -- Step 4: Plausibility cross-checks -----------------------------------

  describe('plausibility cross-checks', () => {
    it('returns no issues for well-formed fixture data', () => {
      const issues = validateHazardPlausibility(SAMPLE_HAZARDS_BY_HOLE, SAMPLE_SCORECARD.holes)
      expect(issues).toEqual([])
    })

    it('catches hazard distance exceeding hole length', () => {
      const issues = validateHazardPlausibility(IMPLAUSIBLE_HAZARDS, SAMPLE_SCORECARD.holes)
      const exceeds = issues.filter(i => i.check === 'hazard_exceeds_hole_length')
      expect(exceeds.length).toBeGreaterThanOrEqual(1)
      expect(exceeds[0].hole).toBe(1) // 500y hazard on 427y hole
    })

    it('catches par-3 distant fairway hazard', () => {
      const issues = validateHazardPlausibility(IMPLAUSIBLE_HAZARDS, SAMPLE_SCORECARD.holes)
      const par3 = issues.filter(i => i.check === 'par3_distant_fairway_hazard')
      expect(par3.length).toBeGreaterThanOrEqual(1)
      expect(par3[0].hole).toBe(3) // par-3, 185y hole with fairway bunker at 280y
    })

    it('catches implausible water carry (> 300y)', () => {
      const issues = validateHazardPlausibility(IMPLAUSIBLE_HAZARDS, SAMPLE_SCORECARD.holes)
      const water = issues.filter(i => i.check === 'implausible_water_carry')
      expect(water.length).toBeGreaterThanOrEqual(1)
    })

    it('catches negative carry yards', () => {
      const issues = validateHazardPlausibility(IMPLAUSIBLE_HAZARDS, SAMPLE_SCORECARD.holes)
      const neg = issues.filter(i => i.check === 'negative_carry')
      expect(neg.length).toBeGreaterThanOrEqual(1)
    })

    it('catches greenside hazard too far from green', () => {
      const issues = validateHazardPlausibility(IMPLAUSIBLE_HAZARDS, SAMPLE_SCORECARD.holes)
      const gs = issues.filter(i => i.check === 'greenside_too_far_from_green')
      expect(gs.length).toBeGreaterThanOrEqual(1)
      expect(gs[0].hole).toBe(7) // 585y hole, greenside hazard at 200y
    })

    it('catches tee hazard too far from tee', () => {
      const issues = validateHazardPlausibility(IMPLAUSIBLE_HAZARDS, SAMPLE_SCORECARD.holes)
      const tee = issues.filter(i => i.check === 'tee_hazard_too_far')
      expect(tee.length).toBeGreaterThanOrEqual(1)
      expect(tee[0].hole).toBe(8) // tee hazard at 150y
    })

    it('returns no issues for fixture data when no scorecard holes are provided', () => {
      const issues = validateHazardPlausibility(SAMPLE_HAZARDS_BY_HOLE, [])
      // Without scorecard data, distance-based checks that need hole length
      // are skipped, but standalone checks (e.g., water carry > 300y) still run.
      // Our fixture data should pass all standalone checks.
      expect(issues).toEqual([])
    })

    it('handles non-array input gracefully', () => {
      expect(validateHazardPlausibility(null, [])).toEqual([])
      expect(validateHazardPlausibility('string', [])).toEqual([])
      expect(validateHazardPlausibility(undefined, [])).toEqual([])
    })
  })

  // -- Step 5: Hazard row building -----------------------------------------

  describe('hazard row building end-to-end', () => {
    it('builds correct rows from fixture data', () => {
      const coverage = computeHazardCoverage(SAMPLE_HAZARDS_BY_HOLE)
      const rows = buildHazardRows(SAMPLE_HAZARDS_BY_HOLE, {
        courseKey: 'pine valley golf club|pine valley, nj',
        pdfUrl: 'https://example.com/book.pdf',
        coverage,
        baseConfidence: 'high',
      })
      expect(rows).toHaveLength(18)
      expect(rows[0].course_key).toBe('pine valley golf club|pine valley, nj')
      expect(rows[0].hole_ref).toBe(1)
      expect(rows[0].source).toBe('pdf_vision')
      expect(rows[0].confidence).toBe('high') // 18/18 coverage + high base
      expect(rows[0].hazards.hazards).toHaveLength(2) // hole 1 has 2 hazards
    })

    it('marks confidence as low when coverage is poor', () => {
      const partial = SAMPLE_HAZARDS_BY_HOLE.slice(0, 5)
      const coverage = computeHazardCoverage(partial)
      const rows = buildHazardRows(partial, {
        courseKey: 'test|test',
        coverage,
        baseConfidence: 'high',
      })
      expect(rows).toHaveLength(5)
      // Coverage < 16 → always low confidence
      expect(rows[0].confidence).toBe('low')
    })

    it('filters out entries with invalid hole numbers', () => {
      const withBad = [
        ...SAMPLE_HAZARDS_BY_HOLE.slice(0, 2),
        { hole: 0, hazards: [] },
        { hole: 19, hazards: [] },
      ]
      const coverage = computeHazardCoverage(withBad)
      const rows = buildHazardRows(withBad, {
        courseKey: 'test|test',
        coverage,
        baseConfidence: 'medium',
      })
      expect(rows).toHaveLength(2) // only holes 1 and 2
    })
  })

  // -- Step 6: Schema field presence in fixture data -----------------------

  describe('fixture data schema completeness', () => {
    it('every fixture hazard has the expanded schema fields', () => {
      for (const entry of SAMPLE_HAZARDS_BY_HOLE) {
        expect(entry).toHaveProperty('hole')
        expect(entry).toHaveProperty('dogleg')
        expect(entry).toHaveProperty('hazards')
        expect(entry).toHaveProperty('green_notes')

        for (const hz of entry.hazards) {
          expect(hz).toHaveProperty('type')
          expect(hz).toHaveProperty('side')
          expect(hz).toHaveProperty('category')
          expect(['greenside', 'fairway', 'tee']).toContain(hz.category)
          expect(hz).toHaveProperty('carry_yards')
          expect(hz).toHaveProperty('distances_by_tee')
          expect(typeof hz.distances_by_tee).toBe('object')
          expect(hz).toHaveProperty('position_description')
          expect(hz).toHaveProperty('notes')
        }
      }
    })

    it('fixture scorecard has valid totals', () => {
      const parTotal = SAMPLE_SCORECARD.holes.reduce((s, h) => s + h.par, 0)
      expect(parTotal).toBe(SAMPLE_SCORECARD.par)

      const yardTotal = SAMPLE_SCORECARD.holes.reduce((s, h) => s + h.yardage, 0)
      expect(yardTotal).toBe(SAMPLE_SCORECARD.yardage)

      expect(SAMPLE_SCORECARD.holes).toHaveLength(18)

      // Handicaps should be 1-18
      const hcps = new Set(SAMPLE_SCORECARD.holes.map(h => h.handicap))
      expect(hcps.size).toBe(18)
      for (let i = 1; i <= 18; i++) expect(hcps.has(i)).toBe(true)
    })
  })
})
