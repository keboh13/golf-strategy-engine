// Barrel re-export — keeps all existing import sites working unchanged.
// Fetch adapters (side-effecting HTTP wrappers)
export {
  geocodeViaClaudeSearch,
  searchOpenGolfAPI,
  fetchOpenGolfAPICourse,
  searchGolfCourseAPI,
  fetchScorecardViaClaudeSearch,
  fetchYardageBookViaClaudeSearch,
  adminUploadScorecardPdf,
  adminUpdateMetadata,
  adminRenameCourse,
  adminDeleteCourse,
  adminRemovePdf,
  adminReparsePdf,
  extractHazardsForHole,
  fetchHoleDesignViaSearch,
} from './courseApiFetch.js'

// Pure data normalization / transform functions
export {
  normalizeOpenGolfCourse,
  normalizeGolfCourseAPICourse,
  normalizeWebDesignHazards,
  mergeDesignDataIntoHoles,
} from './courseNormalize.js'
