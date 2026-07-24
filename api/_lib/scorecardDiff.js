// Build a JSON-Patch-ish diff: { field: { current, parsed } } for every field
// where a fresh PDF (re)parse differs from what's already stored. Limited to
// the canonical scorecard fields + hole-level par/yardage/handicap + hazard
// coverage. Admin reviews this before accepting fields into the editor.
export function buildScorecardDiff(current, parsed) {
  const diff = {}
  const FIELDS = ['name', 'location', 'yardage', 'rating', 'slope', 'par', 'selectedTee']
  for (const f of FIELDS) {
    const cur = current?.[f]
    const next = parsed?.[f]
    if (next != null && String(cur ?? '') !== String(next ?? '')) {
      diff[f] = { current: cur ?? null, parsed: next }
    }
  }

  // tees is an array of {name, color, yardage, rating, slope, par, holes[]} —
  // hand the whole thing over as a single field diff. Editor's accept handler
  // replaces the current tees[] wholesale.
  if (Array.isArray(parsed?.tees) && parsed.tees.length > 0) {
    const curTees = Array.isArray(current?.tees) ? current.tees : []
    const summarize = t => `${t?.name || '?'}(${t?.yardage ?? '—'}y)`
    const curSummary = curTees.map(summarize).join(', ') || '—'
    const nextSummary = parsed.tees.map(summarize).join(', ')
    if (JSON.stringify(curTees) !== JSON.stringify(parsed.tees)) {
      diff.tees = { current: curSummary, parsed: nextSummary, _value: parsed.tees }
    }
  }

  const holesDiff = []
  const curHoles = Array.isArray(current?.holes) ? current.holes : []
  const newHoles = Array.isArray(parsed?.holes) ? parsed.holes : []
  for (let i = 0; i < Math.max(curHoles.length, newHoles.length); i++) {
    const a = curHoles[i] || {}
    const b = newHoles[i] || {}
    const fields = {}
    for (const k of ['par', 'yardage', 'handicap']) {
      if (b[k] != null && String(a[k] ?? '') !== String(b[k] ?? '')) {
        fields[k] = { current: a[k] ?? null, parsed: b[k] }
      }
    }
    if (Object.keys(fields).length) holesDiff.push({ hole: i + 1, fields })
  }
  if (holesDiff.length) diff.holes = holesDiff

  // Hazards live in a separate table (course_hole_hazards), not on `current`
  // (course_cache row), so there's no "before" value to diff against here —
  // this just surfaces what the parse found, for the admin to review and
  // accept (or not) the same way tees[] is accepted wholesale.
  const hazardsByHole = Array.isArray(parsed?.hazardsByHole) ? parsed.hazardsByHole : []
  if (hazardsByHole.length > 0) {
    const coverage = parsed?.hazardCoverage
    const coverageLabel = coverage ? `${coverage.covered}/${coverage.total} holes` : `${hazardsByHole.length} holes`
    diff.hazards = { current: null, parsed: coverageLabel, _value: hazardsByHole }
  }

  return diff
}
