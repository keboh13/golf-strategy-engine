// Shared scorecard validation rules. Used by AdminCourseEditor (client-side)
// and mirrors the server-side validateScorecardJson in api/course-ai.js.
// Extracted to eliminate the duplicate validation implementation.

/**
 * Validate a scorecard's holes array and course name.
 * @param {Array} holes - Array of hole objects with par, yardage fields
 * @param {string} courseName - Course name (required)
 * @returns {string[]} Array of human-readable issue strings (empty = valid)
 */
export function validateScorecard(holes, courseName) {
  const issues = []
  const parTotal = holes.reduce((s, h) => s + (parseInt(h.par) || 0), 0)
  if (parTotal < 68 || parTotal > 74) issues.push(`par total ${parTotal} outside 68–74`)
  const yardTotal = holes.reduce((s, h) => s + (parseInt(h.yardage) || 0), 0)
  if (yardTotal && (yardTotal < 4500 || yardTotal > 8200)) issues.push(`yardage total ${yardTotal} outside 4500–8200`)
  for (let i = 0; i < holes.length; i++) {
    const y = parseInt(holes[i].yardage) || 0
    if (y && (y < 80 || y > 700)) { issues.push(`hole ${i + 1} yardage ${y} outside 80–700`); break }
  }
  if (!courseName?.trim()) issues.push('course name is required')
  return issues
}
