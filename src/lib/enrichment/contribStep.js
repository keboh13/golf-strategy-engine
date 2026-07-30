// Phase 4: User-contributed hole pins step
// Fetches community contributions and merges them into the course state.

import { getContrib } from '../holeContributions.js'
import { ENRICH_STEP_IDS } from '../enrichSteps.js'
import { STEP_STATES } from '../progress.js'

export const contribStep = {
  id: ENRICH_STEP_IDS.CONTRIB,
  parallel: true,
  async run(ctx) {
    const { course, setCourse, markStep, enrichLoadId, enrichLoadIdRef } = ctx

    markStep(ENRICH_STEP_IDS.CONTRIB, STEP_STATES.RUNNING, { startedAt: Date.now() })
    try {
      const contrib = await getContrib(course.name, course.location)
      if (enrichLoadId === enrichLoadIdRef.current && contrib && Object.keys(contrib).length) {
        setCourse(prev => ({ ...prev, contribByRef: contrib }))
      }
      markStep(ENRICH_STEP_IDS.CONTRIB, STEP_STATES.DONE, { endedAt: Date.now() })
      return { status: 'done' }
    } catch (e) {
      markStep(ENRICH_STEP_IDS.CONTRIB, STEP_STATES.ERROR, { endedAt: Date.now(), error: e.message })
      return { status: 'error', error: e.message }
    }
  },
}
