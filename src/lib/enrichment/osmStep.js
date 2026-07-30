// Phase 1: OSM enrichment step
// Fetches hazard data from OpenStreetMap, enriches holes, exports GeoJSON,
// classifies tier, and computes distances.

import { fetchOSMCourseData, enrichHolesWithOSM, exportCourseGeoJSON, classifyTier, computeCoverage } from '../osmCourseData.js'
import { computeHoleDistances, simplifyAndTrimGeoJSON } from '../courseGeometry.js'
import { getCachedGeo, setCachedGeo } from '../courseGeoCache.js'
import { setCachedCourse } from '../courseCache.js'
import { ENRICH_STEP_IDS } from '../enrichSteps.js'
import { STEP_STATES } from '../progress.js'
import { retryDelay } from './runPipeline.js'

export const osmStep = {
  id: ENRICH_STEP_IDS.OSM,
  parallel: false,
  async run(ctx) {
    const { course, coords, setCourse, markStep, signal, enrichLoadId, enrichLoadIdRef, setEnrichStatus } = ctx

    setEnrichStatus('Fetching hazard data from OpenStreetMap...')
    markStep(ENRICH_STEP_IDS.OSM, STEP_STATES.RUNNING, { startedAt: Date.now() })

    let cachedGeo = null
    try { cachedGeo = await getCachedGeo(course.name, course.location) } catch {}
    if (cachedGeo?.geojson || cachedGeo?.tier === 3) {
      setCourse(prev => ({
        ...prev,
        geojson: cachedGeo.geojson || null,
        bboxByHole: cachedGeo.bboxByHole || null,
        coverage: cachedGeo.coverage || null,
        tier: cachedGeo.tier,
      }))
    }

    let osmWorked = false
    let osmLastError = null
    for (let attempt = 0; attempt < 2; attempt++) {
      if (signal.aborted || enrichLoadId !== enrichLoadIdRef.current) return { status: 'aborted' }
      try {
        const osmData = await fetchOSMCourseData(coords.lat, coords.lng, { signal })
        if (enrichLoadId !== enrichLoadIdRef.current) return { status: 'aborted' }
        if (osmData) {
          const { holes: enrichedHoles, hasDesignData } = enrichHolesWithOSM(course.holes, osmData)
          const rawGeojson = exportCourseGeoJSON(osmData, course.holes)
          const geojson = simplifyAndTrimGeoJSON(rawGeojson)
          geojson.bboxByHole = rawGeojson.bboxByHole
          const tier = classifyTier(geojson, course.holes)
          const coverage = computeCoverage(geojson, course.holes)
          const bboxByHole = geojson.bboxByHole

          const distancesByRef = {}
          for (const h of enrichedHoles) {
            const ref = course.holes.indexOf(h) + 1
            const d = computeHoleDistances(geojson, ref)
            if (d) distancesByRef[ref] = d
          }

          if (hasDesignData || tier <= 2) osmWorked = true
          setCourse(prev => {
            const merged = prev.holes.map((h, i) => {
              const eh = enrichedHoles[i]
              const dist = distancesByRef[i + 1] || null
              return {
                ...h,
                notes: h.notes || eh?.notes || '',
                osmDesign: eh?.osmDesign
                  ? { ...eh.osmDesign, distances: dist }
                  : (dist ? { source: 'OpenStreetMap', distances: dist } : null),
              }
            })
            const updated = { ...prev, holes: merged, osmEnriched: true, geojson: geojson.features?.length ? geojson : null, bboxByHole, coverage, tier }
            // #154: keep localStorage for immediate UI reactivity
            setCachedCourse(updated)
            // Defer DB write -- collected at end of enrichment
            return updated
          })
          try {
            await setCachedGeo(course.name, course.location, {
              tier,
              geojson: geojson.features?.length ? geojson : null,
              bboxByHole,
              coverage,
              source: 'osm',
            })
          } catch {}
        }
        break
      } catch (e) {
        osmLastError = e
        if (attempt === 0) {
          setEnrichStatus('Retrying OSM data...')
          // #153: backoff before retry
          await new Promise(r => setTimeout(r, retryDelay(attempt, e)))
        }
      }
    }
    markStep(
      ENRICH_STEP_IDS.OSM,
      osmWorked ? STEP_STATES.DONE : (osmLastError ? STEP_STATES.ERROR : STEP_STATES.SKIPPED),
      { endedAt: Date.now(), error: osmLastError ? osmLastError.message : undefined },
    )

    // Expose osmWorked on the ctx so downstream steps and the caller can read it
    ctx.osmWorked = osmWorked

    return { status: osmWorked ? 'done' : (osmLastError ? 'error' : 'skipped'), error: osmLastError?.message }
  },
}
