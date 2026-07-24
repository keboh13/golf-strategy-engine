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
