import { describe, it, expect } from 'vitest'
import { parseJsonFromText } from './extractJson.js'
import {
  computeHazardCoverage,
  validateHazardDesignBatch,
  validateHazardPlausibility,
  buildHazardRows,
} from './hazardCoverage.js'
import {
  RAVINES_COURSE_NAME,
  RAVINES_LOCATION,
  RAVINES_LLM_SCORECARD_RESPONSE,
  RAVINES_LLM_HAZARD_RESPONSE,
  RAVINES_PARSED_SCORECARD,
  RAVINES_PARSED_HAZARDS,
  RAVINES_MALFORMED_LLM_RESPONSE,
  RAVINES_TRUNCATED_LLM_RESPONSE,
} from './__fixtures__/ravinesGolfClub.js'

// ---------------------------------------------------------------------------
// Issue #186: Fixture-based integration tests for the PDF parsing pipeline.
// These tests feed realistic LLM response fixtures through the entire parsing
// pipeline (JSON extraction -> structural validation -> plausibility checks ->
// coverage computation -> hazard row building) without hitting the real API.
// ---------------------------------------------------------------------------

describe('Ravines Golf Club integration tests', () => {

  // -- JSON extraction from LLM responses -----------------------------------

  describe('LLM response parsing', () => {
    it('extracts valid scorecard JSON from a fenced LLM response', () => {
      const result = parseJsonFromText(RAVINES_LLM_SCORECARD_RESPONSE)
      expect(result.ok).toBe(true)
      expect(result.value.name).toBe('Ravines Golf Club')
      expect(result.value.holes).toHaveLength(18)
      expect(result.value.par).toBe(72)
      expect(result.value.yardage).toBe(6726)
    })

    it('extracts valid hazard JSON from a fenced LLM response', () => {
      const result = parseJsonFromText(RAVINES_LLM_HAZARD_RESPONSE)
      expect(result.ok).toBe(true)
      expect(result.value.hazardsByHole).toHaveLength(18)
    })

    it('catches malformed LLM response (hazardsByHole is not an array)', () => {
      const result = parseJsonFromText(RAVINES_MALFORMED_LLM_RESPONSE)
      expect(result.ok).toBe(true) // JSON itself parses fine
      // But structural validation should catch it
      const hazards = result.value.hazardsByHole
      expect(Array.isArray(hazards)).toBe(false)
      const issues = validateHazardDesignBatch(hazards)
      expect(issues).toContain('not_array')
    })

    it('catches truncated LLM response (only 2 holes)', () => {
      const result = parseJsonFromText(RAVINES_TRUNCATED_LLM_RESPONSE)
      expect(result.ok).toBe(true)
      expect(result.value.holes).toHaveLength(2) // truncated
    })
  })

  // -- Specific hazard assertions -------------------------------------------

  describe('hazard data correctness', () => {
    it('hole 5 has water hazards (lake right side)', () => {
      const hole5 = RAVINES_PARSED_HAZARDS.find(h => h.hole === 5)
      expect(hole5).toBeDefined()
      const waterHazards = hole5.hazards.filter(h => h.type === 'water')
      expect(waterHazards.length).toBeGreaterThanOrEqual(1)
      // Lake runs along the right side
      const rightWater = waterHazards.find(h => h.side === 'R')
      expect(rightWater).toBeDefined()
      expect(rightWater.category).toBe('fairway')
    })

    it('hole 9 has water hazard (creek left side)', () => {
      const hole9 = RAVINES_PARSED_HAZARDS.find(h => h.hole === 9)
      expect(hole9).toBeDefined()
      const waterHazards = hole9.hazards.filter(h => h.type === 'water')
      expect(waterHazards.length).toBeGreaterThanOrEqual(1)
      const leftWater = waterHazards.find(h => h.side === 'L')
      expect(leftWater).toBeDefined()
    })

    it('hole 11 has water hazard (ravine with creek right side)', () => {
      const hole11 = RAVINES_PARSED_HAZARDS.find(h => h.hole === 11)
      expect(hole11).toBeDefined()
      const waterHazards = hole11.hazards.filter(h => h.type === 'water')
      expect(waterHazards.length).toBeGreaterThanOrEqual(1)
      const rightWater = waterHazards.find(h => h.side === 'R')
      expect(rightWater).toBeDefined()
    })

    it('hole 3 has bunkers', () => {
      const hole3 = RAVINES_PARSED_HAZARDS.find(h => h.hole === 3)
      expect(hole3).toBeDefined()
      const bunkers = hole3.hazards.filter(h => h.type === 'bunker')
      expect(bunkers.length).toBeGreaterThanOrEqual(1)
    })

    it('hole 2 has fairway bunker at the dogleg', () => {
      const hole2 = RAVINES_PARSED_HAZARDS.find(h => h.hole === 2)
      expect(hole2).toBeDefined()
      const fwBunkers = hole2.hazards.filter(
        h => h.type === 'bunker' && h.category === 'fairway'
      )
      expect(fwBunkers.length).toBeGreaterThanOrEqual(1)
      expect(fwBunkers[0].side).toBe('L')
    })
  })

  // -- Scorecard yardage verification ---------------------------------------

  describe('scorecard yardage verification', () => {
    it('total yardage matches sum of hole yardages', () => {
      const totalYardage = RAVINES_PARSED_SCORECARD.holes.reduce(
        (sum, h) => sum + h.yardage,
        0
      )
      expect(totalYardage).toBe(RAVINES_PARSED_SCORECARD.yardage)
    })

    it('total par matches sum of hole pars', () => {
      const totalPar = RAVINES_PARSED_SCORECARD.holes.reduce(
        (sum, h) => sum + h.par,
        0
      )
      expect(totalPar).toBe(RAVINES_PARSED_SCORECARD.par)
    })

    it('has exactly 18 holes', () => {
      expect(RAVINES_PARSED_SCORECARD.holes).toHaveLength(18)
    })

    it('handicaps form a complete set of 1-18', () => {
      const handicaps = new Set(
        RAVINES_PARSED_SCORECARD.holes.map(h => h.handicap)
      )
      expect(handicaps.size).toBe(18)
      for (let i = 1; i <= 18; i++) {
        expect(handicaps.has(i)).toBe(true)
      }
    })

    it('all hole yardages are within plausible range (80-700)', () => {
      for (const hole of RAVINES_PARSED_SCORECARD.holes) {
        expect(hole.yardage).toBeGreaterThanOrEqual(80)
        expect(hole.yardage).toBeLessThanOrEqual(700)
      }
    })

    it('all pars are 3, 4, or 5', () => {
      for (const hole of RAVINES_PARSED_SCORECARD.holes) {
        expect([3, 4, 5]).toContain(hole.par)
      }
    })
  })

  // -- Structured hazard schema conformance ---------------------------------

  describe('structured hazard schema conformance', () => {
    it('every hazard entry conforms to the structured schema', () => {
      for (const entry of RAVINES_PARSED_HAZARDS) {
        expect(entry).toHaveProperty('hole')
        expect(entry.hole).toBeGreaterThanOrEqual(1)
        expect(entry.hole).toBeLessThanOrEqual(18)
        expect(entry).toHaveProperty('dogleg')
        expect(entry).toHaveProperty('hazards')
        expect(Array.isArray(entry.hazards)).toBe(true)

        for (const hz of entry.hazards) {
          expect(hz).toHaveProperty('type')
          expect(['bunker', 'water', 'creek', 'native', 'OB', 'trees']).toContain(hz.type)
          expect(hz).toHaveProperty('side')
          expect(['L', 'R', 'C', 'front', 'back']).toContain(hz.side)
          expect(hz).toHaveProperty('category')
          expect(['greenside', 'fairway', 'tee']).toContain(hz.category)
          expect(hz).toHaveProperty('carry_yards')
          expect(hz).toHaveProperty('distances_by_tee')
          expect(typeof hz.distances_by_tee).toBe('object')
          expect(hz).toHaveProperty('notes')
        }
      }
    })

    it('passes structural validation with no issues', () => {
      const issues = validateHazardDesignBatch(RAVINES_PARSED_HAZARDS)
      expect(issues).toEqual([])
    })
  })

  // -- End-to-end pipeline: extraction -> validation -> coverage -> rows -----

  describe('end-to-end pipeline', () => {
    it('full pipeline: LLM response -> parse -> validate -> coverage -> rows', () => {
      // Step 1: Parse LLM response
      const hazardResult = parseJsonFromText(RAVINES_LLM_HAZARD_RESPONSE)
      expect(hazardResult.ok).toBe(true)

      const hazardsByHole = hazardResult.value.hazardsByHole
      expect(hazardsByHole).toHaveLength(18)

      // Step 2: Structural validation
      const structuralIssues = validateHazardDesignBatch(hazardsByHole)
      expect(structuralIssues).toEqual([])

      // Step 3: Plausibility cross-check against scorecard
      const scorecardResult = parseJsonFromText(RAVINES_LLM_SCORECARD_RESPONSE)
      expect(scorecardResult.ok).toBe(true)

      const plausibilityIssues = validateHazardPlausibility(
        hazardsByHole,
        scorecardResult.value.holes
      )
      expect(plausibilityIssues).toEqual([])

      // Step 4: Coverage computation
      const coverage = computeHazardCoverage(hazardsByHole)
      expect(coverage.covered).toBe(18)
      expect(coverage.total).toBe(18)
      expect(coverage.missingHoles).toEqual([])

      // Step 5: Build hazard rows for persistence
      const courseKey = `${RAVINES_COURSE_NAME.toLowerCase()}|${RAVINES_LOCATION.toLowerCase()}`
      const rows = buildHazardRows(hazardsByHole, {
        courseKey,
        pdfUrl: 'https://example.com/ravines-yardage-book.pdf',
        coverage,
        baseConfidence: 'high',
      })
      expect(rows).toHaveLength(18)
      expect(rows[0].course_key).toBe('ravines golf club|saugatuck, mi')
      expect(rows[0].hole_ref).toBe(1)
      expect(rows[0].source).toBe('pdf_vision')
      expect(rows[0].confidence).toBe('high') // 18/18 coverage
    })

    it('pipeline with partial data still produces rows for available holes', () => {
      const partial = RAVINES_PARSED_HAZARDS.slice(0, 8)
      const coverage = computeHazardCoverage(partial)
      expect(coverage.covered).toBe(8)
      expect(coverage.missingHoles).toHaveLength(10)

      const rows = buildHazardRows(partial, {
        courseKey: 'ravines golf club|saugatuck, mi',
        coverage,
        baseConfidence: 'high',
      })
      expect(rows).toHaveLength(8)
      // Below 16-hole threshold -> low confidence
      expect(rows[0].confidence).toBe('low')
    })
  })

  // -- Negative tests -------------------------------------------------------

  describe('negative tests', () => {
    it('malformed LLM response: hazardsByHole is a string', () => {
      const result = parseJsonFromText(RAVINES_MALFORMED_LLM_RESPONSE)
      expect(result.ok).toBe(true)
      const issues = validateHazardDesignBatch(result.value.hazardsByHole)
      expect(issues).toContain('not_array')
    })

    it('truncated scorecard fails validation (only 2 holes)', () => {
      const result = parseJsonFromText(RAVINES_TRUNCATED_LLM_RESPONSE)
      expect(result.ok).toBe(true)
      expect(result.value.holes).toHaveLength(2)
      // If fed through coverage, only 2 holes covered
      // We can wrap these holes as hazard entries to test coverage
      const asHazards = result.value.holes.map((h, i) => ({
        hole: i + 1,
        hazards: [],
      }))
      const coverage = computeHazardCoverage(asHazards)
      expect(coverage.covered).toBe(2)
      expect(coverage.missingHoles).toHaveLength(16)
    })

    it('completely empty LLM response returns no_balanced_json', () => {
      const result = parseJsonFromText('')
      expect(result.ok).toBe(false)
      expect(result.error).toBe('no_balanced_json')
    })

    it('LLM response with no JSON returns no_balanced_json', () => {
      const result = parseJsonFromText('I could not find any scorecard data for this course.')
      expect(result.ok).toBe(false)
      expect(result.error).toBe('no_balanced_json')
    })

    it('LLM response with broken JSON returns parse_failed', () => {
      const result = parseJsonFromText('{"name": "Ravines Golf Club", "holes": [}')
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/parse_failed/)
    })
  })

  // -- Issue #178: Additional plausibility checks ---------------------------

  describe('plausibility cross-checks with Ravines data', () => {
    it('fixture data passes all plausibility checks', () => {
      const issues = validateHazardPlausibility(
        RAVINES_PARSED_HAZARDS,
        RAVINES_PARSED_SCORECARD.holes
      )
      expect(issues).toEqual([])
    })

    it('detects suspiciously short carry distance (< 30y)', () => {
      const badHazards = [
        {
          hole: 1,
          hazards: [
            { type: 'bunker', side: 'R', category: 'fairway', carry_yards: 15, notes: 'too short' },
          ],
        },
      ]
      const issues = validateHazardPlausibility(
        badHazards,
        RAVINES_PARSED_SCORECARD.holes
      )
      const shortCarry = issues.filter(i => i.check === 'suspiciously_short_carry')
      expect(shortCarry.length).toBeGreaterThanOrEqual(1)
      expect(shortCarry[0].hole).toBe(1)
    })

    it('detects carry_yards exceeding hole yardage for Ravines', () => {
      const badHazards = [
        {
          hole: 4, // par 3, 178y
          hazards: [
            { type: 'water', side: 'front', category: 'greenside', carry_yards: 200, notes: 'exceeds hole' },
          ],
        },
      ]
      const issues = validateHazardPlausibility(
        badHazards,
        RAVINES_PARSED_SCORECARD.holes
      )
      const exceeds = issues.filter(i => i.check === 'hazard_exceeds_hole_length')
      expect(exceeds.length).toBeGreaterThanOrEqual(1)
    })
  })

  // -- Issue #189: Promise.allSettled independence verification ---------------

  describe('scorecard/hazard independence (Issue #189)', () => {
    it('hazard data is independently valid even without scorecard', () => {
      // Verify that hazard data can stand alone without scorecard data
      const issues = validateHazardDesignBatch(RAVINES_PARSED_HAZARDS)
      expect(issues).toEqual([])

      const coverage = computeHazardCoverage(RAVINES_PARSED_HAZARDS)
      expect(coverage.covered).toBe(18)

      // Plausibility checks with empty scorecard should not error
      const plausibilityIssues = validateHazardPlausibility(RAVINES_PARSED_HAZARDS, [])
      expect(plausibilityIssues).toEqual([])
    })

    it('scorecard data is independently valid even without hazard data', () => {
      const scorecard = RAVINES_PARSED_SCORECARD
      expect(scorecard.holes).toHaveLength(18)
      const totalPar = scorecard.holes.reduce((s, h) => s + h.par, 0)
      expect(totalPar).toBe(72)
    })
  })

  // -- Issue #183: Schema alignment verification ----------------------------

  describe('web-search schema alignment (Issue #183)', () => {
    it('fixture hazard objects have all fields expected by dispersion calculator', () => {
      // The dispersion calculator expects structured hazard objects with:
      // type, side, carry_yards, notes (minimum), plus optional category,
      // distances_by_tee, position_description
      for (const entry of RAVINES_PARSED_HAZARDS) {
        for (const hz of entry.hazards) {
          // Required by dispersion calculator
          expect(hz).toHaveProperty('type')
          expect(hz).toHaveProperty('side')
          expect(hz).toHaveProperty('notes')
          // carry_yards must be present (can be null)
          expect('carry_yards' in hz).toBe(true)
        }
      }
    })

    it('web-search hole design format matches PDF hazard format', () => {
      // Simulate a web-search response (same shape as buildHoleDesignMessages returns)
      const webSearchHole = {
        hole: 1,
        dogleg: 'straight',
        hazards: [
          { type: 'bunker', side: 'R', category: 'fairway', carry_yards: 250, position_description: 'fairway bunker right', notes: 'right side' },
        ],
        green_notes: 'back-to-front slope',
      }

      // Verify it passes the same validation as PDF-extracted data
      const issues = validateHazardDesignBatch([webSearchHole])
      expect(issues).toEqual([])

      // Verify it can be used to build hazard rows
      const coverage = computeHazardCoverage([webSearchHole])
      const rows = buildHazardRows([webSearchHole], {
        courseKey: 'test|test',
        coverage,
        baseConfidence: 'medium',
      })
      expect(rows).toHaveLength(1)
      expect(rows[0].hazards.hazards[0].type).toBe('bunker')
    })

    it('legacy loose-string format is distinct from structured format', () => {
      // Legacy format (from old web-search responses)
      const legacyHole = {
        hole: 1,
        dogleg: 'straight',
        water: 'left side, 200-250 yards',
        bunkers: 'greenside left and right',
        ob: null,
        green_notes: 'two-tier',
      }
      // Should NOT have a hazards array — that distinguishes legacy from structured
      expect(legacyHole.hazards).toBeUndefined()

      // Structured format DOES have a hazards array
      const structuredHole = RAVINES_PARSED_HAZARDS[0]
      expect(Array.isArray(structuredHole.hazards)).toBe(true)
    })
  })

  // -- Issue #175: Auto-discovery confidence level --------------------------

  describe('auto-discovery confidence level (Issue #175)', () => {
    it('web-discovered rows get lower confidence than admin-uploaded', () => {
      const coverage = computeHazardCoverage(RAVINES_PARSED_HAZARDS)

      const adminRows = buildHazardRows(RAVINES_PARSED_HAZARDS, {
        courseKey: 'ravines|mi',
        coverage,
        baseConfidence: 'high',
        source: 'pdf_vision',
      })

      const discoveredRows = buildHazardRows(RAVINES_PARSED_HAZARDS, {
        courseKey: 'ravines|mi',
        coverage,
        baseConfidence: 'web-discovered',
        source: 'auto_discovery',
      })

      // Admin-uploaded gets 'high', auto-discovered gets 'web-discovered'
      expect(adminRows[0].confidence).toBe('high')
      expect(discoveredRows[0].confidence).toBe('web-discovered')
      expect(discoveredRows[0].source).toBe('auto_discovery')
    })
  })
})
