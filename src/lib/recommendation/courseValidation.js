// Course-totals cross-validation.
//
// Sanity-checks a fully populated course object after scorecard ingest. The
// review UI surfaces these issues to the user before they commit the data.

export function validateCourseTotals(course) {
  const issues = []
  if (!course || typeof course !== 'object') return ['not_object']

  const holes = Array.isArray(course.holes) ? course.holes : []
  if (holes.length !== 18) issues.push(`hole_count:${holes.length}`)

  // Par total
  const parSum = holes.reduce((s, h) => s + (parseInt(h?.par) || 0), 0)
  const advertisedPar = parseInt(course.par) || 0
  if (advertisedPar && Math.abs(parSum - advertisedPar) > 0) {
    issues.push(`par_total_mismatch:sum=${parSum},advertised=${advertisedPar}`)
  }
  if (parSum && (parSum < 68 || parSum > 74)) {
    issues.push(`par_total_out_of_range:${parSum}`)
  }

  // Yardage total — allow ±2% relative to advertised tee yardage
  const yardSum = holes.reduce((s, h) => s + (parseInt(h?.yardage) || 0), 0)
  const advertisedYards = parseInt(course.yardage) || 0
  if (advertisedYards && yardSum) {
    const drift = Math.abs(yardSum - advertisedYards) / advertisedYards
    if (drift > 0.02) {
      issues.push(`yardage_total_mismatch:sum=${yardSum},advertised=${advertisedYards},drift_pct=${(drift * 100).toFixed(1)}`)
    }
  }

  // Each hole sanity
  let badYardCount = 0, missingPar = 0
  for (const h of holes) {
    if (!Number.isFinite(h?.par) || h.par < 3 || h.par > 6) missingPar++
    const y = parseInt(h?.yardage) || 0
    if (y && (y < 80 || y > 700)) badYardCount++
  }
  if (missingPar) issues.push(`bad_par_count:${missingPar}`)
  if (badYardCount) issues.push(`bad_yardage_count:${badYardCount}`)

  // Handicap set should be 1..18 unique
  const hcps = holes.map(h => parseInt(h?.handicap)).filter(n => Number.isFinite(n))
  if (hcps.length === 18) {
    const set = new Set(hcps)
    if (set.size !== 18) issues.push('handicap_duplicates')
    for (let i = 1; i <= 18; i++) if (!set.has(i)) { issues.push('handicap_set_incomplete'); break }
  } else if (hcps.length) {
    issues.push(`handicap_count:${hcps.length}`)
  }

  return issues
}
