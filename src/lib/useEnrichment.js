import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { setCachedCourseDB } from './supabase.js'
import { geocodeViaClaudeSearch } from './courseApi.js'
import { mergeContribIntoGeojson } from './holeContributions.js'
import { ENRICH_STEP_IDS } from './enrichSteps.js'
import { STEP_STATES } from './progress.js'
import { runPipeline } from './enrichment/runPipeline.js'
import { osmStep } from './enrichment/osmStep.js'
import { pdfDiscoveryStep } from './enrichment/pdfDiscoveryStep.js'
import { designStep } from './enrichment/designStep.js'
import { contribStep } from './enrichment/contribStep.js'
import { hazardsStep } from './enrichment/hazardsStep.js'

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
        const c = await geocodeViaClaudeSearch(authToken, course.name, course.location || '', {})
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
      const ctx = {
        course,
        coords,
        session,
        setCourse,
        markStep,
        signal: ctrl.signal,
        enrichLoadId: myId,
        enrichLoadIdRef,
        setEnrichStatus,
        osmWorked: false,
      }

      // Phase 1 (sequential): OSM enrichment
      // Phase 2 (sequential): PDF auto-discovery
      // Phase 3-5 (parallel): Design, Contrib, Hazards
      const steps = [
        osmStep,
        pdfDiscoveryStep,
        designStep,   // parallel: true
        contribStep,  // parallel: true
        hazardsStep,  // parallel: true
      ]

      await runPipeline(steps, ctx)

      if (!ctx.osmWorked && myId === enrichLoadIdRef.current) {
        setCourse(prev => ({ ...prev, osmEnriched: true }))
      }

      // #154: Single deferred DB cache write after all enrichment completes
      if (myId === enrichLoadIdRef.current) {
        setCourse(prev => {
          setCachedCourseDB(prev).catch(() => {})
          return prev
        })
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
