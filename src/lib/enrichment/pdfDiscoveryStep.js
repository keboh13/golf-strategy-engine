// Phase 2: PDF auto-discovery step
// Attempts to find and parse a public yardage book PDF before falling back
// to web-search scraping. Only runs when the course has no cached
// yardage_book source (i.e., no admin PDF).

import { fetchYardageBookViaClaudeSearch } from '../courseApi.js'
import { setCachedCourse } from '../courseCache.js'
import { setCachedCourseDB } from '../supabase.js'
import { ENRICH_STEP_IDS } from '../enrichSteps.js'
import { STEP_STATES } from '../progress.js'

export const pdfDiscoveryStep = {
  id: ENRICH_STEP_IDS.PDF_DISCOVERY,
  parallel: false,
  async run(ctx) {
    const { course, session, setCourse, markStep, signal, enrichLoadId, enrichLoadIdRef } = ctx

    const authToken = session?.access_token || ''
    const hasYardageBookSource = course._source === 'yardage_book' || course.source === 'yardage_book'

    if (!hasYardageBookSource && authToken) {
      markStep(ENRICH_STEP_IDS.PDF_DISCOVERY, STEP_STATES.RUNNING, { startedAt: Date.now() })
      let pdfDiscoveryWorked = false
      try {
        if (signal.aborted || enrichLoadId !== enrichLoadIdRef.current) return { status: 'aborted' }
        const ybResult = await fetchYardageBookViaClaudeSearch(authToken, course.name, course.location, { signal })
        if (enrichLoadId !== enrichLoadIdRef.current) return { status: 'aborted' }
        if (ybResult && ybResult.holes?.length === 18 && ybResult._confidence !== 'low') {
          pdfDiscoveryWorked = true
          setCourse(prev => {
            // Merge discovered PDF data into existing holes, preserving OSM enrichment
            const mergedHoles = prev.holes.map((h, i) => {
              const discoveredHole = ybResult.holes[i]
              if (!discoveredHole) return h
              return {
                ...h,
                // Only update yardage/par if not already set from a higher-quality source
                yardage: h.yardage || String(discoveredHole.yardage || ''),
                par: h.par || discoveredHole.par,
                hzDesign: discoveredHole.hzDesign || h.hzDesign || null,
              }
            })
            const updated = {
              ...prev,
              holes: mergedHoles,
              _source: 'yardage_book',
              _sourcePdf: ybResult._sourcePdf || null,
              _discoveredVia: 'auto_discovery',
            }
            setCachedCourse(updated)
            setCachedCourseDB(updated).catch(() => {})
            return updated
          })
        }
      } catch (e) {
        console.warn('[pdf-discovery] auto-discovery failed:', e.message)
      }
      markStep(
        ENRICH_STEP_IDS.PDF_DISCOVERY,
        pdfDiscoveryWorked ? STEP_STATES.DONE : STEP_STATES.SKIPPED,
        { endedAt: Date.now() },
      )
      return { status: pdfDiscoveryWorked ? 'done' : 'skipped' }
    } else {
      markStep(ENRICH_STEP_IDS.PDF_DISCOVERY, STEP_STATES.SKIPPED)
      return { status: 'skipped' }
    }
  },
}
