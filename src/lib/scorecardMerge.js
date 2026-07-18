// Merge a freshly-uploaded yardage-book scorecard (and its extracted per-hole
// hazards) into an already-loaded course state, preserving everything that
// doesn't come from the PDF: geometry (geojson/bboxByHole/coverage/tier),
// user contributions, weather, currentHole, notes, and any OSM/web design
// already enriched onto the course.
//
// Inputs:
//   course        — the current course state (App.jsx setCourse target)
//   uploaded      — the parsed PDF payload returned by /api/course-ai
//                   (parse-yardage-book-pdf action). Expected shape:
//                   { name, location, yardage, rating, slope, par,
//                     selectedTee, source, holes: [{par,yardage,handicap},…] }
//   hazardsByRef  — { [holeRef]: {…hazards from course_hole_hazards} }
//
// Returns a NEW course object — never mutates the input.

export function mergeUploadedScorecard(course, uploaded, hazardsByRef = {}) {
  if (!course) return course
  if (!uploaded || typeof uploaded !== 'object') return course

  const upHoles = Array.isArray(uploaded.holes) ? uploaded.holes : []
  const safeHazards = hazardsByRef && typeof hazardsByRef === 'object' ? hazardsByRef : {}
  const hazardCount = Object.keys(safeHazards).length

  const upTees = Array.isArray(uploaded.tees) && uploaded.tees.length > 0 ? uploaded.tees : null

  return {
    ...course,
    yardage:     uploaded.yardage  != null ? String(uploaded.yardage)  : course.yardage,
    rating:      uploaded.rating   != null ? String(uploaded.rating)   : course.rating,
    slope:       uploaded.slope    != null ? String(uploaded.slope)    : course.slope,
    par:         uploaded.par      != null ? uploaded.par              : course.par,
    source:      uploaded.source   || course.source,
    selectedTee: uploaded.selectedTee || course.selectedTee,
    // If the PDF parse discovered a full tees[] set, replace whatever was
    // there (usually a GolfCourseAPI shape). Otherwise leave the existing
    // array in place — the merge shouldn't silently drop tees.
    tees:        upTees || course.tees,
    holes: (course.holes || []).map((h, i) => {
      const u = upHoles[i] || {}
      const ref = i + 1
      const hz = safeHazards[ref]
      return {
        ...h,
        par:      u.par      != null ? u.par                : h.par,
        yardage:  u.yardage  != null ? String(u.yardage)    : h.yardage,
        handicap: u.handicap != null ? u.handicap           : h.handicap,
        hzDesign: hz || h.hzDesign || null,
      }
    }),
    hazardsLoaded: hazardCount > 0 ? true : course.hazardsLoaded,
    _scorecardUpdatedAt: Date.now(),
  }
}

// Cache-key match check used by the upload handler to decide whether to
// hot-swap the currently-loaded course. Mirrors cacheKey() in courseCache.js
// so callers don't have to import both modules.
export function isSameCourseKey(a, b) {
  const k = (name, location) =>
    `${(name || '').toLowerCase().trim()}|${(location || '').toLowerCase().trim()}`
  return k(a?.name, a?.location) === k(b?.name, b?.location)
}
