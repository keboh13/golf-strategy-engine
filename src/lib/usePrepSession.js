import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { buildRecommendationPrompt } from './recommendation/prompt.js'
import { saveContrib } from './holeContributions.js'
import { computeHoleTimes, getWeatherAtHour } from './weather.js'
import { todayLocalIso } from './localDate.js'
import { getLatestPostRoundForCourse } from './postRound.js'
import { useEnrichment } from './useEnrichment.js'
import { useGeneration } from './useGeneration.js'
import { getCachedCourseDB, loadPrepSession, savePrepSession, clearPrepSession } from './supabase.js'
import { makeDefaultCourse } from './appConstants.js'
import { parsePlanHoles } from './planParser.js'
import { printPlan as doPrintPlan } from './printPlan.js'

export function usePrepSession({ user, session, currentProfile, playerInfo, clubs, scoringHistory, selectedModel, setTab }) {
  // ── Prep flow step ───────────────────────────────────────────────────────
  const [prepStep, setPrepStep] = useState(1)
  // Bumped by resetPrep so CourseSearch (which owns its own query/results
  // state) remounts and clears the prior search input.
  const [courseSearchResetKey, setCourseSearchResetKey] = useState(0)

  // ── Course state ─────────────────────────────────────────────────────────
  const [course, setCourse] = useState(makeDefaultCourse)
  const [coords, setCoords] = useState(null)
  const [cacheVersion, setCacheVersion] = useState(0)

  // ── Tee time & weather ───────────────────────────────────────────────────
  const [teeTime,  setTeeTime]  = useState('10:00')
  const [teeDate,  setTeeDate]  = useState(() => todayLocalIso())
  const [pace,     setPace]     = useState(11)
  const [timezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone)
  const [weather,        setWeather]        = useState(null)
  const [weatherLoading, setWeatherLoading] = useState(false)

  // ── Plan state ───────────────────────────────────────────────────────────
  const [planStyle,   setPlanStyle]   = useState('balanced')
  const [planView,    setPlanView]    = useState('companion')
  const [currentHole, setCurrentHole] = useState(0)
  const [copied,      setCopied]      = useState(false)
  const [savedBriefs, setSavedBriefs] = useState(() => {
    try { return JSON.parse(localStorage.getItem('golf_saved_briefs') || '[]') } catch { return [] }
  })
  const [holeScores,  setHoleScores]  = useState({})

  const setScore = (holeNum, val) => setHoleScores(s => ({ ...s, [holeNum]: Math.max(1, val) }))
  const clearScores = () => setHoleScores({})

  // ── Enrichment ───────────────────────────────────────────────────────────
  const { enriching, enrichStatus, enrichProgress, displayGeo, contributedHoleSet } = useEnrichment({
    course, coords, setCourse, setCoords, session,
  })

  // ── Derived values ───────────────────────────────────────────────────────
  const holeTimes   = computeHoleTimes(teeTime, pace)
  const holeWeather = holeTimes.map(dt => weather ? getWeatherAtHour(weather, dt) : null)

  // ── New recommendation prompt builder ─────────────────────────────────
  // Delegates to src/lib/recommendation/prompt.js — pure module, snapshot-
  // tested, pre-computes wind/elevation/dispersion math so the LLM doesn't
  // have to guess at it.
  const buildPrompt = useCallback(() => {
    const priorRound = getLatestPostRoundForCourse(savedBriefs, course?.name)
    const { prompt } = buildRecommendationPrompt({
      playerInfo, clubs, course, holeTimes, holeWeather,
      teeTime, teeDate, pace,
      scoringHistory,
      style: planStyle,
      priorRound,
      nowMs: Date.now(),
    })
    return prompt
  }, [clubs, course, playerInfo, holeWeather, holeTimes, teeTime, teeDate, pace, scoringHistory, planStyle, savedBriefs])

  // ── Generation ───────────────────────────────────────────────────────────
  const {
    plan, setPlan,
    planLoading, planPhase, planError,
    planValidationBanner,
    genProgress,
    lastRecLogId,
    generate, cancelGenerate,
  } = useGeneration({ session, buildPrompt, selectedModel, planStyle, course, user, setSavedBriefs, setTab, setPrepStep })

  const copyPlan = async () => {
    await navigator.clipboard.writeText(plan)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const printPlan = () => doPrintPlan({ plan, course, playerInfo, teeDate, teeTime })

  const parsedHoles = useMemo(() => parsePlanHoles(plan), [plan])

  // ── Callbacks ────────────────────────────────────────────────────────────

  const applyScorecard = useCallback((r) => {
    setCourse(prev => ({
      ...prev,
      name:     r.name,
      location: r.location || prev.location,
      yardage:  String(r.yardage || ''),
      rating:   String(r.rating  || ''),
      slope:    String(r.slope   || ''),
      par:      r.par || 72,
      source:   r.source || '',
      osmEnriched: r.osmEnriched || false,
      webDesignSource: r.webDesignSource || '',
      tees:     r.tees || [],
      selectedTee: r.selectedTee || '',
      holes: r.holes.map((h, i) => ({
        ...prev.holes[i],
        par:      h.par,
        yardage:  String(h.yardage || ''),
        handicap: h.handicap || i + 1,
        notes:    prev.holes[i]?.notes || h.notes || '',
        osmDesign:  h.osmDesign || null,
        webDesign:  h.webDesign || null,
      })),
    }))
    if (r.lat && r.lng) setCoords({ lat: r.lat, lng: r.lng })
    else setCoords(null)
  }, [])

  // Cross-device resume for Round Prep (Part 1.2 of the optimization plan).
  // Loads the saved prep_sessions row once per (user, profile) and rehydrates
  // the minimum slice the user expects to find waiting: their course, tee,
  // tee time, pace, plan style, and which step they were on.
  const prepRestoreRef = useRef(false)

  const resetPrep = useCallback(() => {
    setCourse(makeDefaultCourse())
    setPlan('')
    setWeather(null)
    setCoords(null)
    setCurrentHole(0)
    setHoleScores({})
    setPrepStep(1)
    // Force CourseSearch to remount so its typed query and any stale
    // scorecard-detail card clear along with the parent state.
    setCourseSearchResetKey(k => k + 1)
    // Wipe the persisted prep_sessions row so the next mount / other device
    // doesn't restore the course we just cleared. Marking this session as
    // "already restored" prevents the load effect from racing us.
    prepRestoreRef.current = true
    if (user?.id) {
      clearPrepSession(user.id, currentProfile).catch(e =>
        console.warn('[prep_sessions] clear:', e.message)
      )
    }
  }, [user?.id, currentProfile])

  // Handler passed to CourseHoleMap. Persists the tee/pin pair locally + to
  // Supabase, then merges it into state so distances light up immediately.
  const handleHoleContribution = useCallback(async ({ ref, teeLng, teeLat, pinLng, pinLat }) => {
    if (!course?.name || !ref) return
    const contrib = { teeLng, teeLat, pinLng, pinLat, source: 'user', updatedAt: new Date().toISOString() }
    try { await saveContrib(course.name, course.location, ref, contrib) } catch {}
    setCourse(prev => ({
      ...prev,
      contribByRef: { ...(prev.contribByRef || {}), [ref]: contrib },
    }))
  }, [course?.name, course?.location])

  // ── Effects ──────────────────────────────────────────────────────────────

  // Cross-device resume: loads the saved prep_sessions row once per
  // (user, profile) and rehydrates course, tee, tee time, pace, plan style,
  // and which step they were on. The full course record is reloaded via
  // getCachedCourseDB so we don't store the whole holes/geo blob in
  // prep_sessions.
  useEffect(() => {
    if (!user) return
    // Don't trample a session in progress — if the user has already picked
    // a course this session (manually or via the sample-course flow),
    // resume is a no-op for the rest of this mount.
    if (prepRestoreRef.current) return
    if (course.name) { prepRestoreRef.current = true; return }
    let cancelled = false
    ;(async () => {
      try {
        const row = await loadPrepSession(user.id, currentProfile)
        if (cancelled || !row?.state) return
        const s = row.state
        if (s.teeTime) setTeeTime(s.teeTime)
        if (s.teeDate) setTeeDate(s.teeDate)
        if (typeof s.pace === 'number') setPace(s.pace)
        if (s.planStyle) setPlanStyle(s.planStyle)
        if (s.courseName) {
          try {
            const cached = await getCachedCourseDB(s.courseName, s.courseLocation || '')
            if (cached && !cancelled) {
              applyScorecard(cached)
              if (s.selectedTee) {
                setCourse(prev => ({ ...prev, selectedTee: s.selectedTee }))
              }
            }
          } catch {}
        }
        if (typeof s.prepStep === 'number' && s.prepStep >= 1 && s.prepStep <= 4) {
          setPrepStep(s.prepStep)
        }
        prepRestoreRef.current = true
      } catch (e) {
        if (!cancelled) console.warn('[prep_sessions] load:', e.message)
      }
    })()
    return () => { cancelled = true }
  }, [user?.id, currentProfile, applyScorecard])

  // Debounced save of the prep slice we care about. Fires only when the user
  // has actually picked a course (saving an empty session would clobber a
  // real one across devices).
  useEffect(() => {
    if (!user || !course.name) return
    const state = {
      prepStep,
      courseName: course.name,
      courseLocation: course.location || '',
      selectedTee: course.selectedTee || '',
      teeTime, teeDate, pace,
      planStyle,
    }
    const timer = setTimeout(() => {
      savePrepSession(user.id, currentProfile, state).catch(e =>
        console.warn('[prep_sessions] save:', e.message)
      )
    }, 1500)
    return () => clearTimeout(timer)
  }, [user, currentProfile, prepStep, course.name, course.location, course.selectedTee, teeTime, teeDate, pace, planStyle])

  // Post-onboarding hand-off (Part 1.1 of the optimization plan). When the
  // wizard finishes with the "Try it now" CTA it stamps a flag; we read it
  // once on mount, try to load Pebble Beach from the shared cache, and drop
  // the user into Round Prep so they see a real brief in under a minute.
  const sampleCourseTriedRef = useRef(false)
  useEffect(() => {
    if (sampleCourseTriedRef.current) return
    if (localStorage.getItem('gse_onboarding_sample_course') !== '1') return
    sampleCourseTriedRef.current = true
    localStorage.removeItem('gse_onboarding_sample_course')
    ;(async () => {
      try {
        const sample = await getCachedCourseDB('Pebble Beach Golf Links', 'Pebble Beach, CA')
        if (sample) { applyScorecard(sample); setTab('prep'); setPrepStep(2); return }
      } catch {}
      // No cached sample — still drop the user in Prep Step 1 so they can
      // pick anything. Beats blanking back to My Player after onboarding.
      setTab('prep'); setPrepStep(1)
    })()
  }, [applyScorecard])

  return {
    // Prep flow
    prepStep, setPrepStep,
    courseSearchResetKey,

    // Course state
    course, setCourse,
    coords, setCoords,
    cacheVersion, setCacheVersion,

    // Tee/weather
    teeTime, setTeeTime,
    teeDate, setTeeDate,
    pace, setPace,
    timezone,
    weather, setWeather,
    weatherLoading, setWeatherLoading,

    // Plan state
    planStyle, setPlanStyle,
    planView, setPlanView,
    currentHole, setCurrentHole,
    holeScores, setScore, clearScores,
    copied, setCopied,
    savedBriefs, setSavedBriefs,

    // Derived
    holeTimes, holeWeather,
    parsedHoles,

    // Enrichment
    enriching, enrichStatus, enrichProgress,
    displayGeo, contributedHoleSet,

    // Generation
    plan, setPlan,
    planLoading, planPhase, planError,
    planValidationBanner,
    genProgress,
    lastRecLogId,
    generate, cancelGenerate,

    // Callbacks
    buildPrompt,
    resetPrep,
    applyScorecard,
    handleHoleContribution,
    copyPlan,
    printPlan,
  }
}
