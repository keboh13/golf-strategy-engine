// Server-side validation for scorecard and hazard JSON.
// Extracted from course-ai.js — separate from the client-side
// validation in src/lib/scorecardValidation.js.

export function validateScorecardJson(parsed) {
  const issues = []
  if (!parsed || typeof parsed !== 'object') { issues.push('not_object'); return issues }
  const holes = Array.isArray(parsed.holes) ? parsed.holes : []
  if (holes.length !== 18) issues.push(`hole_count:${holes.length}`)

  const parTotal = holes.reduce((s, h) => s + (parseInt(h?.par) || 0), 0)
  if (parTotal && (parTotal < 68 || parTotal > 74)) issues.push(`par_total_out_of_range:${parTotal}`)

  const yardTotal = holes.reduce((s, h) => s + (parseInt(h?.yardage) || 0), 0)
  if (yardTotal && (yardTotal < 4500 || yardTotal > 8200)) issues.push(`yardage_total_out_of_range:${yardTotal}`)

  // Per-hole: par in {3,4,5}, yardage in [80,700]
  let badYardage = 0, badPar = 0
  for (const h of holes) {
    const y = parseInt(h?.yardage) || 0
    if (y && (y < 80 || y > 700)) badYardage++
    const p = parseInt(h?.par) || 0
    if (p && (p < 3 || p > 6)) badPar++
  }
  if (badYardage) issues.push(`hole_yardage_out_of_range:${badYardage}`)
  if (badPar) issues.push(`hole_par_out_of_range:${badPar}`)

  // Handicap set 1..18
  const hcps = holes.map(h => parseInt(h?.handicap)).filter(n => Number.isFinite(n))
  if (hcps.length === 18) {
    const set = new Set(hcps)
    if (set.size !== 18) issues.push('handicap_duplicates')
    for (let i = 1; i <= 18; i++) if (!set.has(i)) { issues.push('handicap_set_incomplete'); break }
  }

  return issues
}

// Hazard-only schema gate. Mirrors the relevant subset of validateScorecardJson
// so vision/PDF hazard outputs cannot smuggle bogus shapes or out-of-range
// values into course_hole_hazards.
export function validateHazardsJson(h) {
  const issues = []
  if (!h || typeof h !== 'object' || Array.isArray(h)) {
    issues.push('hazards must be an object')
    return issues
  }
  const arrFields = ['water', 'bunkers', 'oob', 'trees', 'hazards']
  for (const k of arrFields) {
    if (h[k] != null && !Array.isArray(h[k]) && typeof h[k] !== 'string') {
      issues.push(`${k} must be array or string`)
    }
  }
  if (h.hole != null && !(Number.isFinite(Number(h.hole)) && Number(h.hole) >= 1 && Number(h.hole) <= 18)) {
    issues.push('hole must be 1..18')
  }
  return issues
}
