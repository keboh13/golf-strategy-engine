// Step definitions for the course-enrichment ProgressTracker (Part 0.2 of the
// optimization plan). Defined in one place so App.jsx (which runs the steps)
// and PrepTab.jsx (which renders the tracker) agree on ids and labels.
//
// expectedMs comes from rough p50s observed in dev — they drive the "~ Ns
// typically" copy in ProgressTracker and the over-due tipping point. Refined
// from telemetry once rec_log.phase_durations starts collecting samples.
export const ENRICH_STEP_IDS = {
  GEOCODE:  'geocode',
  OSM:      'osm',
  DESIGN:   'design',
  CONTRIB:  'contrib',
  HAZARDS:  'hazards',
}

export const ENRICH_STEPS = Object.freeze([
  { id: ENRICH_STEP_IDS.GEOCODE,  label: 'Resolving coordinates',  expectedMs: 1500 },
  { id: ENRICH_STEP_IDS.OSM,      label: 'OSM geometry',           expectedMs: 3000 },
  { id: ENRICH_STEP_IDS.DESIGN,   label: 'Hole design',            expectedMs: 6000 },
  { id: ENRICH_STEP_IDS.CONTRIB,  label: 'Community contributions', expectedMs: 600 },
  { id: ENRICH_STEP_IDS.HAZARDS,  label: 'Hazard intel',           expectedMs: 600 },
])
