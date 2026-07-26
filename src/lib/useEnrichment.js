import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { fetchOSMCourseData, enrichHolesWithOSM, exportCourseGeoJSON, classifyTier, computeCoverage } from './osmCourseData.js'
import { computeHoleDistances, simplifyAndTrimGeoJSON } from './courseGeometry.js'
import { getCachedGeo, setCachedGeo } from './courseGeoCache.js'
import { getContrib, mergeContribIntoGeojson } from './holeContributions.js'
import { setCachedCourse } from './courseCache.js'
import { setCachedCourseDB, loadCourseHazards } from './supabase.js'
import { fetchHoleDesignViaSearch, mergeDesignDataIntoHoles, geocodeViaClaudeSearch } from './courseApi.js'
import { ENRICH_STEP_IDS } from './enrichSteps.js'
import { STEP_STATES } from './progress.js'

const EMPTY_PROGRESS = { states: {}, startsAt: {}, endsAt: {}, errors: {} }

export function useEnrichment({ course, coords, setCourse, setCoords, session }) {
  const [enriching, setEnriching] = useState(false)
  const [enrichStatus, setEnrichStatus] = useState('')
  const [enrichProgress, setEnrichProgress] = useState(EMPTY_PROGRESS)

  const markStep = useCallback((id, state, patch = {}) => {
    setEnrichProgress(prev => ({
      states:   { ...prev.states,   [id]: state },
      startsAt: patch.startedAt != null ? { ...prev.startsAt, [id]: patch.startedAt } : prev.startsAt,
      endsAt:   patch.endedAt   != null ? { ...prev.endsAt,   [id]: patch.endedAt }   : prev.endsAt,
      errors:   patch.error     != null ? { ...prev.errors,   [id]: patch.error }     : prev.errors,
    }))
  }, [])

  // Auto-geocode when coords are missing
  const geocodeRef = useRef(null)
  useEffect(() => {
    if (!course.name || coords?.lat || coords?.lng) return
    const authToken = session?.access_token || ''
    if (!authToken) return
    const key = `${course.name}|${course.location || ''}`
    if (geocodeRef.current === key) return
    geocodeRef.current = key
    const startedAt = Date.now()
    setEnrichProgress(prev => ({
      ...prev,
      states:   { ...prev.states,   [ENRICH_STEP_IDS.GEOCODE]: STEP_STATES.RUNNING },
      startsAt: { ...prev.startsAt, [ENRICH_STEP_IDS.GEOCODE]: startedAt },
    }))
    let cancelled = false
    ;(async () => {
      try {
        const c = await geocodeViaClaudeSearch(authToken, course.name, course.location || '')
        if (cancelled) return
        if (c?.lat && c?.lng) {
          setCoords({ lat: c.lat, lng: c.lng })
          setEnrichProgress(prev => ({
            ...prev,
            states: { ...prev.states, [ENRICH_STEP_IDS.GEOCODE]: STEP_STATES.DONE },
            endsAt: { ...prev.endsAt, [ENRICH_STEP_IDS.GEOCODE]: Date.now() },
          }))
        }
      } catch (e) {
        if (cancelled) return
        setEnrichProgress(prev => ({
          ...prev,
          states: { ...prev.states, [ENRICH_STEP_IDS.GEOCODE]: STEP_STATES.ERROR },
          endsAt: { ...prev.endsAt, [ENRICH_STEP_IDS.GEOCODE]: Date.now() },
          errors: { ...prev.errors, [ENRICH_STEP_IDS.GEOCODE]: e.message },
        }))
      }
    })()
    return () => { cancelled = true }
  }, [course.name, course.location, coords?.lat, coords?.lng, session, setCoords])

  // Main enrichment pipeline
  const enrichLoadIdRef = useRef(0)
  useEffect(() => {
    if (!course.name || !coords?.lat || !coords?.lng || course.osmEnriched) return
    const myId = ++enrichLoadIdRef.current
    const ctrl = new AbortController()
    setEnriching(true)
    setEnrichStatus('Loading course design data...')
    setEnrichProgress({
      states:   { [ENRICH_STEP_IDS.GEOCODE]: STEP_STATES.DONE },
      startsAt: {},
      endsAt:   {},
      errors:   {},
    })
    ;(async () => {
      let osmWorked = false

      // Phase 1: OSM enrichment
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
      let osmLastError = null
      for (let attempt = 0; attempt < 2; attempt++) {
        if (ctrl.signal.aborted || myId !== enrichLoadIdRef.current) return
        try {
          const osmData = await fetchOSMCourseData(coords.lat, coords.lng)
          if (myId !== enrichLoadIdRef.current) return
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
              setCachedCourse(updated)
              setCachedCourseDB(updated).catch(() => {})
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
          if (attempt === 0) setEnrichStatus('Retrying OSM data...')
        }
      }
      markStep(
        ENRICH_STEP_IDS.OSM,
        osmWorked ? STEP_STATES.DONE : (osmLastError ? STEP_STATES.ERROR : STEP_STATES.SKIPPED),
        { endedAt: Date.now(), error: osmLastError ? osmLastError.message : undefined },
      )

      // Phase 2: Web search enrichment (if OSM coverage is sparse)
      const authToken = session?.access_token || ''
      const holesWithDesign = course.holes.filter(h => h.osmDesign?.hazards?.length > 0 || h.notes).length
      if (holesWithDesign < 9 && authToken) {
        setEnrichStatus('Searching for hole design details...')
        markStep(ENRICH_STEP_IDS.DESIGN, STEP_STATES.RUNNING, { startedAt: Date.now() })
        let designDone = false, designErr = null
        for (let attempt = 0; attempt < 2; attempt++) {
          if (ctrl.signal.aborted || myId !== enrichLoadIdRef.current) return
          try {
            const designData = await fetchHoleDesignViaSearch(authToken, course.name, course.location)
            if (myId !== enrichLoadIdRef.current) return
            if (designData?.holes?.length) {
              setCourse(prev => {
                const mergedHoles = mergeDesignDataIntoHoles(prev.holes, designData)
                const updated = { ...prev, holes: mergedHoles, webDesignSource: designData.source || 'web search', osmEnriched: true }
                setCachedCourse(updated)
                setCachedCourseDB(updated).catch(() => {})
                return updated
              })
              designDone = true
            }
            break
          } catch (e) {
            designErr = e
            if (attempt === 0) setEnrichStatus('Retrying design search...')
          }
        }
        markStep(
          ENRICH_STEP_IDS.DESIGN,
          designDone ? STEP_STATES.DONE : (designErr ? STEP_STATES.ERROR : STEP_STATES.SKIPPED),
          { endedAt: Date.now(), error: designErr ? designErr.message : undefined },
        )
      } else {
        markStep(ENRICH_STEP_IDS.DESIGN, STEP_STATES.SKIPPED)
      }

      if (!osmWorked && myId === enrichLoadIdRef.current) {
        setCourse(prev => ({ ...prev, osmEnriched: true }))
      }

      // Phase 3: User-contributed hole pins
      markStep(ENRICH_STEP_IDS.CONTRIB, STEP_STATES.RUNNING, { startedAt: Date.now() })
      try {
        const contrib = await getContrib(course.name, course.location)
        if (myId === enrichLoadIdRef.current && contrib && Object.keys(contrib).length) {
          setCourse(prev => ({ ...prev, contribByRef: contrib }))
        }
        markStep(ENRICH_STEP_IDS.CONTRIB, STEP_STATES.DONE, { endedAt: Date.now() })
      } catch (e) {
        markStep(ENRICH_STEP_IDS.CONTRIB, STEP_STATES.ERROR, { endedAt: Date.now(), error: e.message })
      }

      // Phase 4: Per-hole hazard intelligence
      markStep(ENRICH_STEP_IDS.HAZARDS, STEP_STATES.RUNNING, { startedAt: Date.now() })
      try {
        const hazardsByRef = await loadCourseHazards(course.name, course.location)
        if (myId === enrichLoadIdRef.current) {
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
      } catch (e) {
        markStep(ENRICH_STEP_IDS.HAZARDS, STEP_STATES.ERROR, { endedAt: Date.now(), error: e.message })
      }

      if (myId === enrichLoadIdRef.current) {
        setEnriching(false)
        setEnrichStatus('')
      }
    })()
    return () => ctrl.abort()
  }, [course.name, coords?.lat, coords?.lng, course.osmEnriched, session, setCourse, markStep])

  const displayGeo = useMemo(() => {
    if (!course?.contribByRef || !Object.keys(course.contribByRef).length) {
      return { geojson: course?.geojson || null, bboxByHole: course?.bboxByHole || null }
    }
    return mergeContribIntoGeojson(course.geojson, course.bboxByHole, course.contribByRef)
  }, [course?.geojson, course?.bboxByHole, course?.contribByRef])

  const contributedHoleSet = useMemo(
    () => new Set(Object.keys(course?.contribByRef || {}).map(n => parseInt(n))),
    [course?.contribByRef]
  )

  return { enriching, enrichStatus, enrichProgress, displayGeo, contributedHoleSet }
}
