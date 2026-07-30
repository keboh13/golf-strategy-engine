// Phase 3: Web search enrichment step (runs when OSM coverage is sparse)
// Searches for hole design details via web search and merges results.

import { fetchHoleDesignViaSearch, mergeDesignDataIntoHoles } from '../courseApi.js'
import { setCachedCourse } from '../courseCache.js'
import { ENRICH_STEP_IDS } from '../enrichSteps.js'
import { STEP_STATES } from '../progress.js'
import { retryDelay } from './runPipeline.js'

export const designStep = {
  id: ENRICH_STEP_IDS.DESIGN,
  parallel: true,
  async run(ctx) {
    const { course, session, setCourse, markStep, signal, enrichLoadId, enrichLoadIdRef, setEnrichStatus } = ctx

    const authToken = session?.access_token || ''
    const holesWithDesign = course.holes.filter(h => h.osmDesign?.hazards?.length > 0 || h.notes).length

    if (holesWithDesign >= 9 || !authToken) {
      markStep(ENRICH_STEP_IDS.DESIGN, STEP_STATES.SKIPPED)
      return { status: 'skipped' }
    }

    setEnrichStatus('Searching for hole design details...')
    markStep(ENRICH_STEP_IDS.DESIGN, STEP_STATES.RUNNING, { startedAt: Date.now() })

    let designDone = false, designErr = null
    for (let attempt = 0; attempt < 2; attempt++) {
      if (signal.aborted || enrichLoadId !== enrichLoadIdRef.current) return { status: 'aborted' }
      try {
        const designData = await fetchHoleDesignViaSearch(authToken, course.name, course.location, { signal })
        if (enrichLoadId !== enrichLoadIdRef.current) return { status: 'aborted' }
        if (designData?.holes?.length) {
          setCourse(prev => {
            const mergedHoles = mergeDesignDataIntoHoles(prev.holes, designData)
            const updated = { ...prev, holes: mergedHoles, webDesignSource: designData.source || 'web search', osmEnriched: true }
            // #154: keep localStorage for immediate UI reactivity
            setCachedCourse(updated)
            return updated
          })
          designDone = true
        }
        break
      } catch (e) {
        designErr = e
        if (attempt === 0) {
          setEnrichStatus('Retrying design search...')
          // #153: backoff before retry (longer for 429/503)
          await new Promise(r => setTimeout(r, retryDelay(attempt, e)))
        }
      }
    }
    markStep(
      ENRICH_STEP_IDS.DESIGN,
      designDone ? STEP_STATES.DONE : (designErr ? STEP_STATES.ERROR : STEP_STATES.SKIPPED),
      { endedAt: Date.now(), error: designErr ? designErr.message : undefined },
    )

    return { status: designDone ? 'done' : (designErr ? 'error' : 'skipped'), error: designErr?.message }
  },
}
