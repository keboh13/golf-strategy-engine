// ─── Prompt sections: per-club lines for the recommendation prompt ────────────
// Pure module — no app imports. Used by buildPrompt() in src/App.jsx.
//
// Legacy contract: when a club has no imported stats, buildClubLine() must
// reproduce the original inline builder from App.jsx byte-for-byte.
// Rich path: when `club.stats` (attached by the import pipeline) is present
// with samples >= 3, emit a denser, data-driven single line instead.

const round0 = n => String(Math.round(n))
const round1 = n => String(Math.round(n * 10) / 10)

// Byte-for-byte replica of the original per-club builder in buildPrompt().
function legacyClubLine(c) {
  let s = `${c.club}: ${c.carry}y (${c.shape})`
  const analytics = [
    c.ballSpeed   ? `${c.ballSpeed}mph ball speed`                                                       : '',
    c.launchAngle ? `${c.launchAngle}° launch`                                                           : '',
    c.spinRate    ? `${c.spinRate}rpm spin`                                                               : '',
    (c.dispLeft || c.dispRight) ? `${c.dispLeft || 0}yd left / ${c.dispRight || 0}yd right dispersion`  : '',
  ].filter(Boolean)
  if (analytics.length) s += ` | ${analytics.join(', ')}`
  return s
}

// Dense line from imported launch-monitor stats, e.g.:
// Driver: 275y carry (Draw, P50 of 124 shots, P80 282y, ±9.1y) | miss bias 3.2y R,
//   disp 12y L / 8y R | 158.2mph ball, 10.5° launch, 2602rpm | data: trackman, last 2026-05-20
function richClubLine(c, stats) {
  const segs = []

  // Carry segment (prefer P50, fall back to avg, then to the manual entry)
  const carryVal = stats.carryP50 ?? stats.carryAvg
  if (carryVal != null) {
    const parens = []
    if (c.shape) parens.push(c.shape)
    parens.push(`${stats.carryP50 != null ? 'P50' : 'avg'} of ${stats.samples} shots`)
    if (stats.carryP80 != null) parens.push(`P80 ${round0(stats.carryP80)}y`)
    if (stats.carryStd != null) parens.push(`±${round1(stats.carryStd)}y`)
    segs.push(`${c.club}: ${round0(carryVal)}y carry (${parens.join(', ')})`)
  } else {
    segs.push(`${c.club}: ${c.carry}y (${c.shape})`)
  }

  // Miss pattern segment
  const miss = []
  if (stats.offlineBias != null) {
    const mag = Math.round(Math.abs(stats.offlineBias) * 10) / 10
    miss.push(mag === 0 ? 'miss bias 0y' : `miss bias ${mag}y ${stats.offlineBias > 0 ? 'R' : 'L'}`)
  }
  const disp = []
  if (stats.dispLeftP80  != null) disp.push(`${round0(stats.dispLeftP80)}y L`)
  if (stats.dispRightP80 != null) disp.push(`${round0(stats.dispRightP80)}y R`)
  if (disp.length) miss.push(`disp ${disp.join(' / ')}`)
  if (miss.length) segs.push(miss.join(', '))

  // Ball-flight segment
  const flight = []
  if (stats.ballSpeedAvg != null) flight.push(`${round1(stats.ballSpeedAvg)}mph ball`)
  if (stats.launchAvg    != null) flight.push(`${round1(stats.launchAvg)}° launch`)
  if (stats.spinAvg      != null) flight.push(`${round0(stats.spinAvg)}rpm`)
  if (flight.length) segs.push(flight.join(', '))

  // Provenance segment
  const data = []
  if (Array.isArray(stats.sources) && stats.sources.length) data.push(stats.sources.join('/'))
  if (stats.lastSessionDate) data.push(`last ${stats.lastSessionDate}`)
  if (data.length) segs.push(`data: ${data.join(', ')}`)

  return segs.join(' | ')
}

export function buildClubLine(club) {
  const stats = club?.stats
  if (stats && Number.isFinite(stats.samples) && stats.samples >= 3) {
    return richClubLine(club, stats)
  }
  let line = legacyClubLine(club)
  if (stats) line += ` (n=${stats.samples ?? 0} imported shots)`
  return line
}

// Joins lines exactly the way buildPrompt() joined them originally.
export function buildBagSection(clubs) {
  return (clubs ?? []).map(buildClubLine).join(', ')
}
