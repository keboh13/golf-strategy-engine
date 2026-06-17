import { useState, useCallback, useEffect, useRef, useMemo, Component } from 'react'
import { supabase, loadUserProfiles, saveUserProfile, deleteUserProfile, loadUserHistory, saveUserHistory, loadUserSettings, saveUserSettings, getCachedCourseDB, setCachedCourseDB, getAllCachedCoursesDB, deleteCachedCourseDB, loadSavedPlans, savePlan, deleteSavedPlan } from './lib/supabase.js'
import { buildBagSection } from './lib/promptSections.js'
import { fetchOSMCourseData, enrichHolesWithOSM, exportCourseGeoJSON, classifyTier, computeCoverage } from './lib/osmCourseData.js'
import { computeHoleDistances, formatDistancesLine, simplifyAndTrimGeoJSON } from './lib/courseGeometry.js'
import { getCachedGeo, setCachedGeo } from './lib/courseGeoCache.js'
import { getContrib, saveContrib, mergeContribIntoGeojson } from './lib/holeContributions.js'
import { C, F, card, inp, lbl, btnP, btnG } from './theme.js'
import { useIsMobile, Badge, Spin, SectionHead, InfoBox, computeDataTier, DataAccuracyTier } from './components/ui.jsx'
import GreenView from './components/GreenView.jsx'
import CourseHoleMap from './components/CourseHoleMap.jsx'
import UserMenu from './components/UserMenu.jsx'
import CourseSearch from './components/CourseSearch.jsx'
import ScorecardPreview from './components/ScorecardPreview.jsx'
import WeatherPanel from './components/WeatherPanel.jsx'
import { computeHoleTimes, getWeatherAtHour, toParStr, windDir } from './lib/weather.js'
import { fetchHoleDesignViaSearch, mergeDesignDataIntoHoles, searchGolfCourseAPI, normalizeGolfCourseAPICourse } from './lib/courseApi.js'
import { loadCourseCache, getCachedCourse, setCachedCourse, cacheKey, saveCourseCache } from './lib/courseCache.js'
import AuthScreen from './screens/AuthScreen.jsx'
import ImportTab from './components/ImportTab.jsx'
import OnboardingScreen from './screens/OnboardingScreen.jsx'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

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

// ─── Env keys (set in .env) ───────────────────────────────────────────────────
// ─── Env keys (set in .env) ───────────────────────────────────────────────────
const ENV_MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY || ''

// ─── Model ────────────────────────────────────────────────────────────────────
const MODEL = 'claude-sonnet-4-6'

// ─── localStorage keys ────────────────────────────────────────────────────────
const LS_PLAYER   = 'gse_player'
const LS_HISTORY  = 'gse_history'
const LS_KEYS     = 'gse_keys'
const LS_PROFILES = 'gse_profiles'
const LS_CURRENT_PROFILE = 'gse_current_profile'
const LS_COURSE_CACHE    = 'gse_course_cache'
const LS_MODEL           = 'gse_model'

// ─── AI models available for plan generation ──────────────────────────────────
const AVAILABLE_MODELS = [
  { id: 'claude-haiku-4-5-20251001', name: 'Haiku',   desc: 'Fastest · Good for quick briefs',          tier: 'Free',     speed: '~8s',  cost: '$' },
  { id: 'claude-sonnet-4-6',         name: 'Sonnet',  desc: 'Balanced · Recommended (default)',          tier: 'Standard', speed: '~15s', cost: '$$' },
  { id: 'claude-opus-4-8',           name: 'Opus',    desc: 'Most capable · Deeper analysis',            tier: 'Premium',  speed: '~30s', cost: '$$$' },
  { id: 'claude-fable-5',            name: 'Fable 5', desc: 'Flagship · Best strategy & reasoning',      tier: 'Premium',  speed: '~25s', cost: '$$$' },
]

function loadProfiles() {
  try { return JSON.parse(localStorage.getItem(LS_PROFILES)) || {} } catch { return {} }
}
function saveProfiles(obj) {
  try { localStorage.setItem(LS_PROFILES, JSON.stringify(obj)) } catch {}
}

// Migrate legacy single-player data into profiles on first run
;(function migrateLegacy() {
  const profiles = loadProfiles()
  if (Object.keys(profiles).length === 0) {
    try {
      const legacy = JSON.parse(localStorage.getItem(LS_PLAYER))
      if (legacy) { profiles['Default'] = legacy; saveProfiles(profiles) }
    } catch {}
  }
})()

function loadSavedKeys() {
  try { return JSON.parse(localStorage.getItem(LS_KEYS)) || {} } catch { return {} }
}
function saveKeys(obj) {
  try { localStorage.setItem(LS_KEYS, JSON.stringify(obj)) } catch {}
}

// ─── Default club distances (starting point for new profiles — saved with the profile) ──
const DEFAULT_CLUBS = [
  { club: 'Driver',          carry: 275, shape: 'Slight fade' },
  { club: '3-wood',          carry: 245, shape: 'Fade'        },
  { club: '5-wood',          carry: 230, shape: 'Fade'        },
  { club: '4-iron / hybrid', carry: 210, shape: 'Straight'    },
  { club: '5-iron',          carry: 195, shape: 'Straight'    },
  { club: '6-iron',          carry: 180, shape: 'Straight'    },
  { club: '7-iron',          carry: 165, shape: 'Draw'        },
  { club: '8-iron',          carry: 150, shape: 'Draw'        },
  { club: '9-iron',          carry: 135, shape: 'Draw'        },
  { club: 'PW',              carry: 120, shape: 'Draw'        },
  { club: 'GW (50°)',        carry: 105, shape: 'Straight'    },
  { club: 'SW (56°)',        carry:  85, shape: 'Straight'    },
  { club: 'LW (60°)',        carry:  65, shape: 'Straight'    },
]

// Clubs ride inside the persisted profile blob (localStorage + Supabase player_data).
// These helpers split that blob back into clubs and clubs-free player info.
function clubsFromProfile(data) {
  return (data && Array.isArray(data.clubs) && data.clubs.length > 0) ? data.clubs : DEFAULT_CLUBS
}
function stripClubs(data) {
  if (!data || typeof data !== 'object') return data
  const { clubs: _ignored, ...info } = data
  return info
}

const DEFAULT_PLAYER = {
  name: '', handicap: '4.2', ghin: '',
  handedness: 'Right',
  miss: 'Both (fade misses right under pressure)',
  ballFlight: 'Fade', swingNotes: '',
  goals: '', strengths: '',
}

