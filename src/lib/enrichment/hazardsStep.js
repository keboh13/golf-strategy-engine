// Phase 5: Per-hole hazard intelligence step
// Loads hazard data from Supabase and merges it into hole design.

import { loadCourseHazards } from '../supabase.js'
import { ENRICH_STEP_IDS } from '../enrichSteps.js'
import { STEP_STATES } from '../progress.js'

export const hazardsStep = {
  id: ENRICH_STEP_IDS.HAZARDS,
  parallel: true,
  async run(ctx) {
    const { course, setCourse, markStep, enrichLoadId, enrichLoadIdRef } = ctx

    markStep(ENRICH_STEP_IDS.HAZARDS, STEP_STATES.RUNNING, { startedAt: Date.now() })
    try {
      const hazardsByRef = await loadCourseHazards(course.name, course.location)
      if (enrichLoadId === enrichLoadIdRef.current) {
        const hasAny = hazardsByRef && Object.keys(hazardsByRef).length > 0
        setCourse(prev => ({
          ...prev,
          holes: hasAny
            ? prev.holes.map((h, i) => {
                const hz = hazardsByRef[i + 1]
                return hz ? { ...h, hzDesign: hz } : h
              })
            : prev.holes,
          hazardsLoaded: true,
        }))
      }
      markStep(ENRICH_STEP_IDS.HAZARDS, STEP_STATES.DONE, { endedAt: Date.now() })
      return { status: 'done' }
    } catch (e) {
      markStep(ENRICH_STEP_IDS.HAZARDS, STEP_STATES.ERROR, { endedAt: Date.now(), error: e.message })
      return { status: 'error', error: e.message }
    }
  },
}
