import { useState, useCallback, useEffect, useRef, useMemo, Component } from 'react'
import { supabase, loadUserProfiles, saveUserProfile, deleteUserProfile, loadUserHistory, saveUserHistory, loadUserSettings, saveUserSettings, getCachedCourseDB, setCachedCourseDB, getAllCachedCoursesDB, deleteCachedCourseDB, loadSavedPlans, deleteSavedPlan, listCoursePdfs, uploadCoursePdfToBucket, deleteAllCoursePdfs, deleteCourseHazards, clearCachedScorecardPdfRef, listCanonicalCacheKeys, listCanonicalCacheVersions, listAliasKeys, loadPrepSession, savePrepSession, clearPrepSession } from './lib/supabase.js'
import { buildRecommendationPrompt } from './lib/recommendation/prompt.js'
import { saveContrib } from './lib/holeContributions.js'
import { C, F, card, inp, lbl, btnP, btnG } from './theme.js'
import { useIsMobile, Badge, Spin, SectionHead, InfoBox, computeDataTier } from './components/ui.jsx'
import UserMenu from './components/UserMenu.jsx'
import { computeHoleTimes, getWeatherAtHour } from './lib/weather.js'
import { searchGolfCourseAPI, normalizeGolfCourseAPICourse } from './lib/courseApi.js'
import { todayLocalIso } from './lib/localDate.js'
import { getLatestPostRoundForCourse } from './lib/postRound.js'
import { useProfile } from './lib/useProfile.js'
import { PrepContext } from './lib/PrepContext.js'
import { useEnrichment } from './lib/useEnrichment.js'
import { useGeneration } from './lib/useGeneration.js'
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
  // Bumped by resetPrep so CourseSearch (which owns its own query/results
  // state) remounts and clears the prior search input.
  const [courseSearchResetKey, setCourseSearchResetKey] = useState(0)

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

  const { enriching, enrichStatus, enrichProgress, displayGeo, contributedHoleSet } = useEnrichment({
    course, coords, setCourse, setCoords, session,
  })

  // Game plan
  const [planStyle,   setPlanStyle]   = useState('balanced')
  const [planView,    setPlanView]    = useState('companion')
  const [currentHole, setCurrentHole] = useState(0)
  const [copied,      setCopied]      = useState(false)
  const [savedBriefs, setSavedBriefs] = useState(() => {
    try { return JSON.parse(localStorage.getItem('golf_saved_briefs') || '[]') } catch { return [] }
  })
  const [holeScores,  setHoleScores]  = useState({})
  const [expandedBrief, setExpandedBrief] = useState(null)

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
        const [keys, aliases, versions] = await Promise.all([
          listCanonicalCacheKeys(),
          listAliasKeys(),
          listCanonicalCacheVersions(),
        ])
        if (cancelled || !keys) return
        const removed = purgeOrphanedLocalEntries(keys, aliases || [], versions)
        if (removed) console.log(`[course cache] purged ${removed} orphaned or stale local entr${removed === 1 ? 'y' : 'ies'}`)
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
          <PrepContext.Provider value={{
            isMobile, session, user, lastRecLogId,
            prepStep, setPrepStep,
            course, setCourse, coords, setCoords,
            teeTime, setTeeTime, teeDate, setTeeDate,
            pace, setPace, timezone,
            weather, setWeather, weatherLoading, setWeatherLoading,
            plan, planLoading, planPhase, genProgress,
            planError, planValidationBanner,
            planStyle, setPlanStyle, planView, setPlanView,
            enriching, enrichStatus, enrichProgress,
            selectedModel, setSelectedModel,
            copied, currentHole, setCurrentHole,
            holeScores, setScore,
            displayGeo, contributedHoleSet,
            clubs, parsedHoles,
            generate, cancelGenerate,
            copyPlan, printPlan,
            applyScorecard, resetPrep,
            courseSearchResetKey, handleHoleContribution,
            setTab, setExpandedBrief,
          }}>
            <PrepTab />
          </PrepContext.Provider>
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
            onCourseChanged={(cacheKey) => {
              // Fires when a course was uploaded / deleted / had its PDF
              // removed from the admin browser. Bumping cacheVersion re-runs
              // any downstream memoized selectors (LibraryTab list, etc.) so
              // the change surfaces without a full reload. If the affected
              // course is the one currently loaded in the Prep flow, force a
              // reset — the underlying data is now stale or gone.
              setCacheVersion(v => v + 1)
              if (cacheKey && isSameCourseKey(course, { name: course.name, location: course.location })) {
                const currentKey = `${(course.name || '').toLowerCase().trim()}|${(course.location || '').toLowerCase().trim()}`
                if (currentKey === cacheKey) resetPrep()
              }
            }}
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
