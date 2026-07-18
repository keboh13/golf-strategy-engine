import { useState, useCallback, useEffect, useRef, useMemo, Component } from 'react'
import { supabase, loadUserProfiles, saveUserProfile, deleteUserProfile, loadUserHistory, saveUserHistory, loadUserSettings, saveUserSettings, getCachedCourseDB, setCachedCourseDB, getAllCachedCoursesDB, deleteCachedCourseDB, loadSavedPlans, savePlan, deleteSavedPlan, loadCourseHazards, listCoursePdfs, uploadCoursePdfToBucket, deleteAllCoursePdfs, deleteCourseHazards, clearCachedScorecardPdfRef, listCanonicalCacheKeys, listAliasKeys, loadPrepSession, savePrepSession } from './lib/supabase.js'
import { buildBagSection } from './lib/promptSections.js'
import { buildRecommendationPrompt } from './lib/recommendation/prompt.js'
import { validatePlanContract } from './lib/recommendation/planContract.js'
import { fetchOSMCourseData, enrichHolesWithOSM, exportCourseGeoJSON, classifyTier, computeCoverage } from './lib/osmCourseData.js'
import { computeHoleDistances, formatDistancesLine, simplifyAndTrimGeoJSON } from './lib/courseGeometry.js'
import { getCachedGeo, setCachedGeo } from './lib/courseGeoCache.js'
import { getContrib, saveContrib, mergeContribIntoGeojson } from './lib/holeContributions.js'
import { C, F, card, inp, lbl, btnP, btnG } from './theme.js'
import { useIsMobile, Badge, Spin, SectionHead, InfoBox, computeDataTier } from './components/ui.jsx'
import UserMenu from './components/UserMenu.jsx'
import { computeHoleTimes, getWeatherAtHour, windDir } from './lib/weather.js'
import { fetchHoleDesignViaSearch, mergeDesignDataIntoHoles, searchGolfCourseAPI, normalizeGolfCourseAPICourse, geocodeViaClaudeSearch } from './lib/courseApi.js'
import { ENRICH_STEP_IDS } from './lib/enrichSteps.js'
import { STEP_STATES } from './lib/progress.js'
import { GENERATION_PHASE_IDS, stripPhaseMarkers, stripStreamingArtifacts, findPhaseMarkers } from './lib/generationPhases.js'
import { todayLocalIso } from './lib/localDate.js'
import { planCacheKey, getCachedPlan, putCachedPlan } from './lib/planCache.js'
import { getLatestPostRoundForCourse } from './lib/postRound.js'
import { useProfile } from './lib/useProfile.js'
import { usePwa } from './lib/usePwa.js'
import PwaBanner from './components/PwaBanner.jsx'
import { loadCourseCache, getCachedCourse, setCachedCourse, cacheKey, saveCourseCache, removeCachedCourseByKey, purgeOrphanedLocalEntries } from './lib/courseCache.js'
import { mergeUploadedScorecard, isSameCourseKey } from './lib/scorecardMerge.js'
import AuthScreen from './screens/AuthScreen.jsx'
import AdminCourseEditor from './components/AdminCourseEditor.jsx'
import OnboardingScreen from './screens/OnboardingScreen.jsx'
import HistoryTab from './screens/HistoryTab.jsx'
import PlayerTab from './screens/PlayerTab.jsx'
import SettingsTab from './screens/SettingsTab.jsx'
import PrepTab from './screens/PrepTab.jsx'
import AdminTab from './screens/AdminTab.jsx'
import LibraryTab from './screens/LibraryTab.jsx'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  ENV_MAPS_KEY,
  LS_PLAYER, LS_HISTORY, LS_KEYS, LS_PROFILES, LS_CURRENT_PROFILE, LS_COURSE_CACHE, LS_MODEL,
  AVAILABLE_MODELS,
  DEFAULT_CLUBS, DEFAULT_PLAYER,
  loadProfiles, saveProfiles, loadSavedKeys, saveKeys,
  clubsFromProfile, stripClubs,
} from './lib/appConstants.js'

