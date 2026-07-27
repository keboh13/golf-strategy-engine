// Per-hole confidence resolver.
//
// A course's hole carries multiple potential data sources, each with a
// different trust level. This module picks the highest-confidence source per
// field for prompt construction AND for the UI badge.
//
// Source priority (highest first):
//   yardage-book PDF (verified-by-image)
//   GolfCourseAPI  (paid, complete scorecards)
//   OSM            (surveyed geometry — verified)
//   web-search     (best-effort)
//   manual         (user-entered)

const SOURCE_RANK = {
  yardage_book: 5,
  yardage_book_high: 5,
  yardage_book_medium: 4,
  GolfCourseAPI: 4,
  osm: 4,
  yardage_book_low: 3,
  OpenGolfAPI: 3,
  web_search: 2,
  manual: 1,
  unknown: 0,
}

const RANK_TO_LABEL = ['unknown', 'low', 'medium', 'medium', 'high', 'high']

export function sourceRank(source) {
  return SOURCE_RANK[source] ?? SOURCE_RANK.unknown
}

// Choose the best source label for a hole given the parent course source and
// any per-hole enrichment (osmDesign, hzDesign, webDesign).
export function pickHoleSource(course, hole) {
  if (hole?.hzDesign) {
    const conf = hole.hzDesign._confidence || 'medium'
    return `yardage_book_${conf}`
  }
  if (hole?.osmDesign)  return 'osm'
  if (hole?.webDesign)  return 'web_search'
  if (course?.source === 'GolfCourseAPI') return 'GolfCourseAPI'
  if (course?.source === 'OpenGolfAPI')   return 'OpenGolfAPI'
  if (course?.source === 'yardage_book') return 'yardage_book'
  if (course?.source) return 'web_search'
  return 'manual'
}

export function confidenceLabel(rank) {
  return RANK_TO_LABEL[Math.min(Math.max(rank, 0), 5)] || 'unknown'
}

// Per-hole confidence JSON used in the confidence-aware prompt block.
// Each field is tagged independently because GolfCourseAPI may have par +
// yardage but no hazard data.
export function holeConfidence(course, hole) {
  const src = pickHoleSource(course, hole)
  const rank = sourceRank(src)
  const overall = confidenceLabel(rank)
  const hasHazards = !!(hole?.osmDesign?.hazards?.length || hole?.hzDesign?.hazards?.length || hole?.webDesign?.hazards?.length || hole?.webDesign?.water || hole?.webDesign?.bunkers)
  return {
    source: src,
    overall,
    par:      hole?.par != null ? 'high' : 'low',
    yardage:  hole?.yardage ? overall : 'low',
    handicap: hole?.handicap != null ? overall : 'low',
    hazards:  hasHazards
      ? (hole?.hzDesign ? 'high' : (hole?.osmDesign ? 'high' : 'low'))
      : 'none',
  }
}

// Build the confidence rollup the UI badge shows: highest source + per-hole
// breakdown counts (e.g. "12 verified, 6 web-search").
export function rollupConfidence(course) {
  if (!course?.holes) return { highest: 'unknown', breakdown: {} }
  const counts = {}
  let bestRank = -1
  let highest = 'unknown'
  for (const h of course.holes) {
    const src = pickHoleSource(course, h)
    counts[src] = (counts[src] || 0) + 1
    const r = sourceRank(src)
    if (r > bestRank) { bestRank = r; highest = src }
  }
  return { highest, breakdown: counts }
}