// ─── Main App ─────────────────────────────────────────────────────────────────
function AppInner({ user, session, onSignOut }) {
  const isMobile = useIsMobile()
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

  // ── Admin user management state ───────────────────────────────────────────
  const [isAdmin,         setIsAdmin]         = useState(null)  // null = unknown (not yet checked)
  const [adminUsers,      setAdminUsers]      = useState(null)  // null = not loaded
  const [adminUsersLoading, setAdminUsersLoading] = useState(false)
  const [adminUsersError, setAdminUsersError] = useState('')
  const [adminDeleteMsg,  setAdminDeleteMsg]  = useState('')
  const [adminGrantMsg,   setAdminGrantMsg]   = useState('')

  // Persist all keys together whenever any changes
  const setApiKey = (v) => { setApiKeyRaw(v);       saveKeys({ ...loadSavedKeys(), anthropic:  v }) }
  const setMapsKey = (v) => { setMapsKeyRaw(v);     saveKeys({ ...loadSavedKeys(), maps:        v }) }
  const setGolfKey = (v) => { setGolfKeyRaw(v);     saveKeys({ ...loadSavedKeys(), golfCourse:  v }) }

  const [tab, setTab] = useState('player')

  // Player profile — persisted to localStorage across sessions (clubs live alongside in the
  // saved blob but are kept in their own state, so playerInfo's shape stays unchanged)
  const [playerInfo, setPlayerInfo] = useState(() => {
    try { return stripClubs(JSON.parse(localStorage.getItem(LS_PLAYER))) || DEFAULT_PLAYER } catch { return DEFAULT_PLAYER }
  })

  // Single profile per authenticated user (profile name = 'Default')
  const currentProfile = 'Default'

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
  const [teeDate,  setTeeDate]  = useState(() => new Date().toISOString().slice(0, 10))
  const [pace,     setPace]     = useState(11)
  const [timezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone)
  const [weather,        setWeather]        = useState(null)
  const [weatherLoading, setWeatherLoading] = useState(false)
  const [coords,         setCoords]         = useState(null)
  const [cacheVersion,   setCacheVersion]   = useState(0)

  // Enrichment loading state
  const [enriching,      setEnriching]      = useState(false)
  const [enrichStatus,   setEnrichStatus]   = useState('')

  // Game plan
  const [plan,        setPlan]        = useState('')
  const [planLoading, setPlanLoading] = useState(false)
  const [planPhase,   setPlanPhase]   = useState('')
  const [planError,   setPlanError]   = useState('')
  const abortRef = useRef(null)
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

  // Load user data from Supabase on mount (when authenticated)
  useEffect(() => {
    if (!user) return
    setDbLoaded(false)
    ;(async () => {
      try {
        const dbProfiles = await loadUserProfiles(user.id)
        const profileData = dbProfiles['Default'] || dbProfiles[Object.keys(dbProfiles)[0]]
        if (profileData) {
          setPlayerInfo(stripClubs(profileData))
          setClubs(clubsFromProfile(profileData))
        }
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

  useEffect(() => {
    const profileData = { ...playerInfo, clubs }
    localStorage.setItem(LS_PLAYER, JSON.stringify(profileData))
    if (user && dbLoaded) {
      const timer = setTimeout(() => {
        saveUserProfile(user.id, currentProfile, profileData).catch(e => console.warn('[supabase] profile save:', e.message))
      }, 1200)
      return () => clearTimeout(timer)
    }
  }, [playerInfo, clubs, dbLoaded])
  useEffect(() => {
    localStorage.setItem(LS_HISTORY, JSON.stringify(scoringHistory))
    if (user && dbLoaded) {
      const timer = setTimeout(() => {
        saveUserHistory(user.id, scoringHistory).catch(e => console.warn('[supabase] history save:', e.message))
      }, 1500)
      return () => clearTimeout(timer)
    }
  }, [scoringHistory, dbLoaded])

  // Check admin status once when the Settings tab is opened
  useEffect(() => {
    if (tab !== 'admin' || isAdmin !== null) return
    const authToken = session?.access_token || ''
    if (!authToken) { setIsAdmin(false); return }
    fetch('/api/check-admin', { headers: { Authorization: `Bearer ${authToken}` } })
      .then(r => r.json())
      .then(d => setIsAdmin(!!d.isAdmin))
      .catch(() => setIsAdmin(false))
  }, [tab, isAdmin, session])

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

  // Enrich course with OSM/web design data (parallelized with retry + UI feedback)
  const enrichLoadIdRef = useRef(0)
  useEffect(() => {
    if (!course.name || !coords?.lat || !coords?.lng || course.osmEnriched) return
    const myId = ++enrichLoadIdRef.current
    const ctrl = new AbortController()
    setEnriching(true)
    setEnrichStatus('Loading course design data...')
    ;(async () => {
      let osmWorked = false

      // Phase 1: OSM enrichment + geometry export (Tier 1/2/3 classifier)
      setEnrichStatus('Fetching hazard data from OpenStreetMap...')
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
        } catch {
          if (attempt === 0) setEnrichStatus('Retrying OSM data...')
        }
      }

      // Phase 2: Web search enrichment (if OSM coverage is sparse)
      const authToken = session?.access_token || ''
      const holesWithDesign = course.holes.filter(h => h.osmDesign?.hazards?.length > 0 || h.notes).length
      if (holesWithDesign < 9 && authToken) {
        setEnrichStatus('Searching for hole design details...')
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
                return updated
              })
            }
            break
          } catch {
            if (attempt === 0) setEnrichStatus('Retrying design search...')
          }
        }
      }

      if (!osmWorked && myId === enrichLoadIdRef.current) {
        setCourse(prev => ({ ...prev, osmEnriched: true }))
      }

      // Phase 3: User-contributed hole pins. We always try this — it's the
      // only data source for many Tier 3 courses, and a cheap LS/Supabase
      // lookup. Contributions flow into the rendered geojson via the memo
      // below; nothing else needs to know about them.
      try {
        const contrib = await getContrib(course.name, course.location)
        if (myId === enrichLoadIdRef.current && contrib && Object.keys(contrib).length) {
          setCourse(prev => ({ ...prev, contribByRef: contrib }))
        }
      } catch {}

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

  const buildPrompt = useCallback(() => {
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
    const designNote = hasOSMData && hasWebDesign ? ' + OSM + web-search design data'
      : hasOSMData ? ' + OSM hole design data (hazards, greens)'
      : hasWebDesign ? ' + web-search design data (hazards, layout)'
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
      const nStr = h.notes ? ` | Note: ${h.notes}` : (!designStr ? ' | Note: no design data — do not assume hazards' : '')
      return `H${i+1}: Par ${h.par}, ${h.yardage || '?'}y, HCP ${h.handicap}${eStr}${designStr}${nStr}${wStr}`
    }).join('\n')

    return `You are an elite Tour caddy. Generate a concise game plan. IMPORTANT: You MUST cover ALL 18 holes — do not stop early.

${playerBlock}

COURSE: ${course.name}${course.selectedTee ? ` (${course.selectedTee} tees)` : ''}, ${course.yardage}y, Rating ${course.rating} / Slope ${course.slope}, Par ${course.par}
Course Handicap: ${courseHandicap} | Data: ${sourceNote}
${course.roundType} | Target: ${course.targetScore || 'under par'} | Conditions: ${course.conditions}
${course.elevation ? `Course elevation: ${course.elevation}ft — factor into club selection (higher altitude = more carry)` : ''}
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
${hasOSMData || hasWebDesign
  ? `Some holes have design data from ${hasOSMData ? 'OpenStreetMap (marked "Design (OSM verified)")' : ''}${hasOSMData && hasWebDesign ? ' and/or ' : ''}${hasWebDesign ? 'web search (marked "Design (web search)")' : ''}. OSM data is from geographic surveys — treat as verified. Web search data is moderately reliable — use it but don't over-rely on specific details. For holes WITHOUT any design data, follow the strict rules below.`
  : `You only have scorecard data (par, yardage, handicap) for each hole. You do NOT have verified hole design data (hazard locations, water, OB, doglegs, fairway shape, green surrounds).`}
Follow these rules strictly:
- Do NOT invent or guess specific hazard placements (bunkers, water, OB) unless explicitly provided in a hole's data (via "Design (OSM verified)", "Design (web search)", or a user "Note:"). If none exist — do NOT fabricate hazards.
- Do NOT recommend shot shapes to "avoid" hazards you are not certain exist. Base tee shot shape recommendations on: the player's ball flight and miss tendency, the par/yardage, and wind — NOT on assumed hole layouts.
- For green-json: set "hazards" to an EMPTY array [] unless a hole's design data or note explicitly describes a specific hazard near the green. Do NOT guess bunker or water locations.
- For green-json: when a hole has "Design (OSM verified)" data, use those hazards with "confidence":"verified". When a hole has "Design (web search)" data, use with "confidence":"uncertain". When a hole has NO design data, set "hazards":[] and use generic values.
- For tee shot strategy: when a hole has design data including dogleg direction, use that to inform shot shape. When a hole has bearing data, factor in wind direction vs hole bearing. Otherwise, recommend shape based on the player's natural ball flight and miss tendency — do NOT fabricate doglegs or fairway shapes.
- When a hole's "Design (OSM verified)" data includes specific distances (e.g. "tee→pin 425y", "green 142/158/168y (F/C/B)", "carry Bunker R 235y"), use those exact numbers when discussing carry distances, club choices, and lay-up targets. They are surveyed from OSM and accurate within ~±5 yards. Do NOT round them to "about 240" — say "235y carry over the right fairway bunker" and pick the club that matches. Carry distances are measured FROM THE TEE along the centerline.
- When in doubt, say "standard approach" rather than inventing hazards to avoid.

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

  const generate = async () => {
    const authToken = session?.access_token || ''
    if (!authToken) { setPlanError('Please sign in to generate a game plan.'); return }
    if (abortRef.current) abortRef.current.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setPlanLoading(true); setPlanPhase('Analyzing scoring history'); setPlanError(''); setPlan(''); setTab('prep'); setPrepStep(4)
    const payload = {
      model: selectedModel,
      max_tokens: 16000,
      stream: true,
      messages: [{
        role: 'user',
        content: [{ type: 'text', text: buildPrompt(), cache_control: { type: 'ephemeral' } }],
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
                if (next.includes('## Scoring roadmap') || next.includes('## scoring roadmap')) setPlanPhase('Drafting round strategy')
                else if (next.includes('## Hole-by-hole') || next.includes('## hole-by-hole')) setPlanPhase('Writing hole-by-hole strategy')
                else if (next.includes('## Weather') || next.includes('## Pressure')) setPlanPhase('Finalizing adjustments')
                return next
              })
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
    setPlan(p => {
      if (p) {
        const entry = { course: course.name || 'Profile brief', date: new Date().toISOString().slice(0, 10), plan: p, tee: course.selectedTee || '' }
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
      {text}
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

  const TABS = [
    { id: 'player',  label: 'My Player',   short: 'Player',  icon: '🏌️' },
    { id: 'prep',    label: 'Round Prep',   short: 'Prep',    icon: '⛳' },
    { id: 'history', label: 'History',      short: 'History', icon: '📋' },
    { id: 'admin',   label: 'Settings',     short: 'Settings',icon: '⚙️' },
  ]

  const [playerSubTab, setPlayerSubTab] = useState('details')
  const [prepStep, setPrepStep] = useState(1)
  const [deleteConfirm, setDeleteConfirm] = useState({})
  const [briefNotes, setBriefNotes] = useState({})

  const PLAYER_SUBS = [
    { id: 'details', label: 'Player Details', icon: '👤' },
    { id: 'clubs',   label: 'Club Distances', icon: '🏌️' },
    { id: 'import',  label: 'Data Import',    icon: '📥' },
    { id: 'scoring', label: 'Scoring History', icon: '📊' },
  ]

  const PREP_STEPS = [
    { num: 1, label: 'Select Course',    icon: '🔍' },
    { num: 2, label: 'Scorecard & Tees', icon: '📋' },
    { num: 3, label: 'Weather & Time',   icon: '🌤' },
    { num: 4, label: 'Generate Report',  icon: '⚡' },
  ]

  return (
    <div style={{ background: C.bg, minHeight: '100vh', fontFamily: F }}>
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
          <div>
            <SectionHead
              title="My Player"
              sub="Your profile, bag, and scoring data — synced with your account."
            />

            {/* Sub-tab navigation */}
            <div role="tablist" aria-label="Player sections" style={{ display: 'flex', gap: 4, marginBottom: 16, background: C.bgInput, borderRadius: 10, padding: 4, overflowX: 'auto' }}>
              {PLAYER_SUBS.map(s => (
                <button key={s.id} role="tab" aria-selected={playerSubTab === s.id} onClick={() => setPlayerSubTab(s.id)} style={{
                  flex: isMobile ? 1 : 'none',
                  padding: isMobile ? '10px 8px' : '10px 18px',
                  fontSize: isMobile ? 11 : 13, fontWeight: 500, fontFamily: F,
                  border: 'none', borderRadius: 8, cursor: 'pointer',
                  background: playerSubTab === s.id ? C.accent : 'transparent',
                  color: playerSubTab === s.id ? C.bg : C.textMuted,
                  whiteSpace: 'nowrap', transition: 'all 0.15s', minHeight: 44,
                }}>
                  {s.icon} {isMobile ? s.label.split(' ')[0] : s.label}
                </button>
              ))}
            </div>

            {/* ── Player Details sub-tab ── */}
            {playerSubTab === 'details' && (
              <div>
                <div style={{ ...card, marginBottom: 12 }}>
                  {/* Identity section - collapsible on mobile */}
                  <details open style={{ marginBottom: 14 }}>
                    <summary style={{ padding: '8px 0', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, listStyle: 'none', WebkitAppearance: 'none', borderBottom: `1px solid ${C.border}`, paddingBottom: 10, marginBottom: 10 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>Identity & Handicap</span>
                      <span style={{ fontSize: 11, color: C.textMuted }}>{playerInfo.name || 'Not set'} · HCP {playerInfo.handicap}</span>
                    </summary>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
                      {[['Name','name','Player name'],['Handicap Index','handicap','e.g. 4.2'],['GHIN number','ghin','Optional — for lookup']].map(([l2,k,ph]) => (
                        <div key={k}>
                          <label style={lbl}>{l2}</label>
                          <input style={inp} value={playerInfo[k]} onChange={e => setPlayerInfo({ ...playerInfo, [k]: e.target.value })} placeholder={ph} />
                        </div>
                      ))}
                    </div>
                    <p style={{ fontSize: 11, color: C.textFaint, margin: '8px 0 0' }}>
                      Handicap Index is a USGA/GHIN portable number (e.g. 4.2). Course Handicap is auto-calculated when a course is loaded.
                    </p>
                  </details>

                  {/* Shot profile section - collapsible */}
                  <details open style={{ marginBottom: 14 }}>
                    <summary style={{ padding: '8px 0', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, listStyle: 'none', WebkitAppearance: 'none', borderBottom: `1px solid ${C.border}`, paddingBottom: 10, marginBottom: 10 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>Shot Profile</span>
                      <span style={{ fontSize: 11, color: C.textMuted }}>{playerInfo.handedness || 'Right'}-handed · {playerInfo.ballFlight}</span>
                    </summary>
                    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: 10 }}>
                      <div>
                        <label style={lbl}>Handedness</label>
                        <select style={inp} value={playerInfo.handedness || 'Right'} onChange={e => setPlayerInfo({ ...playerInfo, handedness: e.target.value })}>
                          {['Right','Left'].map(o => <option key={o}>{o}</option>)}
                        </select>
                      </div>
                      <div>
                        <label style={lbl}>Typical miss</label>
                        <select style={inp} value={playerInfo.miss} onChange={e => setPlayerInfo({ ...playerInfo, miss: e.target.value })}>
                          {['Left','Right','Both (fade misses right under pressure)','Low and left','Thin / right'].map(o => <option key={o}>{o}</option>)}
                        </select>
                      </div>
                      <div>
                        <label style={lbl}>Ball flight</label>
                        <select style={inp} value={playerInfo.ballFlight} onChange={e => setPlayerInfo({ ...playerInfo, ballFlight: e.target.value })}>
                          {['Fade','Draw','Straight','Slight fade','Slight draw'].map(o => <option key={o}>{o}</option>)}
                        </select>
                      </div>
                    </div>
                  </details>

                  {/* Goals & strengths section - collapsible */}
                  <details open={!isMobile}>
                    <summary style={{ padding: '8px 0', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, listStyle: 'none', WebkitAppearance: 'none', borderBottom: `1px solid ${C.border}`, paddingBottom: 10, marginBottom: 10 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>Goals, Strengths & Notes</span>
                      <span style={{ fontSize: 11, color: C.textMuted }}>Fed directly into AI strategy</span>
                    </summary>
                    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10 }}>
                      <div>
                        <label style={lbl}>Goals</label>
                        <textarea style={{ ...inp, height: 68, resize: 'vertical' }} value={playerInfo.goals || ''}
                          onChange={e => setPlayerInfo({ ...playerInfo, goals: e.target.value })}
                          placeholder="e.g. Stop leaking shots on par 3s, hold my game together on back 9 in tournaments..." />
                      </div>
                      <div>
                        <label style={lbl}>Strengths</label>
                        <textarea style={{ ...inp, height: 68, resize: 'vertical' }} value={playerInfo.strengths || ''}
                          onChange={e => setPlayerInfo({ ...playerInfo, strengths: e.target.value })}
                          placeholder="e.g. Reliable iron player, strong lag putter, good SW from 80y..." />
                      </div>
                    </div>
                    <div style={{ marginTop: 10 }}>
                      <label style={lbl}>Swing notes</label>
                      <textarea style={{ ...inp, height: 56, resize: 'vertical' }} value={playerInfo.swingNotes}
                        onChange={e => setPlayerInfo({ ...playerInfo, swingNotes: e.target.value })}
                        placeholder="e.g. Gets steep under pressure, slight over-the-top move, left miss when tired on driver..." />
                    </div>
                  </details>
                </div>
              </div>
            )}

            {/* ── Club Distances sub-tab ── */}
            {playerSubTab === 'clubs' && (
              <div style={card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, flexWrap: 'wrap', gap: 8 }}>
                  <p style={{ ...lbl, margin: 0 }}>Club distances</p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11, color: C.textFaint }}>Saved automatically</span>
                    <button style={{ ...btnG, fontSize: 11, padding: '4px 10px' }}
                      onClick={() => setClubs(c => [...c, { club: 'New club', carry: '', shape: 'Straight' }])}>
                      + Add club
                    </button>
                    <button style={{ ...btnG, fontSize: 11, padding: '4px 10px' }}
                      onClick={() => { if (window.confirm('Reset bag to defaults?')) { setClubs(DEFAULT_CLUBS); setExpandedClubs({}) } }}>
                      Reset
                    </button>
                  </div>
                </div>
                {isMobile ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
                    {clubs.map((c, i) => (
                      <details key={i} style={{ background: C.bgInput, border: `1px solid ${C.border}`, borderRadius: 8 }}>
                        <summary style={{ padding: '10px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', listStyle: 'none', WebkitAppearance: 'none' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontSize: 13, fontWeight: 500, color: C.text }}>{c.club}</span>
                            <span style={{ fontSize: 12, color: C.accent, fontWeight: 600 }}>{c.carry}y</span>
                            <span style={{ fontSize: 11, color: C.textFaint }}>{c.shape}</span>
                          </div>
                          <button onClick={e => { e.preventDefault(); setClubs(clubs.filter((_, j) => j !== i)) }}
                            style={{ background: 'none', border: 'none', color: C.textFaint, cursor: 'pointer', fontSize: 15, padding: 0 }}>×</button>
                        </summary>
                        <div style={{ padding: '8px 12px 12px', borderTop: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <input style={{ ...inp, padding: '6px 10px', fontSize: 13 }} value={c.club} placeholder="Club name"
                            onChange={e => setClubs(clubs.map((cl, j) => j === i ? { ...cl, club: e.target.value } : cl))} />
                          <div style={{ display: 'flex', gap: 6 }}>
                            <input type="number" style={{ ...inp, padding: '6px 10px', fontSize: 13, flex: 1 }} value={c.carry} placeholder="Carry (yds)"
                              onChange={e => setClubs(clubs.map((cl, j) => j === i ? { ...cl, carry: e.target.value } : cl))} />
                            <select style={{ ...inp, padding: '6px 10px', fontSize: 13, flex: 1 }} value={c.shape}
                              onChange={e => setClubs(clubs.map((cl, j) => j === i ? { ...cl, shape: e.target.value } : cl))}>
                              {['Fade','Draw','Straight','Slight fade','Slight draw'].map(s => <option key={s}>{s}</option>)}
                            </select>
                          </div>
                        </div>
                      </details>
                    ))}
                  </div>
                ) : (<>
                <div style={{ display: 'grid', gridTemplateColumns: '24px 2fr 1fr 1.5fr 24px', gap: '5px 10px', marginBottom: 6, marginTop: 12 }}>
                  {['','Club','Carry (yds)','Shot shape',''].map((h, i) => <span key={i} style={{ fontSize: 10, color: C.textFaint, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{h}</span>)}
                </div>
                {clubs.map((c, i) => {
                  const isOpen = !!expandedClubs[i]
                  const analyticsInp = { ...inp, padding: '4px 6px', fontSize: 12 }
                  return (
                    <div key={i} style={{ marginBottom: 4 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '24px 2fr 1fr 1.5fr 24px', gap: '4px 10px', alignItems: 'center' }}>
                        <button
                          onClick={() => setExpandedClubs(prev => ({ ...prev, [i]: !prev[i] }))}
                          style={{ background: 'none', border: 'none', color: C.textFaint, cursor: 'pointer', fontSize: 10, padding: 0, textAlign: 'center', transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}
                          title="Expand analytics"
                        >▼</button>
                        <input style={{ ...inp, padding: '5px 8px', fontSize: 13 }} value={c.club}
                          onChange={e => setClubs(clubs.map((cl, j) => j === i ? { ...cl, club: e.target.value } : cl))} />
                        <input type="number" style={{ ...inp, textAlign: 'center', padding: '5px 8px' }} value={c.carry}
                          onChange={e => setClubs(clubs.map((cl, j) => j === i ? { ...cl, carry: e.target.value } : cl))} />
                        <select style={{ ...inp, padding: '5px 8px' }} value={c.shape}
                          onChange={e => setClubs(clubs.map((cl, j) => j === i ? { ...cl, shape: e.target.value } : cl))}>
                          {['Fade','Draw','Straight','Slight fade','Slight draw'].map(s => <option key={s}>{s}</option>)}
                        </select>
                        <button
                          onClick={() => { setClubs(clubs.filter((_, j) => j !== i)); setExpandedClubs(prev => { const n = {}; Object.keys(prev).forEach(k => { if (Number(k) < i) n[k] = prev[k]; else if (Number(k) > i) n[Number(k)-1] = prev[k] }); return n }) }}
                          style={{ background: 'none', border: 'none', color: C.textFaint, cursor: 'pointer', fontSize: 15, padding: 0, textAlign: 'center' }}
                          title="Remove club"
                        >×</button>
                      </div>
                      {isOpen && (
                        <div style={{ marginLeft: 34, marginTop: 4, marginBottom: 6, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: '4px 8px' }}>
                          {[
                            { key: 'ballSpeed',   label: 'Ball speed (mph)', placeholder: '158' },
                            { key: 'launchAngle', label: 'Launch angle (°)',  placeholder: '10.5' },
                            { key: 'spinRate',    label: 'Spin rate (rpm)',   placeholder: '2600' },
                            { key: 'dispLeft',    label: 'Left disp. (yd)',   placeholder: '12' },
                            { key: 'dispRight',   label: 'Right disp. (yd)', placeholder: '8' },
                          ].map(({ key, label, placeholder }) => (
                            <div key={key}>
                              <div style={{ fontSize: 9, color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 2 }}>{label}</div>
                              <input type="number" style={analyticsInp} placeholder={placeholder} value={c[key] || ''}
                                onChange={e => setClubs(clubs.map((cl, j) => j === i ? { ...cl, [key]: e.target.value } : cl))} />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
                </>)}
              </div>
            )}

            {/* ── Data Import sub-tab ── */}
            {playerSubTab === 'import' && (
              <ImportTab clubs={clubs} setClubs={setClubs} C={C} card={card} inp={inp} lbl={lbl} btnP={btnP} btnG={btnG} />
            )}

            {/* ── Scoring History sub-tab ── */}
            {playerSubTab === 'scoring' && (
              <div>
                <div style={{ ...card, marginBottom: 12, borderColor: C.accentMuted }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
                    <p style={{ fontSize: 13, color: C.textMuted, margin: 0, lineHeight: 1.6, maxWidth: 600 }}>
                      Enter your most recent competitive and practice rounds. Claude identifies scoring patterns
                      and adjusts today's target and strategy accordingly.
                    </p>
                    <button style={{ ...btnG, whiteSpace: 'nowrap', flexShrink: 0 }}
                      onClick={() => setScoringHistory(h => [...h, { course: '', location: '', date: '', score: '', par: 72, toPar: '', roundType: 'Tournament', conditions: '', notes: '' }])}>
                      + Add round
                    </button>
                  </div>

                  {scoringHistory.length === 0 ? (
                    <p style={{ fontSize: 12, color: C.textFaint, fontStyle: 'italic', textAlign: 'center', padding: '1rem 0' }}>
                      No rounds yet — hit "+ Add round" to start tracking scoring history.
                    </p>
                  ) : isMobile ? (
                    /* Mobile scoring history - same as before */
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {scoringHistory.map((r, i) => {
                        const hs = historySearch[i] || {}
                        return (
                          <div key={i} style={{ background: C.bgInput, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px' }}>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                              <input style={{ ...inp, flex: 1, padding: '6px 10px', fontSize: 13 }} value={r.course}
                                onChange={e => setScoringHistory(h => h.map((rr, j) => j === i ? { ...rr, course: e.target.value } : rr))}
                                placeholder="Course name" />
                              <button style={{ background: 'transparent', border: 'none', color: C.textFaint, cursor: 'pointer', fontSize: 18, padding: '2px 6px', flexShrink: 0 }}
                                onClick={() => setScoringHistory(h => h.filter((_, j) => j !== i))} title="Remove">×</button>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 8px', marginBottom: 8 }}>
                              <div><label style={lbl}>City / State</label><input style={{ ...inp, padding: '5px 8px', fontSize: 12 }} value={r.location} onChange={e => setScoringHistory(h => h.map((rr, j) => j === i ? { ...rr, location: e.target.value } : rr))} placeholder="City, ST" /></div>
                              <div><label style={lbl}>Date</label><input type="date" style={{ ...inp, padding: '5px 8px', fontSize: 12 }} value={r.date} onChange={e => setScoringHistory(h => h.map((rr, j) => j === i ? { ...rr, date: e.target.value } : rr))} /></div>
                              <div><label style={lbl}>Score</label><input type="number" style={{ ...inp, padding: '5px 8px', fontSize: 12 }} value={r.score} onChange={e => { const score = e.target.value; setScoringHistory(h => h.map((rr, j) => j === i ? { ...rr, score, toPar: !rr.toPar || rr.toPar === toParStr(rr.score, rr.par || 72) ? toParStr(score, rr.par || 72) : rr.toPar } : rr)) }} placeholder="70" /></div>
                              <div><label style={lbl}>+/- vs par</label><input style={{ ...inp, padding: '5px 8px', fontSize: 12 }} value={r.toPar} onChange={e => setScoringHistory(h => h.map((rr, j) => j === i ? { ...rr, toPar: e.target.value } : rr))} placeholder="E" /></div>
                              <div><label style={lbl}>Round type</label><select style={{ ...inp, padding: '5px 6px', fontSize: 12 }} value={r.roundType || ''} onChange={e => setScoringHistory(h => h.map((rr, j) => j === i ? { ...rr, roundType: e.target.value } : rr))}><option value="">Type</option>{['Tournament','Qualifier','Stroke play','Match play','Practice round','Casual'].map(o => <option key={o}>{o}</option>)}</select></div>
                              <div><label style={lbl}>Conditions</label><select style={{ ...inp, padding: '5px 6px', fontSize: 12 }} value={r.conditions} onChange={e => setScoringHistory(h => h.map((rr, j) => j === i ? { ...rr, conditions: e.target.value } : rr))}><option value="">Conditions</option>{['Normal','Firm & fast','Soft','Windy','Hot & dry','Wet'].map(o => <option key={o}>{o}</option>)}</select></div>
                            </div>
                            <div style={{ marginBottom: 8 }}>
                              <label style={lbl}>Notes</label>
                              <input style={{ ...inp, padding: '5px 8px', fontSize: 12 }} value={r.notes} onChange={e => setScoringHistory(h => h.map((rr, j) => j === i ? { ...rr, notes: e.target.value } : rr))} placeholder="Drove it well, 3-putted twice..." />
                            </div>
                            {r.courseData ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontSize: 11, color: C.green }}>⛳ {r.courseData.name} linked</span>
                                <button style={{ background: 'none', border: 'none', color: C.red, fontSize: 10, cursor: 'pointer', padding: 0 }}
                                  onClick={() => setScoringHistory(h => h.map((rr, j) => j === i ? { ...rr, courseData: null } : rr))}>remove</button>
                              </div>
                            ) : (
                              <div>
                                {!hs.open ? (
                                  <button style={{ ...btnG, fontSize: 10, padding: '4px 10px' }} onClick={() => updateHS(i, { open: true, query: r.course || '', results: [], error: '' })}>+ Link scorecard</button>
                                ) : (
                                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                                    <input style={{ ...inp, fontSize: 12, padding: '3px 8px', flex: 1, minWidth: 120 }} placeholder="Search course name..." value={hs.query || ''} onChange={e => updateHS(i, { query: e.target.value })} onKeyDown={e => e.key === 'Enter' && historySearchCourse(i, hs.query)} />
                                    <button style={{ ...btnP, fontSize: 11, padding: '4px 12px' }} onClick={() => historySearchCourse(i, hs.query)}>{hs.loading ? '...' : 'Search'}</button>
                                    <button style={{ ...btnG, fontSize: 10, padding: '3px 8px' }} onClick={() => updateHS(i, { open: false })}>Cancel</button>
                                    {hs.error && <span style={{ fontSize: 11, color: C.red }}>{hs.error}</span>}
                                  </div>
                                )}
                                {(hs.results || []).length > 0 && (
                                  <div style={{ marginTop: 4, background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 6, overflow: 'hidden' }}>
                                    {hs.results.slice(0, 5).map((r2, k) => (
                                      <button key={k} style={{ display: 'block', width: '100%', background: 'none', border: 'none', borderBottom: `1px solid ${C.border}`, color: C.text, textAlign: 'left', padding: '8px 10px', fontSize: 12, cursor: 'pointer', fontFamily: F }}
                                        onClick={() => attachCourseToRound(i, r2)}>
                                        {r2.course_name || r2.name} {r2.location ? `— ${r2.location}` : ''}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    /* Desktop scoring history - same as before */
                    <div style={{ overflowX: 'auto' }}>
                      <div style={{ minWidth: 740 }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '140px 90px 105px 46px 40px 40px 105px 105px 1fr 28px', gap: '4px 8px', marginBottom: 6 }}>
                          {['Course','City / State','Date','Score','Par','+/-','Round type','Conditions','Notes',''].map((h, i) =>
                            <span key={i} style={{ fontSize: 10, color: C.textFaint, letterSpacing: '0.07em', textTransform: 'uppercase' }}>{h}</span>
                          )}
                        </div>
                        {scoringHistory.map((r, i) => (
                          <div key={i} style={{ marginBottom: 6 }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '140px 90px 105px 46px 40px 40px 105px 105px 1fr 28px', gap: '3px 8px', alignItems: 'center' }}>
                            <input style={{ ...inp, padding: '4px 8px', fontSize: 12 }} value={r.course} onChange={e => setScoringHistory(h => h.map((rr, j) => j === i ? { ...rr, course: e.target.value } : rr))} placeholder="Course name" />
                            <input style={{ ...inp, padding: '4px 8px', fontSize: 12 }} value={r.location} onChange={e => setScoringHistory(h => h.map((rr, j) => j === i ? { ...rr, location: e.target.value } : rr))} placeholder="City, ST" />
                            <input type="date" style={{ ...inp, padding: '4px 8px', fontSize: 12 }} value={r.date} onChange={e => setScoringHistory(h => h.map((rr, j) => j === i ? { ...rr, date: e.target.value } : rr))} />
                            <input type="number" style={{ ...inp, padding: '4px 6px', fontSize: 12, textAlign: 'center' }} value={r.score} onChange={e => { const score = e.target.value; setScoringHistory(h => h.map((rr, j) => j === i ? { ...rr, score, toPar: !rr.toPar || rr.toPar === toParStr(rr.score, rr.par || 72) ? toParStr(score, rr.par || 72) : rr.toPar } : rr)) }} placeholder="70" />
                            <input type="number" style={{ ...inp, padding: '4px 6px', fontSize: 12, textAlign: 'center' }} value={r.par ?? 72} onChange={e => { const par = Number(e.target.value) || 72; setScoringHistory(h => h.map((rr, j) => j === i ? { ...rr, par, toPar: rr.score ? toParStr(rr.score, par) : rr.toPar } : rr)) }} placeholder="72" />
                            <input style={{ ...inp, padding: '4px 6px', fontSize: 12, textAlign: 'center' }} value={r.toPar} onChange={e => setScoringHistory(h => h.map((rr, j) => j === i ? { ...rr, toPar: e.target.value } : rr))} placeholder="E" />
                            <select style={{ ...inp, padding: '4px 6px', fontSize: 12 }} value={r.roundType || ''} onChange={e => setScoringHistory(h => h.map((rr, j) => j === i ? { ...rr, roundType: e.target.value } : rr))}><option value="">Type</option>{['Tournament','Qualifier','Stroke play','Match play','Practice round','Casual'].map(o => <option key={o}>{o}</option>)}</select>
                            <select style={{ ...inp, padding: '4px 6px', fontSize: 12 }} value={r.conditions} onChange={e => setScoringHistory(h => h.map((rr, j) => j === i ? { ...rr, conditions: e.target.value } : rr))}><option value="">Conditions</option>{['Normal','Firm & fast','Soft','Windy','Hot & dry','Wet'].map(o => <option key={o}>{o}</option>)}</select>
                            <input style={{ ...inp, padding: '4px 8px', fontSize: 12 }} value={r.notes} onChange={e => setScoringHistory(h => h.map((rr, j) => j === i ? { ...rr, notes: e.target.value } : rr))} placeholder="Drove it well, 3-putted twice..." />
                            <button style={{ background: 'transparent', border: 'none', color: C.textFaint, cursor: 'pointer', fontSize: 16, padding: '2px 4px' }} onClick={() => setScoringHistory(h => h.filter((_, j) => j !== i))} title="Remove">×</button>
                          </div>
                          {(() => {
                            const hs = historySearch[i] || {}
                            return (
                              <div style={{ marginTop: 3, marginBottom: 2 }}>
                                {r.courseData ? (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 2 }}>
                                    <span style={{ fontSize: 11, color: C.green }}>⛳ Scorecard linked: {r.courseData.name} ({r.courseData.holes?.length || 18} holes)</span>
                                    <button style={{ background: 'none', border: 'none', color: C.red, fontSize: 10, cursor: 'pointer', padding: 0 }} onClick={() => setScoringHistory(h => h.map((rr, j) => j === i ? { ...rr, courseData: null } : rr))}>remove</button>
                                  </div>
                                ) : (
                                  <div>
                                    {!hs.open ? (
                                      <button style={{ ...btnG, fontSize: 10, padding: '2px 10px' }} onClick={() => updateHS(i, { open: true, query: r.course || '', results: [], error: '' })}>+ Link scorecard</button>
                                    ) : (
                                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                                        <input style={{ ...inp, fontSize: 12, padding: '3px 8px', width: 220 }} placeholder="Search course name..." value={hs.query || ''} onChange={e => updateHS(i, { query: e.target.value })} onKeyDown={e => e.key === 'Enter' && historySearchCourse(i, hs.query)} />
                                        <button style={{ ...btnP, fontSize: 11, padding: '4px 12px' }} onClick={() => historySearchCourse(i, hs.query)}>{hs.loading ? '...' : 'Search'}</button>
                                        <button style={{ ...btnG, fontSize: 10, padding: '3px 8px' }} onClick={() => updateHS(i, { open: false })}>Cancel</button>
                                        {hs.error && <span style={{ fontSize: 11, color: C.red }}>{hs.error}</span>}
                                      </div>
                                    )}
                                    {(hs.results || []).length > 0 && (
                                      <div style={{ marginTop: 4, background: C.bgInput, border: `1px solid ${C.border}`, borderRadius: 6, overflow: 'hidden' }}>
                                        {hs.results.slice(0, 5).map((r2, k) => (
                                          <button key={k} style={{ display: 'block', width: '100%', background: 'none', border: 'none', borderBottom: `1px solid ${C.border}`, color: C.text, textAlign: 'left', padding: '6px 10px', fontSize: 12, cursor: 'pointer', fontFamily: F }}
                                            onClick={() => attachCourseToRound(i, r2)}>
                                            {r2.course_name || r2.name} {r2.location ? `— ${r2.location}` : ''}
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            )
                          })()}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Stats summary */}
                {scoringHistory.filter(r => r.score && r.toPar).length >= 2 && (() => {
                  const valid  = scoringHistory.filter(r => r.score && r.toPar)
                  const toNum  = r => r.toPar === 'E' ? 0 : parseFloat(r.toPar)
                  const scores = valid.map(toNum).filter(n => !isNaN(n))
                  if (scores.length < 2) return null
                  const avg   = (scores.reduce((a,b)=>a+b,0)/scores.length).toFixed(1)
                  const best  = Math.min(...scores)
                  const worst = Math.max(...scores)
                  const recent3 = scores.slice(-3), older3 = scores.slice(0,3)
                  const trend = recent3.length>=2 && older3.length>=2
                    ? recent3.reduce((a,b)=>a+b,0)/recent3.length < older3.reduce((a,b)=>a+b,0)/older3.length ? 'Improving' : 'Declining' : '—'
                  const fmt  = n => n===0?'E':n>0?`+${n}`:String(n)
                  const fmtF = n => n==null?'—':parseFloat(n)===0?'E':parseFloat(n)>0?`+${n}`:String(n)
                  const avgOf = arr => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : null
                  const tourNums = valid.filter(r=>r.roundType==='Tournament'||r.roundType==='Qualifier').map(toNum).filter(n=>!isNaN(n))
                  const casNums  = valid.filter(r=>r.roundType==='Casual'||r.roundType==='Practice round').map(toNum).filter(n=>!isNaN(n))
                  const statCard = (label, val, color, sub) => (
                    <div key={label} style={{ background: C.bgInput, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 14px' }}>
                      <p style={{ ...lbl, margin: '0 0 4px' }}>{label}</p>
                      <p style={{ fontSize: 20, fontWeight: 600, color, margin: 0 }}>{val}</p>
                      {sub && <p style={{ fontSize: 10, color: C.textFaint, margin: '3px 0 0' }}>{sub}</p>}
                    </div>
                  )
                  return (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10, marginBottom: 8 }}>
                        {statCard('Overall avg', fmtF(avg), C.text, `${scores.length} rounds`)}
                        {statCard('Best round',  fmt(best),  C.green)}
                        {statCard('Worst round', fmt(worst), worst>2?C.red:C.textMuted)}
                        {statCard('Recent trend', trend, trend==='Improving'?C.green:trend==='Declining'?C.amber:C.textMuted)}
                      </div>
                      {(tourNums.length>=1||casNums.length>=1) && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                          {tourNums.length>=1 && statCard('Tournament avg', fmtF(avgOf(tourNums)?.toFixed(1)), C.amber, `${tourNums.length} competitive rounds`)}
                          {casNums.length>=1  && statCard('Casual avg',     fmtF(avgOf(casNums)?.toFixed(1)),  C.textMuted, `${casNums.length} casual / practice rounds`)}
                        </div>
                      )}
                    </div>
                  )
                })()}
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            SECTION 2: ROUND PREP
            Sequential steps: Course → Tees → Scorecard → Weather → Generate
           ══════════════════════════════════════════════════════════════════ */}
        {tab === 'prep' && (
          <div>
            <SectionHead title="Round Prep" sub="Set up your round step by step" />

            {/* Step indicator */}
            <div style={{ display: 'flex', gap: 0, marginBottom: 20, overflowX: 'auto' }}>
              {PREP_STEPS.map((s, i) => {
                const isActive = prepStep === s.num
                const isDone = prepStep > s.num || (s.num === 1 && course.name) || (s.num === 2 && course.holes.some(h => h.yardage)) || (s.num === 3 && weather)
                const isClickable = s.num <= prepStep || isDone
                return (
                  <div key={s.num} style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
                    <button onClick={() => isClickable && setPrepStep(s.num)} style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                      padding: isMobile ? '8px 4px' : '10px 12px', border: 'none', cursor: isClickable ? 'pointer' : 'default',
                      background: 'transparent', fontFamily: F, flex: 1, minWidth: 0, opacity: isClickable ? 1 : 0.4,
                    }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 14, fontWeight: 600,
                        background: isActive ? C.accent : isDone ? C.greenMuted : C.bgInput,
                        color: isActive ? C.bg : isDone ? C.green : C.textMuted,
                        border: `2px solid ${isActive ? C.accent : isDone ? C.green : C.border}`,
                        transition: 'all 0.2s',
                      }}>
                        {isDone && !isActive ? '✓' : s.num}
                      </div>
                      <span style={{ fontSize: isMobile ? 9 : 11, color: isActive ? C.text : C.textMuted, fontWeight: isActive ? 600 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
                        {isMobile ? s.label.split(' ')[0] : s.label}
                      </span>
                    </button>
                    {i < PREP_STEPS.length - 1 && (
                      <div style={{ width: isMobile ? 12 : 24, height: 2, background: isDone ? C.green : C.border, flexShrink: 0 }} />
                    )}
                  </div>
                )
              })}
            </div>

            {/* Step 1: Select Course */}
            {prepStep === 1 && (
              <div>
                <CourseSearch
                  authToken={session?.access_token || ''}
                  onSelect={(r) => { applyScorecard(r); setPrepStep(2) }}
                />
                {course.name && (
                  <div style={{ ...card, marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                    <div>
                      <p style={{ fontSize: 14, fontWeight: 600, color: C.text, margin: 0 }}>{course.name}</p>
                      <p style={{ fontSize: 12, color: C.textMuted, margin: '2px 0 0' }}>{course.location} · Par {course.par} · {course.yardage ? Number(course.yardage).toLocaleString() + 'y' : ''}</p>
                    </div>
                    <button style={btnP} onClick={() => setPrepStep(2)}>Continue →</button>
                  </div>
                )}
              </div>
            )}

            {/* Step 2: Scorecard Preview, Tees & Course Details */}
            {prepStep === 2 && (
              <div>
                {course.name && course.osmEnriched && <DataAccuracyTier course={course} style={{ marginBottom: 12 }} />}
                {course.name && !course.osmEnriched && coords?.lat && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, padding: '10px 14px', background: C.bgInput, borderRadius: 10 }}>
                    <Spin /><span style={{ fontSize: 12, color: C.textMuted }}>Loading hole design data...</span>
                  </div>
                )}
                {/* Tee selector — switch tees without going back */}
                {course.tees?.length > 1 && (
                  <div style={{ ...card, marginBottom: 12 }}>
                    <p style={{ ...lbl, marginBottom: 8 }}>Playing tees</p>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {course.tees.map((t, i) => {
                        const active = course.selectedTee === t.name
                        return (
                          <button key={i} onClick={() => {
                            setCourse(prev => ({
                              ...prev,
                              selectedTee: t.name,
                              yardage: String(t.yardage || prev.yardage),
                              rating: String(t.rating || prev.rating),
                              slope: String(t.slope || prev.slope),
                              par: t.par || prev.par,
                              holes: prev.holes.map((h, hi) => ({
                                ...h,
                                yardage: String(t.holes?.[hi]?.yardage || h.yardage || ''),
                                par: t.holes?.[hi]?.par || h.par,
                                handicap: t.holes?.[hi]?.handicap || h.handicap,
                              })),
                            }))
                          }} style={{
                            background: active ? C.accentMuted : C.bgInput,
                            border: `1px solid ${active ? C.accent : C.border}`,
                            borderRadius: 8, padding: '8px 14px', cursor: 'pointer',
                            fontFamily: F, transition: 'all 0.15s',
                          }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: active ? C.accent : C.text }}>{t.name}</span>
                            <span style={{ fontSize: 11, color: active ? C.accent : C.textMuted, marginLeft: 8 }}>{Number(t.yardage).toLocaleString()}y</span>
                            {t.rating && <span style={{ fontSize: 10, color: C.textFaint, marginLeft: 6 }}>{t.rating}/{t.slope}</span>}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
                <div style={{ ...card, marginBottom: 12 }}>
                  <p style={{ ...lbl, marginBottom: 12 }}>Course details</p>
                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '2fr 1fr 1fr 1fr', gap: 10 }}>
                    <div><label style={lbl}>Course name</label><input style={inp} value={course.name} onChange={e => setCourse({ ...course, name: e.target.value })} placeholder="e.g. Rhodes Ranch Golf Club" /></div>
                    <div><label style={lbl}>City / State</label><input style={inp} value={course.location} onChange={e => setCourse({ ...course, location: e.target.value })} placeholder="Las Vegas, NV" /></div>
                    <div><label style={lbl}>Total yardage</label><input style={inp} value={course.yardage} onChange={e => setCourse({ ...course, yardage: e.target.value })} placeholder="6582" /></div>
                    <div><label style={lbl}>Rating / Slope</label><input style={inp} value={`${course.rating}${course.slope ? '/' + course.slope : ''}`} onChange={e => { const [r, s] = e.target.value.split('/'); setCourse({ ...course, rating: r?.trim(), slope: s?.trim() || course.slope }) }} placeholder="70.6 / 128" /></div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10, marginTop: 10 }}>
                    <div><label style={lbl}>Conditions</label><select style={inp} value={course.conditions} onChange={e => setCourse({ ...course, conditions: e.target.value })}>{['Normal','Firm & fast','Soft','Wet','Dry & links-like'].map(o => <option key={o}>{o}</option>)}</select></div>
                    <div><label style={lbl}>Round type</label><select style={inp} value={course.roundType} onChange={e => setCourse({ ...course, roundType: e.target.value })}>{['Stroke play tournament','Match play','Qualifier','Q School','Practice round','Casual round'].map(o => <option key={o}>{o}</option>)}</select></div>
                    <div><label style={lbl}>Target score</label><input style={inp} value={course.targetScore} onChange={e => setCourse({ ...course, targetScore: e.target.value })} placeholder="-2 (69)" /></div>
                    <div><label style={lbl}>Elevation (ft)</label><input style={inp} type="number" value={course.elevation} onChange={e => setCourse({ ...course, elevation: e.target.value })} placeholder="e.g. 4500" /></div>
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <label style={lbl}>General course notes</label>
                    <textarea style={{ ...inp, height: 56, resize: 'vertical' }} value={course.notes} onChange={e => setCourse({ ...course, notes: e.target.value })} placeholder="Green speed, firmness, key local knowledge, previous experience..." />
                  </div>
                </div>

                {course.holes && <ScorecardPreview holes={course.holes} />}

                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
                  <button style={btnG} onClick={() => setPrepStep(1)}>← Back</button>
                  <button style={btnP} onClick={() => setPrepStep(3)}>Continue →</button>
                </div>
              </div>
            )}

            {/* Step 3: Weather & Tee Time */}
            {prepStep === 3 && (
              <div>
                <WeatherPanel
                  authToken={session?.access_token || ''} course={course}
                  coords={coords} setCoords={setCoords}
                  teeTime={teeTime} setTeeTime={setTeeTime}
                  teeDate={teeDate} setTeeDate={setTeeDate}
                  pace={pace} setPace={setPace}
                  timezone={timezone}
                  weather={weather} setWeather={setWeather}
                  weatherLoading={weatherLoading} setWeatherLoading={setWeatherLoading}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
                  <button style={btnG} onClick={() => setPrepStep(2)}>← Back</button>
                  <button style={btnP} onClick={() => setPrepStep(4)}>Continue →</button>
                </div>
              </div>
            )}

            {/* Step 4: Generate Report */}
            {prepStep === 4 && (
              <div>
                {/* Summary card before generation */}
                {!plan && !planLoading && (
                  <div style={{ ...card, textAlign: 'center', padding: '2rem' }}>
                    <div style={{ fontSize: 40, marginBottom: 14 }}>⚡</div>
                    <h3 style={{ fontSize: 18, fontWeight: 600, color: C.text, margin: '0 0 8px' }}>Ready to generate your round prep report</h3>
                    {course.name ? (
                      <div style={{ marginBottom: 20 }}>
                        <p style={{ fontSize: 14, color: C.textMuted, margin: '0 0 4px' }}>{course.name} {course.selectedTee ? `(${course.selectedTee})` : ''}</p>
                        <p style={{ fontSize: 12, color: C.textFaint, margin: 0 }}>
                          Par {course.par} · {course.yardage ? Number(course.yardage).toLocaleString() + 'y' : ''} · {course.roundType}
                          {weather ? ' · Weather loaded' : ''}
                        </p>
                      </div>
                    ) : (
                      <p style={{ fontSize: 14, color: C.textMuted, margin: '0 0 20px' }}>No course loaded — Claude will analyze your player profile and scoring patterns</p>
                    )}

                    {/* Model selector inline */}
                    <div style={{ marginBottom: 20, textAlign: 'left', maxWidth: 500, margin: '0 auto 20px' }}>
                      <p style={{ ...lbl, marginBottom: 8 }}>AI Model</p>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                        {AVAILABLE_MODELS.map(m => {
                          const active = selectedModel === m.id
                          return (
                            <button key={m.id} onClick={() => setSelectedModel(m.id)} style={{
                              background: active ? C.accentMuted : C.bgInput,
                              border: `1px solid ${active ? C.accent : C.border}`,
                              borderRadius: 8, padding: '8px 12px', cursor: 'pointer', textAlign: 'left',
                              fontFamily: F, transition: 'border-color .15s',
                            }}>
                              <span style={{ fontSize: 13, fontWeight: 600, color: active ? C.accent : C.text }}>{m.name}</span>
                              <span style={{ fontSize: 10, color: C.textFaint, marginLeft: 6 }}>{m.speed}</span>
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    {enriching && (
                      <div role="status" aria-live="polite" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 16, padding: '8px 14px', background: C.blueMuted, border: `1px solid ${C.blue}33`, borderRadius: 8 }}>
                        <Spin /><span style={{ fontSize: 12, color: C.blue }}>{enrichStatus || 'Loading course data...'}</span>
                      </div>
                    )}
                    <button style={{ ...btnP, padding: '12px 32px', fontSize: 15 }} onClick={generate} aria-label="Generate round prep report">Generate Round Prep Report →</button>
                  </div>
                )}

                {/* Loading / streaming state */}
                {planLoading && (
                  <div style={{ ...card, padding: '2rem', textAlign: 'center' }}>
                    <div role="status" aria-live="polite" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 16 }}>
                      <Spin /><span style={{ fontSize: 14, color: C.textMuted }}>{planPhase || 'Generating'}...</span>
                      <button onClick={cancelGenerate} style={{ ...btnG, padding: '4px 12px', fontSize: 11, minHeight: 44, minWidth: 44 }} aria-label="Cancel generation">Cancel</button>
                    </div>
                    {plan && (
                      <div style={{ textAlign: 'left' }}>
                        {renderPlan(plan)}
                        <span style={{ display: 'inline-block', width: 7, height: 15, background: C.accent, animation: 'blink 0.8s step-end infinite', marginLeft: 2, verticalAlign: 'middle' }} />
                      </div>
                    )}
                  </div>
                )}

                {/* Completed plan display */}
                {plan && !planLoading && (<>
                  {/* Success confirmation banner */}
                  <div style={{ ...card, background: C.greenMuted, borderColor: C.green, marginBottom: 14, padding: '16px 20px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                      <div>
                        <p style={{ fontSize: 15, fontWeight: 600, color: C.green, margin: '0 0 4px' }}>Report saved to history</p>
                        <p style={{ fontSize: 12, color: C.textMuted, margin: 0 }}>{course.name || 'Profile brief'} · {new Date().toLocaleDateString()}</p>
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button style={btnP} onClick={() => { setExpandedBrief(0); setTab('history'); resetPrep() }}>View in History →</button>
                        <button style={{ ...btnG, background: C.green, color: '#fff', borderColor: C.green }} onClick={() => { resetPrep(); setTab('prep') }}>New Round Prep</button>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Badge label="Report Ready" bg={C.greenMuted} fg={C.green} />
                      <span style={{ fontSize: 13, color: C.textMuted }}>{course.name || 'Profile brief'}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button style={btnG} onClick={copyPlan}>{copied ? '✓ Copied' : 'Copy text'}</button>
                      <button style={btnG} onClick={printPlan}>Print / PDF</button>
                      <button style={btnG} onClick={generate}>↺ Regenerate</button>
                    </div>
                  </div>

                  {parsedHoles.holes.length > 0 && (
                    <div style={{ display: 'flex', gap: 4, marginBottom: 12, background: C.bgInput, borderRadius: 8, padding: 3 }}>
                      {[['companion', 'Round companion'], ['briefing', 'Full briefing']].map(([id, label]) => (
                        <button key={id} onClick={() => setPlanView(id)} style={{
                          flex: 1, padding: '8px 12px', fontSize: 12, fontWeight: 500, fontFamily: F,
                          border: 'none', borderRadius: 6, cursor: 'pointer',
                          background: planView === id ? C.accent : 'transparent',
                          color: planView === id ? C.bg : C.textMuted,
                        }}>{label}</button>
                      ))}
                    </div>
                  )}

                  {planView === 'companion' && parsedHoles.holes.length > 0 ? (
                    <div
                      onTouchStart={e => { e.currentTarget._swipeX = e.touches[0].clientX }}
                      onTouchEnd={e => {
                        const dx = e.changedTouches[0].clientX - (e.currentTarget._swipeX || 0)
                        if (Math.abs(dx) > 60) {
                          if (dx < 0 && currentHole < parsedHoles.holes.length - 1) setCurrentHole(h => h + 1)
                          if (dx > 0 && currentHole > 0) setCurrentHole(h => h - 1)
                        }
                      }}>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 12 }}>
                        {parsedHoles.holes.map((h, i) => (
                          <button key={h.num} onClick={() => setCurrentHole(i)} style={{
                            width: 36, height: 36, borderRadius: 8, border: `1px solid ${currentHole === i ? C.accent : C.border}`,
                            background: currentHole === i ? C.accentMuted : C.bgInput,
                            color: currentHole === i ? C.accent : C.textMuted,
                            fontSize: 13, fontWeight: 600, fontFamily: F, cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>{h.num}</button>
                        ))}
                      </div>
                      {(() => {
                        const holesPlayed = parsedHoles.holes.filter(h => holeScores[h.num] != null)
                        if (!holesPlayed.length && !holeScores[parsedHoles.holes[currentHole]?.num]) return null
                        const totalStrokes = holesPlayed.reduce((sum, h) => sum + (holeScores[h.num] || 0), 0)
                        const totalPar = holesPlayed.reduce((sum, h) => { const m = h.content.match(/Par\s+(\d)/i); return sum + (m ? parseInt(m[1]) : 4) }, 0)
                        const diff = totalStrokes - totalPar
                        return (
                          <div style={{ background: C.bgInput, borderRadius: 8, padding: '8px 14px', marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: diff <= 0 ? C.green : diff <= 3 ? C.amber : C.red }}>
                              {diff === 0 ? 'E' : diff > 0 ? `+${diff}` : diff} thru {holesPlayed.length}
                            </span>
                            <span style={{ fontSize: 11, color: C.textMuted }}>Strokes: {totalStrokes} · Par: {totalPar}</span>
                          </div>
                        )
                      })()}
                      <div style={card}>
                        {currentHole === 0 && parsedHoles.preamble && <div style={{ marginBottom: 16, paddingBottom: 12, borderBottom: `1px solid ${C.border}` }}>{renderPlan(parsedHoles.preamble)}</div>}
                        {renderPlan(parsedHoles.holes[currentHole]?.content || '')}
                        {(() => {
                          const num = parsedHoles.holes[currentHole]?.num
                          if (num == null || !coords?.lat) return null
                          // Always render the satellite map when we have course coords. It
                          // boots independently of OSM (which can be slow / absent), and
                          // overlays/distances appear as soon as geojson lands. Banner copy
                          // inside CourseHoleMap handles the "no geometry" honest message.
                          return (
                            <CourseHoleMap
                              courseName={course.name}
                              coords={coords}
                              geojson={displayGeo.geojson}
                              bboxByHole={displayGeo.bboxByHole}
                              coverage={course?.coverage}
                              tier={course?.tier}
                              holes={parsedHoles.holes}
                              selectedHole={num}
                              onSelectHole={(n) => {
                                const idx = parsedHoles.holes.findIndex(h => h.num === n)
                                if (idx >= 0) setCurrentHole(idx)
                              }}
                              onContribute={handleHoleContribution}
                              contributedHoles={contributedHoleSet}
                            />
                          )
                        })()}
                        <GreenView green={parsedHoles.holes[currentHole]?.green} holeNum={parsedHoles.holes[currentHole]?.num} />
                        {(() => {
                          const hNum = parsedHoles.holes[currentHole]?.num; if (!hNum) return null
                          const parMatch = (parsedHoles.holes[currentHole]?.content || '').match(/Par\s+(\d)/i)
                          const par = parMatch ? parseInt(parMatch[1]) : 4; const score = holeScores[hNum]
                          return (
                            <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 12, paddingTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <span style={{ fontSize: 12, color: C.textMuted, fontWeight: 500 }}>Score (par {par})</span>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <button onClick={() => setScore(hNum, (score || par) - 1)} style={{ width: 32, height: 32, borderRadius: 8, border: `1px solid ${C.border}`, background: C.bgInput, color: C.text, fontSize: 16, fontFamily: F, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                                <span style={{ width: 36, textAlign: 'center', fontSize: 18, fontWeight: 700, fontFamily: F, color: score == null ? C.textFaint : score < par ? C.green : score === par ? C.text : score === par + 1 ? C.amber : C.red }}>{score ?? '–'}</span>
                                <button onClick={() => setScore(hNum, (score || par) + 1)} style={{ width: 32, height: 32, borderRadius: 8, border: `1px solid ${C.border}`, background: C.bgInput, color: C.text, fontSize: 16, fontFamily: F, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                                {score != null && <span style={{ fontSize: 11, color: score < par ? C.green : score === par ? C.textMuted : C.red, minWidth: 40 }}>{score < par ? `${score - par}` : score === par ? 'Par' : `+${score - par}`}</span>}
                              </div>
                            </div>
                          )
                        })()}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, gap: 8 }}>
                        <button style={{ ...btnG, flex: 1, opacity: currentHole === 0 ? 0.4 : 1, textAlign: 'center' }} disabled={currentHole === 0} onClick={() => setCurrentHole(h => Math.max(0, h - 1))}>← Hole {parsedHoles.holes[currentHole - 1]?.num || ''}</button>
                        <button style={{ ...btnG, flex: 1, opacity: currentHole >= parsedHoles.holes.length - 1 ? 0.4 : 1, textAlign: 'center' }} disabled={currentHole >= parsedHoles.holes.length - 1} onClick={() => setCurrentHole(h => Math.min(parsedHoles.holes.length - 1, h + 1))}>Hole {parsedHoles.holes[currentHole + 1]?.num || ''} →</button>
                      </div>
                      {parsedHoles.postamble.trim() && <div style={{ ...card, marginTop: 12 }}>{renderPlan(parsedHoles.postamble)}</div>}
                    </div>
                  ) : parsedHoles.holes.length > 0 ? (
                    <div>
                      {parsedHoles.preamble.trim() && <div style={{ ...card, marginBottom: 12 }}>{renderPlan(parsedHoles.preamble)}</div>}
                      {parsedHoles.holes.map((h) => (
                        <div key={h.num} style={{ ...card, marginBottom: 12 }}>
                          {renderPlan(h.content)}
                          <GreenView green={h.green} holeNum={h.num} />
                        </div>
                      ))}
                      {parsedHoles.postamble.trim() && <div style={{ ...card, marginTop: 0 }}>{renderPlan(parsedHoles.postamble)}</div>}
                    </div>
                  ) : (
                    <div style={card}>
                      {renderPlan(plan)}
                    </div>
                  )}
                </>)}

                {planError && (
                  <div style={{ ...card, borderColor: C.red, marginTop: 12 }}>
                    <p style={{ color: C.red, fontSize: 13, margin: 0 }}>⚠ {planError}</p>
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: 16 }}>
                  <button style={btnG} onClick={() => setPrepStep(3)}>← Back</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            SECTION 3: HISTORY
            Saved round prep reports with notes, delete confirmation, dates
           ══════════════════════════════════════════════════════════════════ */}
        {tab === 'history' && (
          <div>
            <SectionHead title="History" sub="Your saved round prep reports and notes" />

            {savedBriefs.length === 0 ? (
              <div style={{ ...card, textAlign: 'center', padding: '3rem 2rem' }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
                <p style={{ fontSize: 16, color: C.textMuted, margin: '0 0 8px' }}>No saved reports yet</p>
                <p style={{ fontSize: 12, color: C.textFaint, margin: '0 0 20px' }}>Round prep reports are saved automatically when generated.</p>
                <button style={btnP} onClick={() => { setTab('prep'); setPrepStep(1) }}>Start Round Prep →</button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {savedBriefs.map((b, i) => {
                  const confirmState = deleteConfirm[i]
                  const noteKey = b.id || `local-${i}`
                  const note = briefNotes[noteKey] ?? (b.notes || '')
                  return (
                    <div key={b.id || i} style={{ ...card, borderColor: expandedBrief === i ? C.accent : C.border }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                            <span style={{ fontSize: 15, fontWeight: 600, color: C.text }}>{b.course}</span>
                            {b.tee && <Badge label={b.tee} bg={C.accentMuted} fg={C.accent} />}
                          </div>
                          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 12, color: C.textMuted }}>Generated: {b.date || 'Unknown date'}</span>
                            {b.plan && <span style={{ fontSize: 11, color: C.textFaint }}>{(b.plan.match(/###?\s*Hole/gi) || []).length} holes covered</span>}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <button style={{ ...btnP, padding: '6px 14px', fontSize: 12 }}
                            onClick={() => setExpandedBrief(expandedBrief === i ? null : i)}>
                            {expandedBrief === i ? 'Collapse' : 'View Report'}
                          </button>
                          {/* Multi-step delete */}
                          {!confirmState ? (
                            <button style={{ ...btnG, color: C.red, borderColor: C.red, padding: '6px 14px', fontSize: 12 }}
                              onClick={() => setDeleteConfirm(prev => ({ ...prev, [i]: 'first' }))}>
                              Delete
                            </button>
                          ) : confirmState === 'first' ? (
                            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                              <span style={{ fontSize: 11, color: C.red, fontWeight: 600 }}>Are you sure?</span>
                              <button style={{ ...btnG, color: C.red, borderColor: C.red, padding: '4px 10px', fontSize: 11 }}
                                onClick={() => setDeleteConfirm(prev => ({ ...prev, [i]: 'final' }))}>
                                Yes, delete
                              </button>
                              <button style={{ ...btnG, padding: '4px 10px', fontSize: 11 }}
                                onClick={() => setDeleteConfirm(prev => { const n = { ...prev }; delete n[i]; return n })}>
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                              <span style={{ fontSize: 11, color: C.red, fontWeight: 600 }}>This cannot be undone!</span>
                              <button style={{ background: C.red, color: '#fff', border: 'none', borderRadius: 6, padding: '4px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: F }}
                                onClick={() => {
                                  setSavedBriefs(prev => prev.filter((_, j) => j !== i))
                                  if (b.id && user) deleteSavedPlan(b.id).catch(() => {})
                                  try { const ls = JSON.parse(localStorage.getItem('golf_saved_briefs') || '[]'); ls.splice(i, 1); localStorage.setItem('golf_saved_briefs', JSON.stringify(ls)) } catch {}
                                  setDeleteConfirm(prev => { const n = { ...prev }; delete n[i]; return n })
                                }}>
                                Permanently delete
                              </button>
                              <button style={{ ...btnG, padding: '4px 10px', fontSize: 11 }}
                                onClick={() => setDeleteConfirm(prev => { const n = { ...prev }; delete n[i]; return n })}>
                                Cancel
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Expanded report view */}
                      {expandedBrief === i && b.plan && (
                        <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 12, marginBottom: 12 }}>
                          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                            <button style={btnG} onClick={() => { navigator.clipboard.writeText(b.plan); setCopied(true); setTimeout(() => setCopied(false), 2000) }}>{copied ? '✓ Copied' : 'Copy text'}</button>
                            <button style={btnG} onClick={() => { setPlan(b.plan); setTab('prep'); setPrepStep(4) }}>Open in Prep →</button>
                          </div>
                          <div style={{ background: C.bgInput, borderRadius: 10, padding: '16px 20px', maxHeight: 500, overflowY: 'auto' }}>
                            {renderPlan(b.plan)}
                          </div>
                        </div>
                      )}

                      {/* Notes for refining AI */}
                      <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
                        <label style={{ ...lbl, marginBottom: 6 }}>Notes for AI refinement</label>
                        <textarea
                          style={{ ...inp, height: 48, resize: 'vertical', fontSize: 12 }}
                          value={note}
                          onChange={e => {
                            const val = e.target.value
                            setBriefNotes(prev => ({ ...prev, [noteKey]: val }))
                          }}
                          onBlur={() => {
                            setSavedBriefs(prev => prev.map((bb, j) => j === i ? { ...bb, notes: note } : bb))
                            try { const ls = JSON.parse(localStorage.getItem('golf_saved_briefs') || '[]'); if (ls[i]) { ls[i].notes = note; localStorage.setItem('golf_saved_briefs', JSON.stringify(ls)) } } catch {}
                          }}
                          placeholder="e.g. Strategy on hole 7 was wrong — there's water short left. The wind was stronger than forecasted. Club suggestions were one club too long..."
                        />
                        <p style={{ fontSize: 10, color: C.textFaint, margin: '4px 0 0' }}>
                          These notes help refine future recommendations for this course.
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ── SETTINGS / ADMIN ── */}
        {tab === 'admin' && (() => {
          const cache = loadCourseCache()
          const entries = Object.values(cache).sort((a, b) => (b._cachedAt || 0) - (a._cachedAt || 0))

          const acctAction = async (fn) => {
            setAcctLoading(true); setAcctMsg(null)
            try {
              await fn()
            } catch (e) {
              setAcctMsg({ type: 'err', text: e.message })
            } finally {
              setAcctLoading(false)
            }
          }

          const handleChangePassword = () => acctAction(async () => {
            if (acctNewPass.length < 8) throw new Error('Password must be at least 8 characters.')
            if (acctNewPass !== acctConfirmPass) throw new Error('Passwords do not match.')
            const { error } = await supabase.auth.updateUser({ password: acctNewPass })
            if (error) throw error
            setAcctMsg({ type: 'ok', text: 'Password updated successfully.' })
            setAcctNewPass(''); setAcctConfirmPass(''); setAcctSection(null)
          })

          const handleChangeEmail = () => acctAction(async () => {
            if (!acctNewEmail || !acctNewEmail.includes('@')) throw new Error('Enter a valid email address.')
            const { error } = await supabase.auth.updateUser({ email: acctNewEmail })
            if (error) throw error
            setAcctMsg({ type: 'ok', text: 'Confirmation sent to your new email. Check your inbox.' })
            setAcctNewEmail(''); setAcctSection(null)
          })

          const handleDeleteAccount = () => acctAction(async () => {
            const authToken = session?.access_token || ''
            const res = await fetch('/api/delete-account', {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
            })
            if (!res.ok) {
              const d = await res.json().catch(() => ({}))
              throw new Error(d.error || `Request failed (${res.status})`)
            }
            await supabase.auth.signOut()
            if (onSignOut) onSignOut()
          })

          const loadAdminUsers = async () => {
            setAdminUsersLoading(true); setAdminUsersError(''); setAdminDeleteMsg(''); setAdminGrantMsg('')
            const authToken = session?.access_token || ''
            try {
              const res = await fetch('/api/admin-users', { headers: { Authorization: `Bearer ${authToken}` } })
              if (!res.ok) {
                const d = await res.json().catch(() => ({}))
                throw new Error(d.error || `${res.status}`)
              }
              setAdminUsers(await res.json())
            } catch (e) {
              setAdminUsersError(e.message)
            }
            setAdminUsersLoading(false)
          }

          const handleDeleteUser = async (userId, email) => {
            if (!window.confirm(`Permanently delete user ${email}? This cannot be undone.`)) return
            setAdminDeleteMsg('')
            const authToken = session?.access_token || ''
            try {
              const res = await fetch('/api/admin-users', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
                body: JSON.stringify({ userId }),
              })
              if (!res.ok) {
                const d = await res.json().catch(() => ({}))
                throw new Error(d.error || `${res.status}`)
              }
              setAdminDeleteMsg(`Deleted ${email}`)
              setAdminUsers(prev => prev ? prev.filter(u => u.id !== userId) : prev)
            } catch (e) {
              setAdminDeleteMsg(`Error: ${e.message}`)
            }
          }

          const sectionHead = (title, sub) => (
            <div style={{ marginBottom: 14 }}>
              <h3 style={{ fontSize: 15, fontWeight: 600, color: C.text, margin: 0 }}>{title}</h3>
              {sub && <p style={{ fontSize: 12, color: C.textMuted, margin: '3px 0 0' }}>{sub}</p>}
            </div>
          )

          return (
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 600, color: C.text, margin: '0 0 20px' }}>Settings</h2>

              {/* ── Account ── */}
              <div style={{ ...card, marginBottom: 16 }}>
                {sectionHead('Your account')}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <p style={{ fontSize: 13, color: C.textMuted, margin: 0 }}>Signed in as</p>
                    <p style={{ fontSize: 14, fontWeight: 600, color: C.text, margin: '2px 0 0' }}>{user?.email}</p>
                  </div>
                  <button style={{ ...btnG, color: C.red, borderColor: C.red }}
                    onClick={async () => {
                      if (window.confirm('Sign out of Golf Strategy Engine?')) {
                        await supabase.auth.signOut()
                        if (onSignOut) onSignOut()
                      }
                    }}>
                    Sign out
                  </button>
                </div>

                {acctMsg && (
                  <div style={{ padding: '8px 12px', borderRadius: 8, marginBottom: 12, fontSize: 13,
                    background: acctMsg.type === 'ok' ? C.greenMuted : C.redMuted,
                    border: `1px solid ${acctMsg.type === 'ok' ? C.green : C.red}`,
                    color: acctMsg.type === 'ok' ? C.green : C.red,
                  }}>{acctMsg.text}</div>
                )}

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button style={btnG} onClick={() => { setAcctSection(acctSection === 'password' ? null : 'password'); setAcctMsg(null) }}>
                    Change password
                  </button>
                  <button style={btnG} onClick={() => { setAcctSection(acctSection === 'email' ? null : 'email'); setAcctMsg(null) }}>
                    Change email
                  </button>
                  <button style={{ ...btnG, color: C.red, borderColor: C.red, marginLeft: 'auto' }}
                    onClick={() => { setAcctSection(acctSection === 'delete' ? null : 'delete'); setAcctMsg(null) }}>
                    Delete account
                  </button>
                </div>

                {acctSection === 'password' && (
                  <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
                    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10, marginBottom: 10 }}>
                      <div>
                        <label style={lbl}>New password</label>
                        <input type="password" style={inp} placeholder="8+ characters" value={acctNewPass}
                          onChange={e => setAcctNewPass(e.target.value)} autoFocus />
                      </div>
                      <div>
                        <label style={lbl}>Confirm new password</label>
                        <input type="password" style={inp} placeholder="Repeat password" value={acctConfirmPass}
                          onChange={e => setAcctConfirmPass(e.target.value)} />
                      </div>
                    </div>
                    <button style={{ ...btnP, width: 'auto', padding: '8px 18px' }}
                      onClick={handleChangePassword} disabled={acctLoading}>
                      {acctLoading ? 'Updating…' : 'Update password'}
                    </button>
                  </div>
                )}

                {acctSection === 'email' && (
                  <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
                    <p style={{ fontSize: 12, color: C.textMuted, margin: '0 0 10px' }}>
                      A confirmation link will be sent to the new address. Your current email remains active until confirmed.
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr auto', gap: 10, alignItems: 'flex-end' }}>
                      <div>
                        <label style={lbl}>New email address</label>
                        <input type="email" style={inp} placeholder="new@email.com" value={acctNewEmail}
                          onChange={e => setAcctNewEmail(e.target.value)} autoFocus />
                      </div>
                      <button style={{ ...btnP, padding: '8px 18px', whiteSpace: 'nowrap', ...(isMobile && { width: '100%' }) }}
                        onClick={handleChangeEmail} disabled={acctLoading}>
                        {acctLoading ? 'Sending…' : 'Send confirmation'}
                      </button>
                    </div>
                  </div>
                )}

                {acctSection === 'delete' && (
                  <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
                    <div style={{ padding: '10px 14px', background: C.redMuted, border: `1px solid ${C.red}`, borderRadius: 8, marginBottom: 12 }}>
                      <p style={{ fontSize: 13, color: C.red, margin: 0, fontWeight: 600 }}>⚠ This permanently deletes your account and all data</p>
                      <p style={{ fontSize: 12, color: C.red, margin: '4px 0 0' }}>All profiles, scoring history, and settings will be erased. This cannot be undone.</p>
                    </div>
                    <div style={{ marginBottom: 10 }}>
                      <label style={{ ...lbl, color: C.red }}>Type DELETE to confirm</label>
                      <input style={{ ...inp, borderColor: C.red }} placeholder="DELETE" id="delete-confirm"
                        onChange={e => { e.target.dataset.ready = e.target.value === 'DELETE' ? '1' : '' }} />
                    </div>
                    <button style={{ background: C.red, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: F }}
                      onClick={() => { const el = document.getElementById('delete-confirm'); if (el?.dataset.ready === '1') handleDeleteAccount() }}
                      disabled={acctLoading}>
                      {acctLoading ? 'Deleting…' : 'Yes, delete my account'}
                    </button>
                  </div>
                )}
              </div>

              {/* ── AI Model ── */}
              <div style={{ ...card, marginBottom: 16 }}>
                {sectionHead('AI model', 'Choose which Claude model generates your game plans. More capable models produce deeper analysis.')}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
                  {AVAILABLE_MODELS.map(m => {
                    const active = selectedModel === m.id
                    return (
                      <button key={m.id} onClick={() => setSelectedModel(m.id)} style={{
                        background: active ? C.accentMuted : C.bgInput,
                        border: `1px solid ${active ? C.accent : C.border}`,
                        borderRadius: 10, padding: '12px 14px', cursor: 'pointer', textAlign: 'left',
                        fontFamily: F, transition: 'border-color .15s',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span style={{ fontSize: 14, fontWeight: 600, color: active ? C.accent : C.text }}>{m.name}</span>
                          <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 99,
                            background: m.tier === 'Free' ? C.greenMuted : m.tier === 'Standard' ? C.blueMuted : C.amberMuted,
                            color:      m.tier === 'Free' ? C.green      : m.tier === 'Standard' ? C.blue      : C.amber,
                          }}>{m.tier}</span>
                        </div>
                        <p style={{ fontSize: 12, color: C.textMuted, margin: 0, lineHeight: 1.4 }}>{m.desc}</p>
                        <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
                          <span style={{ fontSize: 10, color: C.textFaint }}>Speed: {m.speed}</span>
                          <span style={{ fontSize: 10, color: C.textFaint }}>Cost: {m.cost}</span>
                        </div>
                      </button>
                    )
                  })}
                </div>
                <p style={{ fontSize: 11, color: C.textFaint, margin: '12px 0 0' }}>
                  Current selection: <strong style={{ color: C.text }}>{AVAILABLE_MODELS.find(m => m.id === selectedModel)?.name || selectedModel}</strong> — counts toward your daily rate limit per generation.
                </p>
              </div>

              {/* ── API Keys ── */}
              <div style={{ ...card, marginBottom: 16 }}>
                {sectionHead('API Keys', 'Optional — course search uses a free API by default. Add keys for premium data sources.')}
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
                  <div style={{ padding: '10px 14px', background: C.greenMuted, border: `1px solid ${C.green}`, borderRadius: 8 }}>
                    <p style={{ fontSize: 12, color: C.green, margin: 0 }}>All API keys are managed server-side. No client-side keys needed.</p>
                    <p style={{ fontSize: 11, color: C.textMuted, margin: '4px 0 0' }}>GolfCourseAPI and Anthropic keys are configured in Vercel environment variables.</p>
                  </div>
                </div>
              </div>

              {/* ── Course cache ── */}
              <div style={{ ...card, marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                  <div>
                    {sectionHead('Course cache', `${entries.length} course${entries.length !== 1 ? 's' : ''} stored — loaded instantly, no API call needed`)}
                  </div>
                  {entries.length > 0 && (
                    <button style={{ ...btnG, color: C.red, borderColor: C.red, flexShrink: 0 }}
                      onClick={() => { if (window.confirm('Clear all cached courses?')) { localStorage.removeItem(LS_COURSE_CACHE); setCacheVersion(v => v + 1) } }}>
                      Clear all
                    </button>
                  )}
                </div>
                {entries.length === 0 ? (
                  <p style={{ fontSize: 12, color: C.textFaint, fontStyle: 'italic', textAlign: 'center', padding: '1rem 0', margin: 0 }}>
                    No courses cached yet — courses save automatically after the first search.
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {entries.map((c, i) => (
                      <div key={i} style={{ background: C.bgInput, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                            <p style={{ fontSize: 13, fontWeight: 600, color: C.text, margin: 0 }}>{c.name}</p>
                            <Badge
                              label={c.source === 'GolfCourseAPI' ? '✓ Verified' : '⚠ Web search'}
                              bg={c.source === 'GolfCourseAPI' ? C.greenMuted : C.amberMuted}
                              fg={c.source === 'GolfCourseAPI' ? C.green : C.amber}
                            />
                          </div>
                          <p style={{ fontSize: 11, color: C.textMuted, margin: 0 }}>
                            {c.location} · Par {c.par} · {c.yardage ? Number(c.yardage).toLocaleString() + 'y' : '—'}
                            {c.rating ? ` · ${c.rating}/${c.slope}` : ''}
                            {' · '}Cached {c._cachedAt ? new Date(c._cachedAt).toLocaleDateString() : '—'}
                          </p>
                        </div>
                        <div style={{ display: 'flex', gap: 8, marginLeft: 12, flexShrink: 0 }}>
                          <button style={btnG} onClick={() => { applyScorecard(c); setTab('prep'); setPrepStep(2) }}>Load →</button>
                          <button style={{ ...btnG, color: C.red, borderColor: C.red }}
                            onClick={() => {
                              const updated = loadCourseCache()
                              delete updated[cacheKey(c.name, c.location)]
                              saveCourseCache(updated)
                              setCacheVersion(v => v + 1)
                            }}>
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ── User management (admin only — hidden entirely for non-admins) ── */}
              {isAdmin === true && (
                <div style={{ ...card, marginBottom: 16 }}>
                  {sectionHead('User management', 'List registered users, grant admin access, and remove accounts.')}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
                    <button style={btnG} onClick={loadAdminUsers} disabled={adminUsersLoading}>
                      {adminUsersLoading ? 'Loading…' : adminUsers ? 'Refresh' : 'Load users'}
                    </button>
                    {adminDeleteMsg && (
                      <span style={{ fontSize: 12, color: adminDeleteMsg.startsWith('Error') ? C.red : C.green }}>{adminDeleteMsg}</span>
                    )}
                    {adminGrantMsg && (
                      <span style={{ fontSize: 12, color: adminGrantMsg.startsWith('Error') ? C.red : C.green }}>{adminGrantMsg}</span>
                    )}
                  </div>
                  {adminUsersError && (
                    <div style={{ padding: '8px 12px', background: C.redMuted, border: `1px solid ${C.red}`, borderRadius: 8, marginBottom: 10 }}>
                      <p style={{ fontSize: 12, color: C.red, margin: 0 }}>⚠ {adminUsersError}</p>
                    </div>
                  )}
                  {adminUsers && (
                    <div>
                      <p style={{ fontSize: 12, color: C.textMuted, margin: '0 0 10px' }}>
                        {adminUsers.length} registered user{adminUsers.length !== 1 ? 's' : ''}
                      </p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {adminUsers.map(u => (
                          <div key={u.id} style={{ background: C.bgInput, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: isMobile ? 'flex-start' : 'center', gap: 10, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <p style={{ fontSize: 13, fontWeight: 600, color: C.text, margin: 0 }}>{u.email}</p>
                                {u.id === user?.id && <Badge label="You" bg={C.accentMuted} fg={C.accent} />}
                                {u.isAdmin && <Badge label="Admin" bg={C.amberMuted} fg={C.amber} />}
                              </div>
                              <p style={{ fontSize: 11, color: C.textMuted, margin: '3px 0 0' }}>
                                Joined {u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}
                                {u.last_sign_in_at ? ` · Last login ${new Date(u.last_sign_in_at).toLocaleDateString()}` : ''}
                              </p>
                              <p style={{ fontSize: 11, color: C.textMuted, margin: '2px 0 0' }}>
                                Today: {u.usage_today ?? 0} calls
                                {u.tokens_today > 0 ? ` · ${u.tokens_today.toLocaleString()} tokens` : ''}
                                {' · '}All-time: {u.usage_total ?? 0} calls
                                {u.tokens_total > 0 ? ` · ${u.tokens_total.toLocaleString()} tokens` : ''}
                              </p>
                            </div>
                            {u.id !== user?.id && (
                              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                                {!u.isAdmin && (
                                  <button style={{ ...btnG, fontSize: 11 }}
                                    onClick={async () => {
                                      setAdminGrantMsg('')
                                      const authToken = session?.access_token || ''
                                      try {
                                        const res = await fetch('/api/admin-users', {
                                          method: 'POST',
                                          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
                                          body: JSON.stringify({ grantId: u.id }),
                                        })
                                        if (!res.ok) throw new Error((await res.json()).error || res.status)
                                        setAdminGrantMsg(`Admin granted to ${u.email}`)
                                        setAdminUsers(prev => prev ? prev.map(x => x.id === u.id ? { ...x, isAdmin: true } : x) : prev)
                                      } catch (e) {
                                        setAdminGrantMsg(`Error: ${e.message}`)
                                      }
                                    }}>
                                    Grant admin
                                  </button>
                                )}
                                <button style={{ ...btnG, color: C.red, borderColor: C.red, fontSize: 11 }}
                                  onClick={() => handleDeleteUser(u.id, u.email)}>
                                  Delete
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })()}

      </div>
    </div>
  )
}

// ─── Auth gate ────────────────────────────────────────────────────────────────
function AuthGate() {
  const [session,     setSession]     = useState(undefined)   // undefined = loading, null = signed out
  const [user,        setUser]        = useState(null)
  const [needsOnboarding, setNeedsOnboarding] = useState(false)

  // Check existing session on mount
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
    })

    // Listen for auth changes (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

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

  // Handle onboarding completion — save initial profile + bag to Supabase
  const handleOnboardingComplete = async ({ player, clubs: onboardClubs, golfApiKey }) => {
    const u = user
    if (u) {
      const playerData = { ...player, clubs: onboardClubs }
      try {
        await saveUserProfile(u.id, player.name || 'Default', playerData)
        if (golfApiKey) await saveUserSettings(u.id, { golf_course_api_key: golfApiKey, current_profile: player.name || 'Default' })
        else await saveUserSettings(u.id, { current_profile: player.name || 'Default' })
      } catch (e) {
        console.warn('[onboarding] save error:', e.message)
      }
    }
    setPlayerInfo(stripClubs({ ...player, clubs: onboardClubs }))
    setClubs(onboardClubs)
    if (golfApiKey) setGolfKey(golfApiKey)
    setDbLoaded(true)
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

  // Not authenticated
  if (!session || !user) {
    return <AuthScreen onAuth={handleAuth} />
  }

  // New user — show onboarding wizard
  if (needsOnboarding) {
    return <OnboardingScreen onComplete={handleOnboardingComplete} />
  }

  // Authenticated — show main app
  return <AppInner user={user} session={session} onSignOut={handleSignOut} />
}

export default function App() {
  return <ErrorBoundary><AuthGate /></ErrorBoundary>
}