// ─── Error boundary ───────────────────────────────────────────────────────────
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(e) { return { error: e } }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div style={{ background: '#0f1117', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Inter', sans-serif" }}>
        <div style={{ background: '#16181f', border: '1px solid #3a1515', borderRadius: 12, padding: '2rem 2.5rem', maxWidth: 480, textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
          <h2 style={{ color: '#f87171', fontSize: 18, fontWeight: 600, margin: '0 0 8px' }}>Something went wrong</h2>
          <p style={{ color: '#8b8fa8', fontSize: 13, margin: '0 0 20px' }}>{this.state.error?.message || 'Unexpected error'}</p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => window.location.reload()}
              style={{ background: '#818cf8', color: '#0f1117', border: 'none', borderRadius: 8, padding: '9px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              Reload app
            </button>
            <button onClick={() => { localStorage.clear(); window.location.reload() }}
              style={{ background: 'transparent', color: '#8b8fa8', border: '1px solid #2a2d3a', borderRadius: 8, padding: '9px 20px', fontSize: 13, cursor: 'pointer' }}>
              Clear data &amp; reload
            </button>
          </div>
          <p style={{ color: '#44475a', fontSize: 11, marginTop: 14, marginBottom: 0 }}>
            "Clear data" removes all saved profiles, history, and API keys.
          </p>
        </div>
      </div>
    )
  }
}

// ─── Main App ─────────────────────────────────────────────────────────────────
function AppInner({ user, session, onSignOut, onRunOnboarding }) {
  const isMobile = useIsMobile()
  const { canInstall, isOnline, installApp, dismiss: dismissInstall } = usePwa()
  // ── API keys — loaded from localStorage, falling back to .env ────────────
  const [apiKey,          setApiKeyRaw]       = useState(() => loadSavedKeys().anthropic  || '')
  const [mapsKey,         setMapsKeyRaw]      = useState(() => loadSavedKeys().maps        || ENV_MAPS_KEY)
  const [golfCourseApiKey,setGolfKeyRaw]      = useState(() => loadSavedKeys().golfCourse  || '')

  // Inputs for the keys panel
  const [draftAnthropicKey,  setDraftAnthropicKey]  = useState('')
  const [draftMapsKey,       setDraftMapsKey]       = useState('')
  const [draftGolfKey,       setDraftGolfKey]       = useState('')
  const [keyErrors,          setKeyErrors]          = useState({})

  // ── AI model selection ────────────────────────────────────────────────────
  const [selectedModel, setSelectedModelRaw] = useState(() => localStorage.getItem(LS_MODEL) || 'claude-sonnet-4-6')
  const setSelectedModel = (m) => { setSelectedModelRaw(m); localStorage.setItem(LS_MODEL, m) }

  // ── Account management state ──────────────────────────────────────────────
  const [acctSection,     setAcctSection]     = useState(null)  // null | 'password' | 'email' | 'delete'
  const [acctNewPass,     setAcctNewPass]     = useState('')
  const [acctConfirmPass, setAcctConfirmPass] = useState('')
  const [acctNewEmail,    setAcctNewEmail]    = useState('')
  const [acctMsg,         setAcctMsg]         = useState(null)  // { type: 'ok'|'err', text }
  const [acctLoading,     setAcctLoading]     = useState(false)

  // ── Prep flow step ───────────────────────────────────────────────────────
  const [prepStep, setPrepStep] = useState(1)

  // ── Admin state ───────────────────────────────────────────────────────────
  const [isAdmin, setIsAdmin] = useState(null)  // null = unknown (not yet checked)

  // ── Admin course metadata editor ─────────────────────────────────────────
  const [editorCourse, setEditorCourse] = useState(null)  // course object being edited (null = closed)

  // Persist all keys together whenever any changes
  const setApiKey = (v) => { setApiKeyRaw(v);       saveKeys({ ...loadSavedKeys(), anthropic:  v }) }
  const setMapsKey = (v) => { setMapsKeyRaw(v);     saveKeys({ ...loadSavedKeys(), maps:        v }) }
  const setGolfKey = (v) => { setGolfKeyRaw(v);     saveKeys({ ...loadSavedKeys(), golfCourse:  v }) }

  const [tab, setTab] = useState(() => {
    const p = new URLSearchParams(window.location.search).get('tab')
    return ['player','prep','history','settings','admin','library'].includes(p) ? p : 'player'
  })

  // Player profile — persisted to localStorage across sessions (clubs live alongside in the
  // saved blob but are kept in their own state, so playerInfo's shape stays unchanged)
  const [playerInfo, setPlayerInfo] = useState(() => {
    try { return stripClubs(JSON.parse(localStorage.getItem(LS_PLAYER))) || DEFAULT_PLAYER } catch { return DEFAULT_PLAYER }
  })

  // Multi-profile support (Part 4 step 6 of the optimization plan). The hook
  // owns the active profile name + list + Supabase round-trips; AppInner
  // reacts to activeProfileData changes the same way it used to react to the
  // load effect's single dbProfiles['Default'] read.
  const {
    currentProfile,
    profileNames,
    activeProfileData,
    setCurrentProfile,
    createProfile,
    cacheActiveProfileData,
  } = useProfile({ user })

  // Active org + org list — persisted to user_settings.active_org_id on change
  const [activeOrgId, setActiveOrgId] = useState(null)
  const [userOrgs,    setUserOrgs]    = useState([])
  useEffect(() => {
    if (!user?.id || !session?.access_token) return
    // Load persisted active org from user_settings
    loadUserSettings(user.id).then(s => { if (s.active_org_id) setActiveOrgId(s.active_org_id) }).catch(() => {})
    // Load org list for the switcher
    fetch('/api/orgs', { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(r => r.ok ? r.json() : [])
      .then(setUserOrgs)
      .catch(() => {})
  }, [user?.id, session?.access_token])

  const handleOrgChange = (orgId) => {
    setActiveOrgId(orgId)
    if (user?.id) {
      saveUserSettings(user.id, { active_org_id: orgId }).catch(() => {})
    }
  }

  // Club distances — persisted with the player profile (localStorage + Supabase)
  const [clubs, setClubs] = useState(() => {
    try { return clubsFromProfile(JSON.parse(localStorage.getItem(LS_PLAYER))) } catch { return DEFAULT_CLUBS }
  })
  const [expandedClubs, setExpandedClubs] = useState({})

  // Scoring history — persisted to localStorage
  const [scoringHistory, setScoringHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem(LS_HISTORY)) || [] } catch { return [] }
  })

  // Course — session-only
  const [course, setCourse] = useState({
    name: '', location: '', yardage: '', rating: '', slope: '', par: 72,
    conditions: 'Normal', roundType: 'Stroke play tournament',
    targetScore: '', notes: '', source: '', elevation: '',
    holes: Array.from({ length: 18 }, (_, i) => ({
      par:      [4,4,3,5,4,3,4,5,4,4,3,4,5,4,3,4,4,5][i] || 4,
      yardage:  '',
      handicap: i + 1,
      notes:    '',
      elevation: '',
    })),
  })

  // Tee time & weather
  const [teeTime,  setTeeTime]  = useState('10:00')
  const [teeDate,  setTeeDate]  = useState(() => todayLocalIso())
  const [pace,     setPace]     = useState(11)
  const [timezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone)
  const [weather,        setWeather]        = useState(null)
  const [weatherLoading, setWeatherLoading] = useState(false)
  const [coords,         setCoords]         = useState(null)
  const [cacheVersion,   setCacheVersion]   = useState(0)

  // Enrichment loading state. `enriching` is the legacy boolean kept for the
  // existing render sites; `enrichProgress` is the structured state consumed
  // by the new ProgressTracker (Part 0.2 + 0.3 of the optimization plan).
  const [enriching,      setEnriching]      = useState(false)
  const [enrichStatus,   setEnrichStatus]   = useState('')
  const [enrichProgress, setEnrichProgress] = useState({ states: {}, startsAt: {}, endsAt: {}, errors: {} })

  // Game plan
  const [plan,        setPlan]        = useState('')
  const [planLoading, setPlanLoading] = useState(false)
  const [planPhase,   setPlanPhase]   = useState('')
  const [planError,   setPlanError]   = useState('')
  const [planValidationBanner, setPlanValidationBanner] = useState('')
  // Structured generation progress driven by [[PHASE: id]] markers in the
  // streamed response (Part 0.2 + 0.3 of the optimization plan). Replaces the
  // brittle heading-substring detection that used to set `planPhase`.
  const [genProgress, setGenProgress] = useState({ states: {}, startsAt: {}, endsAt: {}, errors: {} })
  const [planStyle,   setPlanStyle]   = useState('balanced')  // 'balanced' | 'conservative' | 'aggressive'
  const abortRef = useRef(null)
  const [planView,    setPlanView]    = useState('companion')
  const [currentHole, setCurrentHole] = useState(0)
  const [copied,      setCopied]      = useState(false)
  const [savedBriefs, setSavedBriefs] = useState(() => {
    try { return JSON.parse(localStorage.getItem('golf_saved_briefs') || '[]') } catch { return [] }
  })
  const [holeScores,  setHoleScores]  = useState({})
  const [expandedBrief, setExpandedBrief] = useState(null)
  // Rec-log id of the most recently generated brief. Surfaced to the Prep
  // tab so the in-flow BriefRating widget can save a rating without waiting
  // for the user to go to History.
  const [lastRecLogId, setLastRecLogId] = useState(null)

  const setScore = (holeNum, val) => setHoleScores(s => ({ ...s, [holeNum]: Math.max(1, val) }))
  const clearScores = () => setHoleScores({})

  // History course-lookup state: { [roundIndex]: { query, results, loading, error } }
  const [historySearch, setHistorySearch] = useState({})
  const updateHS = (i, patch) => setHistorySearch(prev => ({ ...prev, [i]: { ...prev[i], ...patch } }))

  const historySearchCourse = async (i, query) => {
    if (!query.trim()) return
    updateHS(i, { loading: true, error: '', results: [] })
    try {
      const authToken = session?.access_token || ''
      const courses = await searchGolfCourseAPI(query, authToken)
      if (courses.length > 0) { updateHS(i, { results: courses, loading: false }); return }
    } catch {}
    updateHS(i, { loading: false, error: 'No results. Try a more specific name.' })
  }

  const attachCourseToRound = async (roundIdx, courseStub) => {
    updateHS(roundIdx, { loading: true, results: [] })
    try {
      const normalized = normalizeGolfCourseAPICourse(courseStub)
      setScoringHistory(h => h.map((rr, j) => j === roundIdx ? {
        ...rr,
        course:      normalized.name,
        location:    normalized.location || rr.location,
        courseData:  normalized,
      } : rr))
      updateHS(roundIdx, { loading: false, open: false, query: '' })
    } catch (e) {
      updateHS(roundIdx, { loading: false, error: e.message })
    }
  }

  // ── Persistence ──────────────────────────────────────────────────────────
  // Guard: suppress save-back while Supabase load is in progress
  const [dbLoaded, setDbLoaded] = useState(false)

  // Load user data from Supabase on mount (when authenticated). Profile data
  // is now owned by useProfile() — we just consume `activeProfileData` from
  // the hook. History, saved plans, and the GolfCourseAPI key still load here.
  useEffect(() => {
    if (!user) return
    setDbLoaded(false)
    ;(async () => {
      try {
        const dbHistory = await loadUserHistory(user.id)
        if (dbHistory.length > 0) setScoringHistory(dbHistory)
        const settings = await loadUserSettings(user.id)
        if (settings.golf_course_api_key) setGolfKeyRaw(settings.golf_course_api_key)
        const plans = await loadSavedPlans(user.id)
        if (plans.length > 0) setSavedBriefs(plans)
      } catch (e) {
        console.warn('[supabase] load error:', e.message)
      } finally {
        setDbLoaded(true)
      }
    })()
  }, [user?.id])

  // Mirror the active profile from the hook into playerInfo + clubs whenever
  // either the user switches profiles or the first DB round-trip completes.
  // No-op when the hook is still warming up (activeProfileData === null) so
  // we don't blank the screen.
  useEffect(() => {
    if (!activeProfileData) return
    setPlayerInfo(stripClubs(activeProfileData))
    setClubs(clubsFromProfile(activeProfileData))
  }, [activeProfileData])

  useEffect(() => {
    const profileData = { ...playerInfo, clubs }
    localStorage.setItem(LS_PLAYER, JSON.stringify(profileData))
    // Keep the hook's in-memory profile cache in sync so a profile-switch
    // doesn't reload stale data from Supabase.
    cacheActiveProfileData(profileData)
    if (user && dbLoaded) {
      const timer = setTimeout(() => {
        saveUserProfile(user.id, currentProfile, profileData).catch(e => console.warn('[supabase] profile save:', e.message))
      }, 1200)
      return () => clearTimeout(timer)
    }
  }, [playerInfo, clubs, dbLoaded, currentProfile])
  useEffect(() => {
    localStorage.setItem(LS_HISTORY, JSON.stringify(scoringHistory))
    if (user && dbLoaded) {
      const timer = setTimeout(() => {
        saveUserHistory(user.id, scoringHistory).catch(e => console.warn('[supabase] history save:', e.message))
      }, 1500)
      return () => clearTimeout(timer)
    }
  }, [scoringHistory, dbLoaded])

  // Check admin status as soon as we have a session (Part 4 step 9 of the
  // optimization plan — the dedicated 🛡️ Admin top-level tab needs to know
  // at boot whether to render itself, not on first Settings click).
  useEffect(() => {
    if (isAdmin !== null) return
    const authToken = session?.access_token || ''
    if (!authToken) { setIsAdmin(false); return }
    fetch('/api/check-admin', { headers: { Authorization: `Bearer ${authToken}` } })
      .then(r => r.json())
      .then(d => setIsAdmin(!!d.isAdmin))
      .catch(() => setIsAdmin(false))
  }, [isAdmin, session])

  // Boot-time purge of orphaned localStorage course entries. Any cached entry
  // whose key no longer exists in course_cache (and isn't aliased) is dead —
  // an admin renamed or deleted the course on the shared DB. Runs once per
  // sign-in so users see canonical names in search after a rename.
  useEffect(() => {
    if (!session?.user?.id) return
    let cancelled = false
    ;(async () => {
      try {
        const [keys, aliases] = await Promise.all([listCanonicalCacheKeys(), listAliasKeys()])
        if (cancelled || !keys) return
        const removed = purgeOrphanedLocalEntries(keys, aliases || [])
        if (removed) console.log(`[course cache] purged ${removed} orphaned local entr${removed === 1 ? 'y' : 'ies'}`)
      } catch {}
    })()
    return () => { cancelled = true }
  }, [session?.user?.id])

  const holeTimes   = computeHoleTimes(teeTime, pace)
  const holeWeather = holeTimes.map(dt => weather ? getWeatherAtHour(weather, dt) : null)

  const resetPrep = useCallback(() => {
    setCourse({
      name: '', location: '', yardage: '', rating: '', slope: '', par: 72,
      conditions: 'Normal', roundType: 'Stroke play tournament',
      targetScore: '', notes: '', source: '', elevation: '',
      holes: Array.from({ length: 18 }, (_, i) => ({
        par:      [4,4,3,5,4,3,4,5,4,4,3,4,5,4,3,4,4,5][i] || 4,
        yardage:  '',
        handicap: i + 1,
        notes:    '',
        elevation: '',
      })),
    })
    setPlan('')
    setPlanError('')
    setPlanPhase('')
    setWeather(null)
    setCoords(null)
    setCurrentHole(0)
    setHoleScores({})
    setPrepStep(1)
  }, [])

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
  // tee time, pace, plan style, and which step they were on. The full course
  // record is reloaded via getCachedCourseDB so we don't have to store the
  // whole holes/geo blob in prep_sessions.
  const prepRestoreRef = useRef(false)
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

  // Auto-geocode at pick-time so OSM enrichment can start without waiting for
  // the user to reach the Weather step. Part 0.2 of the optimization plan —
  // shaves the geocode round-trip off the perceived enrichment latency for
  // every Tier-3-feeling course whose scorecard came without coords.
  const geocodeRef = useRef(null)
  useEffect(() => {
    if (!course.name || coords?.lat || coords?.lng) return
    const authToken = session?.access_token || ''
    if (!authToken) return
    // Don't re-fire for the same (name, location) — Claude geocoding costs
    // tokens and the user may have already declined a result.
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
  }, [course.name, course.location, coords?.lat, coords?.lng, session])

  // Enrich course with OSM/web design data (parallelized with retry + UI feedback)
  const enrichLoadIdRef = useRef(0)
  // Helper: record per-step state for the ProgressTracker. Pure-ish — only
  // affects enrichProgress; the rest of the enrichment effect stays unchanged.
  const markStep = useCallback((id, state, patch = {}) => {
    setEnrichProgress(prev => ({
      states:   { ...prev.states,   [id]: state },
      startsAt: patch.startedAt != null ? { ...prev.startsAt, [id]: patch.startedAt } : prev.startsAt,
      endsAt:   patch.endedAt   != null ? { ...prev.endsAt,   [id]: patch.endedAt }   : prev.endsAt,
      errors:   patch.error     != null ? { ...prev.errors,   [id]: patch.error }     : prev.errors,
    }))
  }, [])

  useEffect(() => {
    if (!course.name || !coords?.lat || !coords?.lng || course.osmEnriched) return
    const myId = ++enrichLoadIdRef.current
    const ctrl = new AbortController()
    setEnriching(true)
    setEnrichStatus('Loading course design data...')
    // Reset the tracker. Whatever happened on the prior course is no longer
    // interesting; the geocode step is marked DONE here because by the time
    // this effect fires we already have coords (either supplied or geocoded).
    setEnrichProgress({
      states:   { [ENRICH_STEP_IDS.GEOCODE]: STEP_STATES.DONE },
      startsAt: {},
      endsAt:   {},
      errors:   {},
    })
    ;(async () => {
      let osmWorked = false

      // Phase 1: OSM enrichment + geometry export (Tier 1/2/3 classifier)
      setEnrichStatus('Fetching hazard data from OpenStreetMap...')
      markStep(ENRICH_STEP_IDS.OSM, STEP_STATES.RUNNING, { startedAt: Date.now() })
      // Cached geometry first — avoid a second Overpass hit on the same course.
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
            // Phase 6 polish: simplify polygons + trim coords before stashing
            // and persisting. Distances/classifier/coverage all read the
            // simplified version so what we compute matches what we render.
            const geojson = simplifyAndTrimGeoJSON(rawGeojson)
            geojson.bboxByHole = rawGeojson.bboxByHole
            const tier = classifyTier(geojson, course.holes)
            const coverage = computeCoverage(geojson, course.holes)
            const bboxByHole = geojson.bboxByHole

            // Compute verified distances per hole (Tier 1 holes get tee→pin,
            // front/center/back of green, and carry-to-hazard from the tee).
            const distancesByRef = {}
            for (const h of enrichedHoles) {
              const ref = course.holes.indexOf(h) + 1 // enrichedHoles preserves order
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
              // Write-through: persist the enriched course shape to Supabase
              // so the next client (or session) hits this row instantly rather
              // than re-running the OSM ladder. Part 0.2 of the optimization
              // plan. Fire-and-forget; local cache already succeeded.
              setCachedCourseDB(updated).catch(() => {})
              return updated
            })
            // Persist geometry separately (course_cache stores the AI-facing
            // course shape; course_geo stores the rendering geometry).
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
                // Write-through to Supabase so the next user skips this
                // 5–6 s Claude call entirely. Part 0.2.
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

      // Phase 3: User-contributed hole pins. We always try this — it's the
      // only data source for many Tier 3 courses, and a cheap LS/Supabase
      // lookup. Contributions flow into the rendered geojson via the memo
      // below; nothing else needs to know about them.
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

      // Phase 4: Per-hole hazard intelligence (yardage-book vision pass).
      // Cheap structured lookup — vision was paid once per course upstream.
      markStep(ENRICH_STEP_IDS.HAZARDS, STEP_STATES.RUNNING, { startedAt: Date.now() })
      try {
        const hazardsByRef = await loadCourseHazards(course.name, course.location)
        if (myId === enrichLoadIdRef.current && hazardsByRef && Object.keys(hazardsByRef).length) {
          setCourse(prev => ({
            ...prev,
            holes: prev.holes.map((h, i) => {
              const hz = hazardsByRef[i + 1]
              return hz ? { ...h, hzDesign: hz } : h
            }),
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
  }, [course.name, coords?.lat, coords?.lng, course.osmEnriched, session])

  // Memoized: merge OSM geojson + user contributions for rendering. We never
  // mutate course.geojson with contributions (keeps the persisted OSM cache
  // honest) — instead the map consumes this derived value.
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

  // ── New recommendation prompt builder ─────────────────────────────────
  // Delegates to src/lib/recommendation/prompt.js — pure module, snapshot-
  // tested, pre-computes wind/elevation/dispersion math so the LLM doesn't
  // have to guess at it. Original buildPrompt kept below as buildPromptLegacy
  // for fallback comparison (unused).
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

  // Legacy inline builder — preserved (unused) for diffing against the new
  // module-based path during rollout. Safe to delete after a few releases.
  // eslint-disable-next-line no-unused-vars
  const buildPromptLegacy = useCallback(() => {
    // ── Shared: club list ──
    const clubList = buildBagSection(clubs)

    // ── Shared: history analytics block ──
    const validRounds = scoringHistory.filter(r => r.course && r.score)
    let historyBlock = ''
    if (validRounds.length > 0) {
      const toNum = r => r.toPar === 'E' ? 0 : parseFloat(r.toPar)
      const tournament = validRounds.filter(r => r.roundType === 'Tournament' || r.roundType === 'Qualifier')
      const casual     = validRounds.filter(r => r.roundType === 'Casual' || r.roundType === 'Practice round')
      const avgOf = arr => arr.length ? (arr.reduce((a,b)=>a+b,0)/arr.length).toFixed(1) : null
      const allNums = validRounds.map(toNum).filter(n => !isNaN(n))
      const tourNums = tournament.map(toNum).filter(n => !isNaN(n))
      const casNums  = casual.map(toNum).filter(n => !isNaN(n))

      // Par type averages
      const byPar = (par) => {
        const holes = validRounds.flatMap(r => (r.holes || []).filter(h => h.par === par && h.score))
        if (!holes.length) return null
        return (holes.reduce((a,h) => a + (h.score - h.par), 0) / holes.length).toFixed(2)
      }
      const p3avg = byPar(3), p4avg = byPar(4), p5avg = byPar(5)

      // Front/back pattern
      const frontAvg = avgOf(validRounds.flatMap(r => {
        if (!r.holes) return []
        const front = r.holes.slice(0,9).filter(h=>h.score&&h.par)
        return front.length===9 ? [front.reduce((a,h)=>a+(h.score-h.par),0)] : []
      }))
      const backAvg = avgOf(validRounds.flatMap(r => {
        if (!r.holes) return []
        const back = r.holes.slice(9).filter(h=>h.score&&h.par)
        return back.length===9 ? [back.reduce((a,h)=>a+(h.score-h.par),0)] : []
      }))

      const fmt = n => n === 0 ? 'E' : n > 0 ? `+${n}` : String(n)
      const fmtF = n => n == null ? null : parseFloat(n) === 0 ? 'E' : parseFloat(n) > 0 ? `+${n}` : String(n)

      historyBlock = '\n\nSCORING HISTORY ANALYSIS:\n'
      if (allNums.length) historyBlock += `Overall avg: ${fmtF(avgOf(allNums))} (${allNums.length} rounds)\n`
      if (tourNums.length) historyBlock += `Tournament avg: ${fmtF(avgOf(tourNums))} (${tourNums.length} rounds)\n`
      if (casNums.length)  historyBlock += `Casual avg: ${fmtF(avgOf(casNums))} (${casNums.length} rounds)\n`
      if (p3avg) historyBlock += `Par 3 avg: ${fmtF(p3avg)} vs par\n`
      if (p4avg) historyBlock += `Par 4 avg: ${fmtF(p4avg)} vs par\n`
      if (p5avg) historyBlock += `Par 5 avg: ${fmtF(p5avg)} vs par\n`
      if (frontAvg && backAvg) historyBlock += `Front 9 avg: ${fmtF(frontAvg)} | Back 9 avg: ${fmtF(backAvg)} vs par\n`

      historyBlock += '\nRecent rounds:\n'
      historyBlock += validRounds.map(r => {
        let line = `${r.date ? r.date + ' — ' : ''}${r.course}${r.location ? ' (' + r.location + ')' : ''}: ${r.score}${r.toPar ? ' (' + r.toPar + ')' : ''}${r.roundType ? ' [' + r.roundType + ']' : ''}${r.conditions ? ', ' + r.conditions : ''}${r.notes ? ' | ' + r.notes : ''}`
        if (r.courseData?.holes) {
          const holeStr = r.courseData.holes.map((h, i) =>
            `H${i+1}(Par${h.par}${h.yardage ? ','+h.yardage+'y' : ''}${h.handicap ? ',HCP'+h.handicap : ''})`
          ).join(' ')
          line += `\n  Scorecard: ${holeStr}`
          if (r.courseData.rating) line += ` | Rating ${r.courseData.rating} / Slope ${r.courseData.slope}`
        }
        return line
      }).join('\n')
      historyBlock += '\n\nKey instruction: use tournament vs casual split to assess pressure performance. Use par-type averages to identify leaking patterns. Where scorecard data is available for a past round, reference specific hole characteristics to identify patterns (e.g. struggles on long par 4s, leaks on dog-legs). Weight most recent rounds highest.'
    }

    // ── Course Handicap calculation ──
    const handicapIndex = parseFloat(playerInfo.handicap) || 0
    const slopeVal = parseFloat(course.slope) || 113
    const ratingVal = parseFloat(course.rating) || 72
    const coursePar = course.par || 72
    const courseHandicap = Math.round(handicapIndex * (slopeVal / 113) + (ratingVal - coursePar))
    const isLefty = (playerInfo.handedness || 'Right') === 'Left'
    const handLabel = isLefty ? 'LEFT-HANDED' : 'RIGHT-HANDED'

    // ── Player profile block (cache-friendly prefix) ──
    const playerBlock = `PLAYER: ${playerInfo.name || 'Player'}, ${handLabel} golfer
Handicap Index: ${playerInfo.handicap} (USGA/GHIN — portable number, NOT strokes given)${course.name ? `\nCourse Handicap: ${courseHandicap} (Index × Slope÷113 + Rating−Par)` : ''}
Miss tendency: ${playerInfo.miss} | Ball flight: ${playerInfo.ballFlight}
${playerInfo.swingNotes ? `Swing notes: ${playerInfo.swingNotes}` : ''}
${playerInfo.goals ? `Goals: ${playerInfo.goals}` : ''}
${playerInfo.strengths ? `Strengths: ${playerInfo.strengths}` : ''}

CRITICAL — HANDEDNESS: This player is ${handLabel}. All shot shape references MUST account for this:
${isLefty
  ? `• A FADE for a lefty curves LEFT (away from target on right-to-left holes)\n• A DRAW for a lefty curves RIGHT (toward the target on right-to-left holes)\n• "Working the ball left" = the natural fade shape for this lefty\n• "Working the ball right" = a draw for this lefty`
  : `• A FADE for a righty curves RIGHT\n• A DRAW for a righty curves LEFT\n• Standard right-handed shot shape references apply`}
When recommending shot shapes, ALWAYS specify what the ball will do in the air relative to the fairway/target (e.g. "draw — ball will move right to left for you" for a righty, or "draw — ball will move left to right for you" for a lefty). DO NOT default to only recommending fades/cuts — use draws, fades, and straight shots based on the hole shape and player's bag.

BAG (carry distances):
${clubList}`

    // ── Profile-only mode (no course loaded) ──
    if (!course.name) {
      return `You are an elite Tour caddy. The player has no course loaded — give a profile-only brief.

${playerBlock}
${historyBlock}

## Current form
Where the game is now. Use actual numbers.

## Where shots are leaking
2-3 sources of dropped shots from par-type averages and tendencies.

## Pattern to watch
Front/back splits, pressure patterns, recent trends.

## Focus areas for next round
2-3 specific actionable points tied to actual data.

## Pre-shot questions
3-4 strategic questions for this player's tendencies.

Be direct. Short sentences. No filler.`
    }

    // ── Course-loaded mode: full pre-round brief ──
    const isPractice = course.roundType === 'Practice round'
    const isMatchPlay = course.roundType === 'Match play'
    const hasOSMData = course.osmEnriched && course.holes.some(h => h.osmDesign)
    const hasWebDesign = course.holes.some(h => h.webDesign)
    const hasHazardData = course.holes.some(h => h.hzDesign)
    const designNote = [
      hasOSMData ? 'OSM' : null,
      hasWebDesign ? 'web' : null,
      hasHazardData ? 'yardage-book vision' : null,
    ].filter(Boolean).length
      ? ' + design data (' + [hasOSMData && 'OSM', hasWebDesign && 'web', hasHazardData && 'yardage-book vision'].filter(Boolean).join(' + ') + ')'
      : ''
    const sourceNote = course.source === 'GolfCourseAPI' ? `Verified — GolfCourseAPI${designNote}`
      : course.source === 'OpenGolfAPI'    ? `Partial — OpenGolfAPI (par/HCP only, yardages from web)${designNote}`
      : course.source                      ? `Unverified — via web search (${course.source}).${designNote}`
      : 'Manual entry'
    const holesData = course.holes.map((h, i) => {
      const w    = holeWeather[i]
      const time = holeTimes[i]?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      const wStr = w ? ` | ~${time}: ${Math.round(w.temp)}°F, ${windDir(w.windDir)} ${Math.round(w.windSpeed)}mph, ${w.precip}% rain` : ''
      const eStr = h.elevation ? ` | Elev: ${h.elevation}` : ''

      // Build design data string from OSM, web search, or user notes
      let designStr = ''
      if (h.osmDesign) {
        const parts = []
        if (h.osmDesign.dogleg) parts.push(`dogleg ${h.osmDesign.dogleg}`)
        if (h.osmDesign.bearingDeg != null) parts.push(`bearing ${h.osmDesign.bearingDeg}°`)
        if (h.osmDesign.hazards?.length) {
          parts.push('hazards: ' + h.osmDesign.hazards.map(hz => `${hz.type} ${hz.loc}`).join(', '))
        }
        if (h.osmDesign.greenWidth) parts.push(`green ~${h.osmDesign.greenWidth}y wide × ${h.osmDesign.greenDepth}y deep`)
        if (h.osmDesign.distances) {
          const d = h.osmDesign.distances
          parts.push(`tee→pin ${d.teeToPin}y`)
          const distLine = formatDistancesLine(d)
          if (distLine) parts.push(distLine)
        }
        if (parts.length) designStr = ` | Design (OSM verified): ${parts.join('; ')}`
      } else if (h.webDesign) {
        const parts = []
        if (h.webDesign.dogleg && h.webDesign.dogleg !== 'straight') parts.push(`dogleg ${h.webDesign.dogleg}`)
        if (h.webDesign.water) parts.push(`water: ${h.webDesign.water}`)
        if (h.webDesign.bunkers) parts.push(`bunkers: ${h.webDesign.bunkers}`)
        if (h.webDesign.ob) parts.push(`OB ${h.webDesign.ob}`)
        if (h.webDesign.green_notes) parts.push(`green: ${h.webDesign.green_notes}`)
        if (parts.length) designStr = ` | Design (web search — use with moderate confidence): ${parts.join('; ')}`
      }

      // Yardage-book vision hazards: structured per-hole, treat as verified-by-image.
      let yardageBookText = ''
      if (h.hzDesign) {
        const hz = h.hzDesign
        const parts = []
        if (hz.dogleg && hz.dogleg !== 'straight') parts.push(`dogleg ${hz.dogleg}`)
        if (Array.isArray(hz.hazards) && hz.hazards.length) {
          parts.push('hazards: ' + hz.hazards.map(z => {
            const carry = z.carry_yards ? ` carry ${z.carry_yards}y` : ''
            const note = z.notes ? ` (${z.notes})` : ''
            return `${z.type} ${z.side}${carry}${note}`
          }).join(', '))
        }
        if (hz.greenDepth) parts.push(`green depth ${hz.greenDepth}y`)
        if (hz.green_notes) parts.push(`green: ${hz.green_notes}`)
        if (hz.recommended_line) parts.push(`line: ${hz.recommended_line}`)
        if (parts.length) {
          const confLabel = hz._confidence === 'high' ? 'high confidence' : hz._confidence === 'low' ? 'low confidence' : 'verified-by-image'
          designStr += ` | Design (yardage book — ${confLabel}): ${parts.join('; ')}`
        }
        // Caddie nickname + verbatim description from the printed yardage book.
        // These reflect the architect's intent; lean on them when shaping shot calls.
        if (hz.holeName) yardageBookText += ` | "${hz.holeName}"`
        if (hz.description) yardageBookText += `\n   Book: ${hz.description}`
        // Visual observations from the hole diagram — caddie-eye reading of
        // the picture (fairway shape, green orientation, distance markers).
        if (hz.visualNotes) yardageBookText += `\n   Diagram: ${hz.visualNotes}`
        if (Array.isArray(hz.distanceMarkers) && hz.distanceMarkers.length) {
          yardageBookText += `\n   Distances: ${hz.distanceMarkers.map(d => `${d.label} ${d.yards}y`).join('; ')}`
        }
      }
      const nStr = h.notes ? ` | Note: ${h.notes}` : (!designStr ? ' | Note: no design data — do not assume hazards' : '')
      return `H${i+1}: Par ${h.par}, ${h.yardage || '?'}y, HCP ${h.handicap}${eStr}${designStr}${nStr}${wStr}${yardageBookText}`
    }).join('\n')

    return `You are an elite Tour caddy. Generate a concise game plan. IMPORTANT: You MUST cover ALL 18 holes — do not stop early.

${playerBlock}

COURSE: ${course.name}${course.selectedTee ? ` (${course.selectedTee} tees)` : ''}, ${course.yardage}y, Rating ${course.rating} / Slope ${course.slope}, Par ${course.par}
Course Handicap: ${courseHandicap} | Data: ${sourceNote}
${course.roundType} | Target: ${course.targetScore || 'under par'} | Conditions: ${course.conditions}
${course.elevation ? `Course elevation: ${course.elevation}ft — factor into club selection (higher altitude = more carry)` : ''}
${course.architect ? `Architect: ${course.architect}` : ''}
${course.greensType ? `Greens: ${course.greensType}` : ''}
${course.region ? `Region: ${course.region}` : ''}
${Array.isArray(course.tags) && course.tags.length ? `Style tags: ${course.tags.join(', ')}` : ''}
${course.defaultConditions && !course.conditions ? `Typical conditions: ${course.defaultConditions}` : ''}
${isPractice ? 'Practice round — frame around learning, not score.' : ''}${isMatchPlay ? 'Match play — adjust risk for hole-by-hole context.' : ''}
${course.notes ? `Notes: ${course.notes}` : ''}
Tee: ${teeTime} (${teeDate}), ${pace} min/hole
${historyBlock}

HOLES:
${holesData}

IMPORTANT RULES:
1. Cover ALL 18 holes. Do not stop at hole 11 or 12.
2. Recommend draws AND fades AND straight shots — match shape to hole, not just one shape.
3. Remember this is a ${handLabel} player — shot shapes curve differently.
4. Keep caddy notes SHORT (1 sentence max, like a real caddy would say it, not AI-sounding).
5. Be concise throughout — every word should earn its place.

DATA ACCURACY — CRITICAL:
${hasOSMData || hasWebDesign || hasHazardData
  ? `Some holes have design data from ${[
      hasOSMData ? 'OpenStreetMap (marked "Design (OSM verified)")' : null,
      hasWebDesign ? 'web search (marked "Design (web search)")' : null,
      hasHazardData ? 'the course yardage book parsed by vision (marked "Design (yardage book)")' : null,
    ].filter(Boolean).join(', ')}. OSM data and yardage-book data are treated as verified (the yardage-book hazards came from the official course diagram). Web search data is moderately reliable — use it but don't over-rely on specific details. For holes WITHOUT any design data, follow the strict rules below.`
  : `You only have scorecard data (par, yardage, handicap) for each hole. You do NOT have verified hole design data (hazard locations, water, OB, doglegs, fairway shape, green surrounds).`}
Follow these rules strictly:
- Do NOT invent or guess specific hazard placements (bunkers, water, OB) unless explicitly provided in a hole's data (via "Design (OSM verified)", "Design (web search)", or a user "Note:"). If none exist — do NOT fabricate hazards.
- Do NOT recommend shot shapes to "avoid" hazards you are not certain exist. Base tee shot shape recommendations on: the player's ball flight and miss tendency, the par/yardage, and wind — NOT on assumed hole layouts.
- For green-json: set "hazards" to an EMPTY array [] unless a hole's design data or note explicitly describes a specific hazard near the green. Do NOT guess bunker or water locations.
- For green-json: when a hole has "Design (OSM verified)" or "Design (yardage book)" data, use those hazards with "confidence":"verified". When a hole has "Design (web search)" data, use with "confidence":"uncertain". When a hole has NO design data, set "hazards":[] and use generic values.
- For tee shot strategy: when a hole has design data including dogleg direction, use that to inform shot shape. When a hole has bearing data, factor in wind direction vs hole bearing. Otherwise, recommend shape based on the player's natural ball flight and miss tendency — do NOT fabricate doglegs or fairway shapes.
- When a hole's "Design (OSM verified)" data includes specific distances (e.g. "tee→pin 425y", "green 142/158/168y (F/C/B)", "carry Bunker R 235y"), use those exact numbers when discussing carry distances, club choices, and lay-up targets. They are surveyed from OSM and accurate within ~±5 yards. Do NOT round them to "about 240" — say "235y carry over the right fairway bunker" and pick the club that matches. Carry distances are measured FROM THE TEE along the centerline.
- When in doubt, say "standard approach" rather than inventing hazards to avoid.
- When a hole has a "Book:" line, that's the verbatim yardage-book description written by the course/architect. Treat it as authoritative caddie context — the strategy hints there (where to land, what to avoid, ideal line) reflect the architect's intent. Lean on it when shaping shot calls, but DON'T quote it verbatim back in your output — translate it into a player-facing caddie line.
- When a hole has a "Diagram:" line, that's a caddie-eye reading of the hole's overhead picture from the yardage book — treat the observations (fairway pinches, green shape/angle, elevation cues) as verified-by-image. Combine with "Book:" prose and "Distances:" numbers to pick a landing zone and club. Distance markers from the diagram are typically accurate within ±5y.

## Round strategy
2-3 sentences. Approach for today.

## Scoring roadmap
One line per hole: "H[N] Par [X] [Yds]y — 🟢/🟡/🔴 — reason"

## Hole-by-hole
### Hole [N] — Par [X] — [Yds]y — HCP [N]
- **Tee**: Club, target, shape (specify ball flight direction for this ${isLefty ? 'lefty' : 'righty'})
- **Approach**: Club, distance, landing zone
- **Caddy**: One short sentence. Sound like a human, not a manual.
\`\`\`green-json
{"depth_y":28,"width_y":24,"shape":"oval","pin":"center","slope":"flat","tiers":0,"tier_desc":"","green_notes":"","confidence":"uncertain","hazards":[]}
\`\`\`
Green-json rules: "hazards" must be [] unless a hole note explicitly mentions a hazard near the green. "confidence" must be "uncertain" unless you have high-confidence verified knowledge of this specific green. Only populate non-default values (shape, slope, tiers, pin, green_notes) when you have specific data — do NOT guess.

## Weather
Club adjustments for key holes only.

## Pressure
${historyBlock ? 'Use tournament vs casual data. ' : ''}Pre-shot anchor. How to handle bogeys.

Be direct. No filler. ALL 18 HOLES.`
  }, [clubs, course, playerInfo, holeWeather, holeTimes, teeTime, teeDate, pace, scoringHistory])

  const cancelGenerate = () => {
    if (abortRef.current) { abortRef.current.abort(); abortRef.current = null }
    setPlanLoading(false); setPlanPhase('')
  }

  const generate = async (options = {}) => {
    const { bypassCache = false } = options
    const authToken = session?.access_token || ''
    if (!authToken) { setPlanError('Please sign in to generate a game plan.'); return }
    if (abortRef.current) abortRef.current.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setPlanLoading(true); setPlanPhase('Analyzing scoring history'); setPlanError(''); setPlanValidationBanner(''); setPlan(''); setLastRecLogId(null); setTab('prep'); setPrepStep(4)
    let capturedRecLogId = null
    // Reset + start the generation tracker. The implicit 'strategy' phase is
    // running from the first byte; markers advance the machine from there.
    const genStartedAt = Date.now()
    const seenPhases = new Set()
    setGenProgress({
      states:   { strategy: STEP_STATES.RUNNING },
      startsAt: { strategy: genStartedAt },
      endsAt:   {},
      errors:   {},
    })
    const advancePhase = (id, ts) => {
      if (seenPhases.has(id)) return
      seenPhases.add(id)
      const ids = GENERATION_PHASE_IDS
      const idx = ids.indexOf(id)
      if (idx < 1) return
      const prev = ids[idx - 1]
      setGenProgress(p => ({
        ...p,
        states:   { ...p.states, [prev]: STEP_STATES.DONE, [id]: STEP_STATES.RUNNING },
        startsAt: { ...p.startsAt, [id]: ts },
        endsAt:   { ...p.endsAt, [prev]: ts },
      }))
    }

    // Cache lookup — key is a stable hash of (prompt, model, style). Same
    // course + player + bag + weather → same key. On a hit we replay the
    // cached plan into the same rendering pipeline the streaming path uses,
    // so the UI treats it identically (companion mode, hole cards, saved-to-
    // history banner). Bypass path is wired to the ↺ Regenerate button below.
    const promptText = buildPrompt()
    let cacheKey = null
    try { cacheKey = await planCacheKey({ prompt: promptText, model: selectedModel, style: planStyle }) } catch {}
    if (!bypassCache && cacheKey) {
      const hit = getCachedPlan(cacheKey)
      if (hit?.plan) {
        setPlan(hit.plan)
        setPlanLoading(false)
        abortRef.current = null
        const endTs = Date.now()
        setGenProgress({
          states: Object.fromEntries(GENERATION_PHASE_IDS.map(id => [id, STEP_STATES.DONE])),
          startsAt: Object.fromEntries(GENERATION_PHASE_IDS.map(id => [id, genStartedAt])),
          endsAt: Object.fromEntries(GENERATION_PHASE_IDS.map(id => [id, endTs])),
          errors: {},
        })
        // Still validate + record in history so the user's per-course list is
        // consistent whether the brief was fresh or cached.
        if (course.name) {
          const v = validatePlanContract(hit.plan)
          setPlanValidationBanner(v.ok ? '' : (v.banner || 'Plan validation failed.'))
        }
        const entry = { course: course.name || 'Profile brief', date: todayLocalIso(), plan: hit.plan, tee: course.selectedTee || '', rec_log_id: null, cached: true }
        setSavedBriefs(prev => {
          const updated = [entry, ...prev].slice(0, 10)
          try { localStorage.setItem('golf_saved_briefs', JSON.stringify(updated)) } catch {}
          return updated
        })
        return
      }
    }

    const payload = {
      model: selectedModel,
      max_tokens: 16000,
      stream: true,
      messages: [{
        role: 'user',
        content: [{ type: 'text', text: promptText, cache_control: { type: 'ephemeral' } }],
      }],
    }
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      })
      if (!res.ok) {
        const errText = await res.text()
        let errMsg = `API ${res.status}: ${errText}`
        try { const j = JSON.parse(errText); if (j.error) errMsg = j.error } catch {}
        throw new Error(errMsg)
      }
      const reader = res.body.getReader()
      const dec    = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n'); buf = lines.pop()
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const d = line.slice(6).trim()
          if (d === '[DONE]') continue
          try {
            const j = JSON.parse(d)
            if (j.type === 'content_block_delta' && j.delta?.text) {
              setPlan(p => {
                const next = p + j.delta.text
                // Advance the structured tracker on every newly-seen phase
                // marker. Done inside setPlan so we read the freshest text.
                const ts = Date.now()
                for (const id of findPhaseMarkers(next)) advancePhase(id, ts)
                // Strip markers from the rendered text so the user never sees
                // them, but keep them in the stream-builder above so the
                // marker can fire even if it's split across two chunks.
                return stripPhaseMarkers(next)
              })
            }
            // Final event emitted by the edge function after rec_log insert.
            if (j.type === 'metadata' && j.rec_log_id) {
              capturedRecLogId = j.rec_log_id
              setLastRecLogId(j.rec_log_id)
            }
          } catch {}
        }
      }
    } catch (e) {
      if (e.name === 'AbortError') return
      setPlanError(e.message)
    }
    setPlanLoading(false)
    abortRef.current = null
    // Stream is done — mark any still-running step as DONE and stamp every
    // missing endsAt so the tracker shows final durations.
    setGenProgress(p => {
      const endTs = Date.now()
      const states = { ...p.states }
      const endsAt = { ...p.endsAt }
      for (const id of GENERATION_PHASE_IDS) {
        if (states[id] === STEP_STATES.RUNNING) states[id] = STEP_STATES.DONE
        if (states[id] === STEP_STATES.DONE && endsAt[id] == null) endsAt[id] = endTs
      }
      return { ...p, states, endsAt }
    })
    setPlan(p => {
      if (p) {
        // Validate plan against the output contract — surfaces silent
        // truncation, missing sections, malformed green-json.
        let contractOk = true
        if (course.name) {
          const v = validatePlanContract(p)
          contractOk = v.ok
          if (!v.ok) {
            setPlanValidationBanner(v.banner || 'Plan validation failed.')
          } else {
            setPlanValidationBanner('')
          }
        }
        // Cache the plan so a second Generate with identical inputs is
        // instant. Only cache validated plans — replaying a malformed brief
        // isn't a win for the user.
        if (cacheKey && contractOk) {
          try { putCachedPlan(cacheKey, p) } catch {}
        }
        const entry = { course: course.name || 'Profile brief', date: todayLocalIso(), plan: p, tee: course.selectedTee || '', rec_log_id: capturedRecLogId || null }
        setSavedBriefs(prev => {
          const updated = [entry, ...prev].slice(0, 10)
          try { localStorage.setItem('golf_saved_briefs', JSON.stringify(updated)) } catch {}
          return updated
        })
        if (user) {
          savePlan(user.id, entry.course, p, entry.tee).catch(e => console.warn('[supabase] plan save:', e.message))
        }
      }
      return p
    })
  }

  const copyPlan = async () => {
    await navigator.clipboard.writeText(plan)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const printPlan = () => {
    const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    const cleanPlan = plan.replace(/```green-json\s*\n[\s\S]*?\n```/g, '')
    const html = esc(cleanPlan)
      .replace(/^## (.+)$/gm, '</p><h2>$1</h2><p>')
      .replace(/^### (.+)$/gm, '</p><h3>$1</h3><p>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/^[-•] (.+)$/gm, '<div class="li">$1</div>')
      .replace(/^\d+\.\s+(.+)$/gm, '<div class="li">$1</div>')
      .replace(/\n{2,}/g, '</p><p>')
      .replace(/\n/g, '<br>')
    const doc = `<!DOCTYPE html><html><head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Game Plan — ${esc(course.name || 'Golf')}</title>
      <style>
        *{box-sizing:border-box;margin:0;padding:0}
        body{font-family:-apple-system,system-ui,'Segoe UI',Roboto,sans-serif;
          max-width:640px;margin:0 auto;padding:16px;color:#1a1a1a;line-height:1.6;font-size:14px;
          -webkit-text-size-adjust:100%}
        .header{background:#1a4d2e;color:#fff;padding:16px;border-radius:10px;margin-bottom:16px}
        .header h1{font-size:18px;font-weight:700;margin-bottom:4px}
        .header .meta{font-size:12px;color:#a8d5ba;line-height:1.5}
        h2{font-size:16px;font-weight:700;color:#1a4d2e;margin:20px 0 8px;padding:8px 0 4px;border-bottom:2px solid #e8e8e8}
        h3{font-size:14px;font-weight:600;color:#333;margin:14px 0 4px}
        p{margin:4px 0 8px;font-size:14px}
        strong{color:#111;font-weight:600}
        .li{padding:3px 0 3px 16px;position:relative;font-size:13px;line-height:1.5}
        .li::before{content:"▸";position:absolute;left:0;color:#1a4d2e}
        .hole-card{border:1px solid #e0e0e0;border-radius:8px;padding:12px;margin:10px 0;page-break-inside:avoid}
        @media print{
          body{padding:12px;font-size:13px}
          .header{-webkit-print-color-adjust:exact;print-color-adjust:exact}
          h2{page-break-after:avoid}
          .hole-card{page-break-inside:avoid}
        }
        @media(max-width:480px){
          body{padding:12px;font-size:13px}
          h2{font-size:15px}
          .header h1{font-size:16px}
        }
      </style></head><body>
      <div class="header">
        <h1>${esc(course.name || 'Game Plan')}</h1>
        <div class="meta">
          ${esc(playerInfo.name || 'Player')} · HCP ${esc(playerInfo.handicap)}<br>
          ${esc(teeDate)} · ${esc(teeTime)} · Par ${esc(course.par)} · ${Number(course.yardage || 0).toLocaleString()}y<br>
          ${course.selectedTee ? esc(course.selectedTee) + ' tees · ' : ''}${course.conditions ? esc(course.conditions) : ''}
        </div>
      </div>
      <p>${html}</p>
    </body></html>`
    const url = URL.createObjectURL(new Blob([doc], { type: 'text/html' }))
    const w = window.open(url, '_blank')
    w?.addEventListener('load', () => { w.print(); URL.revokeObjectURL(url) })
  }

  const mdComponents = useMemo(() => ({
    h2: ({ children }) => <h2 style={{ fontSize: 16, fontWeight: 600, color: C.text, margin: '1.4rem 0 0.4rem', borderBottom: `1px solid ${C.border}`, paddingBottom: 6 }}>{children}</h2>,
    h3: ({ children }) => {
      const text = typeof children === 'string' ? children : Array.isArray(children) ? children.join('') : ''
      return <h3 style={{ fontSize: 13, fontWeight: 600, color: /Hole/i.test(text) ? C.accent : C.amber, margin: '1rem 0 3px' }}>{children}</h3>
    },
    p: ({ children }) => <p style={{ fontSize: 13, color: C.textMuted, lineHeight: 1.7, margin: '3px 0' }}>{children}</p>,
    strong: ({ children }) => <strong style={{ color: C.text }}>{children}</strong>,
    li: ({ children }) => (
      <div style={{ display: 'flex', gap: 8, marginBottom: 3, paddingLeft: 6 }}>
        <span style={{ color: C.accentDim, flexShrink: 0, marginTop: 2 }}>▸</span>
        <span style={{ fontSize: 13, color: C.textMuted, lineHeight: 1.65 }}>{children}</span>
      </div>
    ),
    ul: ({ children }) => <div style={{ margin: '4px 0' }}>{children}</div>,
    ol: ({ children }) => <div style={{ margin: '4px 0' }}>{children}</div>,
    hr: () => <hr style={{ border: 'none', borderTop: `1px solid ${C.border}`, margin: '1.5rem 0' }} />,
    table: ({ children }) => (
      <div style={{ overflowX: 'auto', margin: '12px 0', WebkitOverflowScrolling: 'touch' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 480 }}>{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead style={{ borderBottom: `2px solid ${C.border}` }}>{children}</thead>,
    th: ({ children }) => <th style={{ padding: '8px 10px', textAlign: 'left', color: C.text, fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>{children}</th>,
    td: ({ children }) => <td style={{ padding: '7px 10px', borderBottom: `1px solid ${C.border}`, color: C.textMuted, verticalAlign: 'top' }}>{children}</td>,
    tr: ({ children }) => <tr style={{ }}>{children}</tr>,
    code: ({ children }) => <code style={{ background: C.bgInput, padding: '1px 5px', borderRadius: 4, fontSize: '0.9em' }}>{children}</code>,
  }), [])

  const renderPlan = (text) => (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
      {stripStreamingArtifacts(text)}
    </ReactMarkdown>
  )

  const parsedHoles = useMemo(() => {
    if (!plan) return { preamble: '', holes: [], postamble: '' }
    const lines = plan.split('\n')
    const holeRegex = /^###?\s*Hole\s+(\d+)/i
    const sectionRegex = /^##\s/
    let preambleEnd = -1
    const holes = []
    let cur = null

    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(holeRegex)
      if (m) {
        if (cur) { cur.end = i; holes.push(cur) }
        if (preambleEnd < 0) preambleEnd = i
        cur = { num: parseInt(m[1], 10), start: i, end: lines.length }
      } else if (cur && sectionRegex.test(lines[i]) && !holeRegex.test(lines[i])) {
        cur.end = i
        holes.push(cur)
        cur = null
      }
    }
    if (cur) holes.push(cur)

    const preamble = preambleEnd > 0 ? lines.slice(0, preambleEnd).join('\n') : plan
    const postStart = holes.length ? holes[holes.length - 1].end : lines.length
    const postamble = lines.slice(postStart).join('\n')

    const greenJsonRegex = /```green-json\s*\n([\s\S]*?)\n```/
    const holeData = holes.map(h => {
      const content = lines.slice(h.start, h.end).join('\n')
      const gm = content.match(greenJsonRegex)
      let green = null
      if (gm) {
        try { green = JSON.parse(gm[1].trim()) } catch {}
      }
      return { num: h.num, content: content.replace(greenJsonRegex, '').trim(), green }
    })

    return { preamble, holes: holeData, postamble }
  }, [plan])

  // ── API key panel helpers ─────────────────────────────────────────────────
  const saveKeysFromPanel = () => {
    const errs = {}
    if (draftAnthropicKey && !draftAnthropicKey.startsWith('sk-ant-'))
      errs.anthropic = 'Must start with sk-ant-'
    if (draftMapsKey && !draftMapsKey.startsWith('AIza'))
      errs.maps = 'Must start with AIza'
    if (Object.keys(errs).length) { setKeyErrors(errs); return }
    if (draftAnthropicKey)  setApiKey(draftAnthropicKey.trim())
    if (draftMapsKey)       setMapsKey(draftMapsKey.trim())
    if (draftGolfKey)       setGolfKey(draftGolfKey.trim())
    setDraftAnthropicKey(''); setDraftMapsKey(''); setDraftGolfKey('')
    setKeyErrors({})
  }
  const clearKey = (which) => {
    if (which === 'anthropic') setApiKey('')
    if (which === 'maps')      setMapsKey('')
    if (which === 'golf')      setGolfKey('')
  }

  // Top-level tabs. The Admin tab is appended only when the caller is admin
  // (Part 4 step 9 of the optimization plan). Settings stays in the bar for
  // everyone — it's purely personal now.
  const TABS = [
    { id: 'player',  label: 'My Player',  short: 'Player',  icon: '🏌️' },
    { id: 'prep',    label: 'Round Prep', short: 'Prep',    icon: '⛳' },
    { id: 'history', label: 'History',    short: 'History', icon: '📋' },
    { id: 'library', label: 'Library',    short: 'Library', icon: '📚' },
    { id: 'admin',   label: 'Settings',   short: 'Settings',icon: '⚙️' },
    ...(isAdmin === true ? [{ id: 'admintab', label: 'Admin', short: 'Admin', icon: '🛡️' }] : []),
  ]

  const [playerSubTab, setPlayerSubTab] = useState('details')
  const [deleteConfirm, setDeleteConfirm] = useState({})
  const [briefNotes, setBriefNotes] = useState({})


  return (
    <div style={{ background: C.bg, minHeight: '100vh', fontFamily: F, paddingTop: isOnline ? 0 : 40 }}>
      <PwaBanner
        isOnline={isOnline}
        canInstall={canInstall}
        onInstall={installApp}
        onDismiss={dismissInstall}
      />
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes blink{50%{opacity:0}}
        input::placeholder,textarea::placeholder{color:${C.textMuted};opacity:0.7}
        summary::-webkit-details-marker{display:none}
        summary::marker{display:none;content:''}
        details summary::after{content:'▸';color:${C.textFaint};font-size:10px;margin-left:auto;transition:transform 0.15s}
        details[open] summary::after{transform:rotate(90deg)}
        input:focus,textarea:focus,select:focus{border-color:${C.accentDim}!important;outline:none}
        select option{background:${C.bgInput}}
        code{background:${C.bgInput};padding:1px 5px;border-radius:4px;font-size:0.9em}
        .tab-bar::-webkit-scrollbar{display:none}
        @media(max-width:640px){input,select,textarea{font-size:16px!important}}
      `}</style>

      {/* Header — clean, minimal */}
      <div style={{ borderBottom: `1px solid ${C.border}`, padding: '0 1.5rem' }}>
        <div style={{ maxWidth: 1020, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 52, minHeight: 52 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 6 : 12, flexShrink: 1, overflow: 'hidden' }}>
            <span style={{ fontSize: isMobile ? 13 : 14, fontWeight: 600, color: C.text, letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>Strategy Engine</span>
            {!isMobile && <span style={{ color: C.border }}>|</span>}
            {!isMobile && <span style={{ fontSize: 13, color: C.textMuted }}>{playerInfo.name || 'Player'} · {playerInfo.handedness === 'Left' ? 'LH' : 'RH'} · HCP {playerInfo.handicap}</span>}
            {!isMobile && course.name && <span style={{ fontSize: 13, color: C.textFaint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>· {course.name}</span>}
            {weather && <Badge label="Weather live" bg={C.blueMuted} fg={C.blue} />}
          </div>
          <UserMenu
            user={user}
            compact={isMobile}
            onSignOut={onSignOut}
            onOpenSettings={() => setTab('admin')}
            currentProfile={currentProfile}
            profileNames={profileNames}
            onSwitchProfile={setCurrentProfile}
            onCreateProfile={(name) => createProfile(name, { ...playerInfo, clubs })}
            orgs={userOrgs}
            activeOrgId={activeOrgId}
            onSwitchOrg={handleOrgChange}
          />
        </div>
      </div>

      {/* Tabs */}
      <div style={{ borderBottom: `1px solid ${C.border}`, padding: '0 1.5rem' }}>
        <div className="tab-bar" role="tablist" aria-label="Main navigation" style={{ maxWidth: 1020, margin: '0 auto', display: 'flex', overflowX: 'auto', scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
          {TABS.map(t => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} aria-controls={`panel-${t.id}`} onClick={() => setTab(t.id)} style={{
              background: 'transparent', border: 'none',
              borderBottom: tab === t.id ? `2px solid ${C.accent}` : '2px solid transparent',
              padding: isMobile ? '12px 14px' : '13px 18px',
              fontSize: isMobile ? 12 : 13, fontFamily: F,
              color: tab === t.id ? C.text : C.textMuted, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: isMobile ? 4 : 6,
              flexShrink: 0, whiteSpace: 'nowrap', minHeight: 44,
            }}>
              {t.icon} {isMobile ? t.short : t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 1020, margin: '0 auto', padding: isMobile ? '1rem 0.75rem 4rem' : '1.5rem 1.5rem 4rem' }}>

        {/* ══════════════════════════════════════════════════════════════════
            SECTION 1: MY PLAYER
            Sub-tabs: Player Details, Club Distances, Data Import, Scoring History
           ══════════════════════════════════════════════════════════════════ */}
        {tab === 'player' && (
          <PlayerTab
            isMobile={isMobile}
            playerInfo={playerInfo}
            setPlayerInfo={setPlayerInfo}
            clubs={clubs}
            setClubs={setClubs}
            expandedClubs={expandedClubs}
            setExpandedClubs={setExpandedClubs}
            playerSubTab={playerSubTab}
            setPlayerSubTab={setPlayerSubTab}
            scoringHistory={scoringHistory}
            setScoringHistory={setScoringHistory}
            historySearch={historySearch}
            updateHS={updateHS}
            historySearchCourse={historySearchCourse}
            attachCourseToRound={attachCourseToRound}
          />
        )}

        {/* ══════════════════════════════════════════════════════════════════
            SECTION 2: ROUND PREP
            Sequential steps: Course → Tees → Scorecard → Weather → Generate
           ══════════════════════════════════════════════════════════════════ */}
        {tab === 'prep' && (
          <PrepTab
            isMobile={isMobile}
            session={session}
            user={user}
            lastRecLogId={lastRecLogId}
            prepStep={prepStep}
            setPrepStep={setPrepStep}
            course={course}
            setCourse={setCourse}
            coords={coords}
            setCoords={setCoords}
            teeTime={teeTime}
            setTeeTime={setTeeTime}
            teeDate={teeDate}
            setTeeDate={setTeeDate}
            pace={pace}
            setPace={setPace}
            timezone={timezone}
            weather={weather}
            setWeather={setWeather}
            weatherLoading={weatherLoading}
            setWeatherLoading={setWeatherLoading}
            plan={plan}
            planLoading={planLoading}
            planPhase={planPhase}
            genProgress={genProgress}
            planError={planError}
            planValidationBanner={planValidationBanner}
            planStyle={planStyle}
            setPlanStyle={setPlanStyle}
            planView={planView}
            setPlanView={setPlanView}
            enriching={enriching}
            enrichStatus={enrichStatus}
            enrichProgress={enrichProgress}
            selectedModel={selectedModel}
            setSelectedModel={setSelectedModel}
            copied={copied}
            currentHole={currentHole}
            setCurrentHole={setCurrentHole}
            holeScores={holeScores}
            setScore={setScore}
            displayGeo={displayGeo}
            contributedHoleSet={contributedHoleSet}
            clubs={clubs}
            parsedHoles={parsedHoles}
            generate={generate}
            cancelGenerate={cancelGenerate}
            copyPlan={copyPlan}
            printPlan={printPlan}
            applyScorecard={applyScorecard}
            resetPrep={resetPrep}
            renderPlan={renderPlan}
            handleHoleContribution={handleHoleContribution}
            setTab={setTab}
            setExpandedBrief={setExpandedBrief}
          />
        )}
        {/* ══════════════════════════════════════════════════════════════════
            SECTION 3: HISTORY
            Saved round prep reports with notes, delete confirmation, dates
           ══════════════════════════════════════════════════════════════════ */}
        {tab === 'history' && (
          <HistoryTab
            user={user}
            savedBriefs={savedBriefs}
            setSavedBriefs={setSavedBriefs}
            expandedBrief={expandedBrief}
            setExpandedBrief={setExpandedBrief}
            briefNotes={briefNotes}
            setBriefNotes={setBriefNotes}
            deleteConfirm={deleteConfirm}
            setDeleteConfirm={setDeleteConfirm}
            copied={copied}
            setCopied={setCopied}
            setTab={setTab}
            setPrepStep={setPrepStep}
            setPlan={setPlan}
            renderPlan={renderPlan}
          />
        )}

        {/* ── COURSE LIBRARY ── */}
        {tab === 'library' && (
          <LibraryTab
            isMobile={isMobile}
            session={session}
            onUseForPrep={(course) => {
              applyScorecard(course)
              setTab('prep')
              setPrepStep(2)
            }}
          />
        )}

        {/* ── SETTINGS / ADMIN ── */}
        {tab === 'admin' && (
          <SettingsTab
            isMobile={isMobile}
            user={user}
            session={session}
            onSignOut={onSignOut}
            selectedModel={selectedModel}
            setSelectedModel={setSelectedModel}
            acctSection={acctSection}
            setAcctSection={setAcctSection}
            acctLoading={acctLoading}
            setAcctLoading={setAcctLoading}
            acctMsg={acctMsg}
            setAcctMsg={setAcctMsg}
            acctNewPass={acctNewPass}
            setAcctNewPass={setAcctNewPass}
            acctConfirmPass={acctConfirmPass}
            setAcctConfirmPass={setAcctConfirmPass}
            acctNewEmail={acctNewEmail}
            setAcctNewEmail={setAcctNewEmail}
            setCacheVersion={setCacheVersion}
            setTab={setTab}
            setPrepStep={setPrepStep}
            applyScorecard={applyScorecard}
            onRunOnboarding={onRunOnboarding}
          />
        )}

        {/* Top-level Admin tab (Part 4 step 9). Only rendered when isAdmin
            resolves true; the tab itself is conditionally added to TABS. */}
        {tab === 'admintab' && isAdmin === true && (
          <AdminTab
            isMobile={isMobile}
            authToken={session?.access_token || ''}
            currentUserId={user?.id}
            onEditCourse={(c) => setEditorCourse(c)}
            activeOrgId={activeOrgId}
            onOrgChange={handleOrgChange}
          />
        )}

      </div>

      {editorCourse && (
        <AdminCourseEditor
          course={editorCourse}
          authToken={session?.access_token || ''}
          onClose={() => setEditorCourse(null)}
          onSaved={async (result) => {
            // Drop local cache for the old key (if rename, it's now dead;
            // if just an edit, force a fresh DB read next lookup).
            removeCachedCourseByKey(editorCourse._cacheKey)
            // If editor renamed, the currently-loaded course's name in
            // App state needs updating too if it matched.
            if (result?.new_key && isSameCourseKey(course, { name: editorCourse.name, location: editorCourse.location })) {
              const merged = { ...course, ...(result.course_data || {}) }
              setCourse(merged)
              setCachedCourse(merged)
            } else if (result?.course_data && isSameCourseKey(course, editorCourse)) {
              setCourse(prev => ({ ...prev, ...result.course_data }))
            }
            setCacheVersion(v => v + 1)
            setEditorCourse(null)
            // Refresh the shared-cache admin list
            try {
              const rows = await getAllCachedCoursesDB()
              const withPdfs = await Promise.all(rows.map(async (c) => {
                const pdfs = await listCoursePdfs(c.name, c.location).catch(() => [])
                return { ...c, _pdfs: pdfs }
              }))
              setSharedCache(withPdfs)
            } catch {}
          }}
        />
      )}
    </div>
  )
}

// ─── Auth gate ────────────────────────────────────────────────────────────────
function AuthGate() {
  const [session,     setSession]     = useState(undefined)   // undefined = loading, null = signed out
  const [user,        setUser]        = useState(null)
  const [needsOnboarding, setNeedsOnboarding] = useState(false)
  // True when Supabase has fired a PASSWORD_RECOVERY event (user clicked the
  // email link). Forces AuthScreen to render its reset-password view, even
  // when a recovery session is technically valid — we don't want them dropped
  // into the main app until they've set a new password.
  // Lazy initializer runs synchronously on first render — the hash is still
  // present at this point because Supabase's hash-clearing is async (it waits
  // for the token exchange network request before calling history.replaceState).
  const [recoveryMode, setRecoveryMode] = useState(
    () => new URLSearchParams(window.location.hash.slice(1)).get('type') === 'recovery'
  )

  // Check existing session on mount
  useEffect(() => {
    // With implicit flow, Supabase parses the hash and fires PASSWORD_RECOVERY
    // immediately on createClient() — before React has mounted and registered
    // onAuthStateChange. Guard against this by also reading the hash directly.
    const hashParams = new URLSearchParams(window.location.hash.slice(1))
    if (hashParams.get('type') === 'recovery') {
      setRecoveryMode(true)
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      // Any authenticated user without a saved profile gets the wizard —
      // covers existing accounts that predate onboarding and signups that
      // bailed mid-wizard. localStorage `gse_onboarding_dismissed` lets
      // a user opt out permanently (Settings toggle).
      if (session?.user) maybeOfferOnboarding(session.user)
    })

    // Listen for auth changes (login, logout, token refresh, password recovery)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (event === 'PASSWORD_RECOVERY') setRecoveryMode(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  // Show the wizard when the user has zero saved profiles AND hasn't opted
  // out. Called on session establishment; a returning user with a full
  // profile never sees this.
  const maybeOfferOnboarding = async (u) => {
    try {
      if (localStorage.getItem('gse_onboarding_dismissed') === '1') return
      const profiles = await loadUserProfiles(u.id)
      const hasAny = profiles && Object.keys(profiles).length > 0
      if (!hasAny) setNeedsOnboarding(true)
    } catch (e) {
      // Non-fatal — the user can still open the wizard from Settings.
      console.warn('[onboarding] profile check failed:', e.message)
    }
  }

  // Handle AuthScreen completion
  const handleAuth = async (type) => {
    const { data: { session } } = await supabase.auth.getSession()
    setSession(session)
    setUser(session?.user ?? null)
    if (type === 'new') setNeedsOnboarding(true)
  }

  // Handle sign out
  const handleSignOut = () => {
    setSession(null)
    setUser(null)
    setNeedsOnboarding(false)
  }

  // Handle onboarding completion — save initial profile + bag (+ optional
  // scoring history) to Supabase, optionally hand off a "load sample course"
  // signal to AppInner via localStorage so it can pre-pick Pebble Beach on
  // first render (Part 1.1 of the optimization plan).
  const handleOnboardingComplete = async ({ player, clubs: onboardClubs, rounds, trySampleCourse }) => {
    const u = user
    const profileName = player.name || 'Default'
    if (u) {
      const playerData = { ...player, clubs: onboardClubs }
      try {
        await saveUserProfile(u.id, profileName, playerData)
        await saveUserSettings(u.id, { current_profile: profileName })
        if (Array.isArray(rounds) && rounds.length > 0) {
          await saveUserHistory(u.id, rounds)
        }
      } catch (e) {
        console.warn('[onboarding] save error:', e.message)
      }
    }
    if (trySampleCourse) {
      try { localStorage.setItem('gse_onboarding_sample_course', '1') } catch {}
    }
    // Remember that the wizard was completed so we don't offer it again on
    // every future session (even if the profile write to Supabase races or
    // gets rolled back).
    try { localStorage.setItem('gse_onboarding_dismissed', '1') } catch {}
    setNeedsOnboarding(false)
  }

  // Loading state
  if (session === undefined) {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f1117', fontFamily: 'Inter,system-ui,sans-serif' }}>
        <div style={{ textAlign: 'center', color: '#64748b' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⛳</div>
          <p style={{ fontSize: 14 }}>Loading…</p>
        </div>
      </div>
    )
  }

  // Password recovery — the Supabase client picked up #access_token=...&type=recovery
  // from the magic link. Render AuthScreen in reset mode regardless of whether
  // a session is technically valid; the user shouldn't see the app until they
  // set a new password.
  if (recoveryMode) {
    return (
      <AuthScreen
        onAuth={handleAuth}
        recoveryMode
        onRecoveryComplete={() => setRecoveryMode(false)}
      />
    )
  }

  // Not authenticated — check for invite token in URL
  if (!session || !user) {
    const inviteToken = new URLSearchParams(window.location.search).get('invite') || null
    return <AuthScreen onAuth={handleAuth} inviteToken={inviteToken} />
  }

  // New user — show onboarding wizard
  if (needsOnboarding) {
    return <OnboardingScreen onComplete={handleOnboardingComplete} />
  }

  // Authenticated — show main app
  return <AppInner
    user={user}
    session={session}
    onSignOut={handleSignOut}
    onRunOnboarding={() => {
      // Explicit re-open: clear the "dismissed" flag so a fresh Finish
      // sticks, then flip the wizard on.
      try { localStorage.removeItem('gse_onboarding_dismissed') } catch {}
      setNeedsOnboarding(true)
    }}
  />
}

export default function App() {
  return <ErrorBoundary><AuthGate /></ErrorBoundary>
}
