// Coverage at or above this bar counts as "the model didn't struggle with
// this document" — below it, persisted rows are marked low-confidence
// regardless of how confident the scorecard parse itself was.
const MOSTLY_COMPLETE_HOLES = 16

export function computeHazardCoverage(hazardsByHole, totalHoles = 18) {
  const present = new Set()
  for (const entry of hazardsByHole) {
    if (entry && Number.isInteger(entry.hole) && entry.hole >= 1 && entry.hole <= totalHoles) {
      present.add(entry.hole)
    }
  }
  const missingHoles = []
  for (let n = 1; n <= totalHoles; n++) {
    if (!present.has(n)) missingHoles.push(n)
  }
  return { covered: present.size, total: totalHoles, missingHoles }
}

export function validateHazardDesignBatch(parsed, { totalHoles = 18 } = {}) {
  const issues = []
  if (!Array.isArray(parsed)) {
    issues.push('not_array')
    return issues
  }

  const seenHoles = new Set()
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue

    const hole = entry.hole
    if (!Number.isInteger(hole) || hole < 1 || hole > totalHoles) {
      issues.push('bad_hole_number')
    } else if (seenHoles.has(hole)) {
      issues.push('duplicate_hole')
    } else {
      seenHoles.add(hole)
    }

    if (entry.dogleg != null && !/^(left|right|straight)$/i.test(entry.dogleg)) {
      issues.push('bad_dogleg')
    }

    if (Array.isArray(entry.hazards)) {
      for (const hz of entry.hazards) {
        if (!hz || typeof hz !== 'object') continue
        if (hz.type != null && !/^(bunker|water|creek|native|OB|trees)$/i.test(hz.type)) {
          issues.push('bad_hazard_type')
        }
        if (hz.side != null && !/^(L|R|C|front|back)$/i.test(hz.side)) {
          issues.push('bad_hazard_side')
        }
      }
    }

    if (entry.greenDepth != null && (entry.greenDepth < 15 || entry.greenDepth > 50)) {
      issues.push('bad_green_depth')
    }
  }

  return issues
}

// Plausibility cross-checks for parsed hazard data. Catches data-accuracy
// issues that structural validation (validateHazardDesignBatch) misses:
// e.g. a hazard at 400y on a 350y hole, or "fairway bunkers" at 250y on a par 3.
export function validateHazardPlausibility(hazardsByHole, scorecardHoles = []) {
  const issues = []
  if (!Array.isArray(hazardsByHole)) return issues

  for (const entry of hazardsByHole) {
    if (!entry || typeof entry !== 'object') continue
    const hole = entry.hole
    const holeIdx = (Number.isInteger(hole) && hole >= 1 && hole <= 18) ? hole - 1 : -1
    const scorecard = holeIdx >= 0 && scorecardHoles[holeIdx] ? scorecardHoles[holeIdx] : null
    const holeYardage = scorecard ? parseInt(scorecard.yardage) || 0 : 0
    const holePar = scorecard ? parseInt(scorecard.par) || 0 : 0

    if (!Array.isArray(entry.hazards)) continue

    for (const hz of entry.hazards) {
      if (!hz || typeof hz !== 'object') continue

      // Check 1: Hazard distance exceeds hole length
      if (Number.isFinite(hz.carry_yards) && holeYardage > 0) {
        if (hz.carry_yards > holeYardage) {
          issues.push({
            hole,
            check: 'hazard_exceeds_hole_length',
            detail: `${hz.type} ${hz.side} carry ${hz.carry_yards}y > hole length ${holeYardage}y`,
          })
        }
      }

      // Check 2: Par 3s should not have fairway bunkers at 250+ yards
      if (holePar === 3 && hz.category === 'fairway' && Number.isFinite(hz.carry_yards) && hz.carry_yards >= 250) {
        issues.push({
          hole,
          check: 'par3_distant_fairway_hazard',
          detail: `par-3 hole has fairway ${hz.type} at ${hz.carry_yards}y`,
        })
      }

      // Check 3: Water carry distances should be plausible (not > 300y for
      // a forced carry, and not negative)
      if ((hz.type === 'water' || hz.type === 'creek') && Number.isFinite(hz.carry_yards)) {
        if (hz.carry_yards > 300) {
          issues.push({
            hole,
            check: 'implausible_water_carry',
            detail: `water carry ${hz.carry_yards}y exceeds plausible max (300y)`,
          })
        }
        if (hz.carry_yards < 0) {
          issues.push({
            hole,
            check: 'negative_carry',
            detail: `${hz.type} has negative carry_yards: ${hz.carry_yards}`,
          })
        }
      }

      // Check 4: Greenside hazards should not be > 50y from end of hole
      if (hz.category === 'greenside' && Number.isFinite(hz.carry_yards) && holeYardage > 0) {
        if (hz.carry_yards < holeYardage - 50) {
          issues.push({
            hole,
            check: 'greenside_too_far_from_green',
            detail: `greenside ${hz.type} at ${hz.carry_yards}y is ${holeYardage - hz.carry_yards}y from green on ${holeYardage}y hole`,
          })
        }
      }

      // Check 5: Tee hazards should be within the first 100y
      if (hz.category === 'tee' && Number.isFinite(hz.carry_yards) && hz.carry_yards > 100) {
        issues.push({
          hole,
          check: 'tee_hazard_too_far',
          detail: `tee ${hz.type} at ${hz.carry_yards}y — expected within 100y of tee`,
        })
      }

      // Check 6: Suspiciously short carry distance (< 30y) — likely a data entry
      // error or misattributed distance marker rather than a real hazard carry.
      if (Number.isFinite(hz.carry_yards) && hz.carry_yards > 0 && hz.carry_yards < 30) {
        issues.push({
          hole,
          check: 'suspiciously_short_carry',
          detail: `${hz.type} ${hz.side} carry_yards=${hz.carry_yards} is suspiciously short (< 30y)`,
        })
      }

      // Check 7: Per-tee distances should not exceed hole yardage
      if (hz.distances_by_tee && typeof hz.distances_by_tee === 'object') {
        for (const [tee, dist] of Object.entries(hz.distances_by_tee)) {
          if (Number.isFinite(dist) && holeYardage > 0 && dist > holeYardage) {
            issues.push({
              hole,
              check: 'tee_distance_exceeds_hole',
              detail: `${hz.type} distance from ${tee} tee (${dist}y) > hole length (${holeYardage}y)`,
            })
          }
        }
      }
    }
  }

  return issues
}

// Shape a raw hazardsByHole array into course_hole_hazards rows. Shared by
// every caller that persists PDF/vision-extracted hazard data (direct
// upload, auto web-search discovery, admin reparse, the reparse queue) so
// the confidence rule and row shape can't drift between them.
export function buildHazardRows(hazardsByHole, { courseKey, pdfUrl = null, coverage, baseConfidence, source = 'pdf_vision', totalHoles = 18 } = {}) {
  const confidence = coverage.covered >= MOSTLY_COMPLETE_HOLES ? (baseConfidence || 'medium') : 'low'
  return hazardsByHole
    .filter(h => h && Number.isInteger(h.hole) && h.hole >= 1 && h.hole <= totalHoles)
    .map(h => ({
      course_key: courseKey,
      hole_ref: Number(h.hole),
      hazards: h,
      source,
      image_path: pdfUrl,
      confidence,
      updated_at: new Date().toISOString(),
    }))
}
