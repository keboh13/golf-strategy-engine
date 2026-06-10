import { useState, useCallback, useEffect, useRef, Component } from 'react'
import { supabase, loadUserProfiles, saveUserProfile, deleteUserProfile, loadUserHistory, saveUserHistory, loadUserSettings, saveUserSettings, getCachedCourseDB, setCachedCourseDB, getAllCachedCoursesDB, deleteCachedCourseDB } from './lib/supabase.js'
import AuthScreen from './screens/AuthScreen.jsx'
import OnboardingScreen from './screens/OnboardingScreen.jsx'

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

// ─── Design tokens ────────────────────────────────────────────────────────────
const C = {
  bg: '#0f1117', bgCard: '#16181f', bgInput: '#1c1f28',
  border: '#2a2d3a', borderHover: '#3e4255',
  accent: '#818cf8', accentDim: '#4f52a0', accentMuted: '#1e2040',
  amber: '#f59e0b', amberMuted: '#2d1f08',
  blue: '#38bdf8', blueMuted: '#0c2a3d',
  red: '#f87171', redMuted: '#3a1515',
  green: '#34d399', greenMuted: '#064e3b',
  text: '#e4e6f0', textMuted: '#8b8fa8', textFaint: '#44475a',
}
const F = "'Inter', 'Helvetica Neue', sans-serif"

// ─── Env keys (set in .env) ───────────────────────────────────────────────────
const ENV_ANTHROPIC_KEY    = import.meta.env.VITE_ANTHROPIC_API_KEY    || ''
const ENV_MAPS_KEY         = import.meta.env.VITE_GOOGLE_MAPS_KEY      || ''
const ENV_GOLF_COURSE_KEY  = import.meta.env.VITE_GOLF_COURSE_API_KEY  || ''

// ─── Model ────────────────────────────────────────────────────────────────────
const MODEL = 'claude-sonnet-4-6'

// ─── localStorage keys ────────────────────────────────────────────────────────
const LS_PLAYER   = 'gse_player'
const LS_HISTORY  = 'gse_history'
const LS_KEYS     = 'gse_keys'
const LS_PROFILES = 'gse_profiles'
const LS_CURRENT_PROFILE = 'gse_current_profile'
const LS_COURSE_CACHE    = 'gse_course_cache'

function loadCourseCache() {
  try { return JSON.parse(localStorage.getItem(LS_COURSE_CACHE)) || {} } catch { return {} }
}
function saveCourseCache(obj) {
  try { localStorage.setItem(LS_COURSE_CACHE, JSON.stringify(obj)) } catch {}
}
function cacheKey(name, location) {
  return `${(name || '').toLowerCase().trim()}|${(location || '').toLowerCase().trim()}`
}
function getCachedCourse(name, location) {
  return loadCourseCache()[cacheKey(name, location)] || null
}
function setCachedCourse(normalized) {
  const cache = loadCourseCache()
  cache[cacheKey(normalized.name, normalized.location)] = { ...normalized, _cachedAt: Date.now() }
  saveCourseCache(cache)
}

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
  name: '', handicap: '+0.7', ghin: '',
  miss: 'Both (fade misses right under pressure)',
  ballFlight: 'Fade', swingNotes: '',
  goals: '', strengths: '',
}

// ─── Shared styles ────────────────────────────────────────────────────────────
const card = { background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 12, padding: '1.1rem 1.4rem' }
const inp  = { background: C.bgInput, border: `1px solid ${C.border}`, borderRadius: 7, color: C.text, padding: '7px 11px', fontSize: 13, fontFamily: F, outline: 'none', width: '100%', boxSizing: 'border-box' }
const lbl  = { fontSize: 10, fontWeight: 600, letterSpacing: '0.09em', textTransform: 'uppercase', color: C.textMuted, display: 'block', marginBottom: 5 }
const btnP = { background: C.accent, color: '#0f1117', border: 'none', borderRadius: 8, padding: '9px 20px', fontSize: 13, fontWeight: 600, fontFamily: F, cursor: 'pointer' }
const btnG = { background: 'transparent', color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: 7, padding: '7px 15px', fontSize: 12, fontFamily: F, cursor: 'pointer' }

function Badge({ label, bg = C.accentMuted, fg = C.accent }) {
  return <span style={{ background: bg, color: fg, fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 99, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{label}</span>
}
function Spin() {
  return <div style={{ width: 14, height: 14, border: `2px solid ${C.accentDim}`, borderTopColor: C.accent, borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
}
function SectionHead({ title, sub }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, color: C.text, margin: 0 }}>{title}</h2>
      {sub && <p style={{ fontSize: 12, color: C.textMuted, marginTop: 3 }}>{sub}</p>}
    </div>
  )
}
function InfoBox({ children, color = C.blue, bg = C.blueMuted }) {
  return <div style={{ background: bg, border: `1px solid ${color}`, borderRadius: 8, padding: '10px 14px', marginBottom: 10 }}>{children}</div>
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function windDir(deg) {
  const d = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW']
  return d[Math.round(deg / 22.5) % 16]
}

function computeHoleTimes(teeTime, pace) {
  if (!teeTime) return []
  const [h, m] = teeTime.split(':').map(Number)
  const base = new Date(); base.setHours(h, m, 0, 0)
  return Array.from({ length: 18 }, (_, i) => new Date(base.getTime() + i * pace * 60000))
}

function getWeatherAtHour(hourly, dt) {
  const iso = dt.toISOString()
  const idx = hourly.time.findIndex(t => t.startsWith(iso.slice(0, 13)))
  if (idx === -1) return null
  return {
    temp:      hourly.temperature_2m[idx],
    windSpeed: hourly.windspeed_10m[idx],
    windDir:   hourly.winddirection_10m[idx],
    precip:    hourly.precipitation_probability[idx],
    code:      hourly.weathercode[idx],
  }
}

// Auto-compute +/− from gross score vs par 72 (user can override)
function toParStr(score, par = 72) {
  const diff = parseInt(score) - par
  if (isNaN(diff)) return ''
  return diff === 0 ? 'E' : diff > 0 ? `+${diff}` : String(diff)
}

// ─── Weather fetch with fallback chain ───────────────────────────────────────
async function fetchOpenMeteo(lat, lng, timezone) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&hourly=temperature_2m,windspeed_10m,winddirection_10m,precipitation_probability,weathercode` +
    `&temperature_unit=fahrenheit&windspeed_unit=mph&forecast_days=2&timezone=${encodeURIComponent(timezone)}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Open-Meteo error: ${res.status}`)
  const data = await res.json()
  return data.hourly
}

async function geocodeViaClaudeSearch(apiKey, courseName, location) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 200,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{
        role: 'user',
        content: `What are the GPS coordinates of ${courseName} golf course${location ? ' in ' + location : ''}? Return ONLY JSON: {"lat": 36.043, "lng": -115.289}`,
      }],
    }),
  })
  const data = await res.json()
  let text = ''
  for (const block of (data.content || [])) { if (block.type === 'text') text += block.text }
  const m = text.match(/\{[^}]*"lat"\s*:\s*([-\d.]+)[^}]*"lng"\s*:\s*([-\d.]+)[^}]*\}/)
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) }
  throw new Error('Could not parse coordinates from Claude response')
}

// ─── OpenGolfAPI scorecard fetch ──────────────────────────────────────────────
async function searchOpenGolfAPI(query) {
  const res = await fetch(`https://api.opengolfapi.org/v1/courses/search?q=${encodeURIComponent(query)}&limit=5`)
  if (!res.ok) throw new Error(`OpenGolfAPI search error: ${res.status}`)
  return res.json()
}

async function fetchOpenGolfAPICourse(id) {
  const res = await fetch(`https://api.opengolfapi.org/v1/courses/${id}`)
  if (!res.ok) throw new Error(`OpenGolfAPI course fetch error: ${res.status}`)
  return res.json()
}

function normalizeOpenGolfCourse(raw) {
  // OpenGolfAPI v1 returns hole data under `scorecard` (par + handicap, no yardages)
  // Some older entries may use `tees` / `tee_sets` with full yardage — try those first.
  const tees = raw.tees || raw.tee_sets || []
  const chosen = tees.find(t => /black|championship|tournament/i.test(t.name))
    || tees.find(t => /blue/i.test(t.name))
    || tees[0]

  let holes
  if (chosen?.holes?.length) {
    // Full tee-set data with yardages
    holes = chosen.holes.map((h, i) => ({
      par:      h.par || 4,
      yardage:  String(h.yardage || h.yards || ''),
      handicap: h.handicap || h.stroke_index || i + 1,
      notes:    '',
    }))
  } else if (raw.scorecard?.length) {
    // Flat scorecard: has par + handicap_index but no yardages — user fills those in
    holes = raw.scorecard
      .slice()
      .sort((a, b) => (a.hole_number || 0) - (b.hole_number || 0))
      .map((h, i) => ({
        par:      h.par || 4,
        yardage:  String(h.yardage || h.yards || ''),
        handicap: h.handicap_index || h.handicap || h.stroke_index || i + 1,
        notes:    '',
      }))
  } else {
    throw new Error('No hole data found in OpenGolfAPI response — try entering yardages manually')
  }

  while (holes.length < 18) holes.push({ par: 4, yardage: '', handicap: holes.length + 1, notes: '' })

  const totalYardage = chosen?.total_yardage
    || holes.reduce((s, h) => s + (parseInt(h.yardage) || 0), 0)
    || raw.total_yardage
    || ''

  return {
    name:     raw.name || raw.course_name || raw.club_name,
    location: [raw.city, raw.state].filter(Boolean).join(', '),
    yardage:  String(totalYardage || ''),
    rating:   String(chosen?.rating || chosen?.course_rating || raw.rating || ''),
    slope:    String(chosen?.slope  || chosen?.slope_rating  || raw.slope  || ''),
    par:      holes.reduce((s, h) => s + h.par, 0) || raw.par_total || 72,
    lat:      raw.latitude  || raw.lat,
    lng:      raw.longitude || raw.lng,
    source:   'OpenGolfAPI',
    holes,
  }
}

// ─── GolfCourseAPI (primary — real yardages) ─────────────────────────────────
/**
 * GolfCourseAPI — https://api.golfcourseapi.com
 * Requires API key. Returns full tee sets with hole-by-hole yardage, par, handicap.
 * Auth: Authorization: Key YOUR_KEY
 */
async function searchGolfCourseAPI(query, apiKey) {
  const res = await fetch(
    `https://api.golfcourseapi.com/v1/search?search_query=${encodeURIComponent(query)}`,
    { headers: { Authorization: `Key ${apiKey}` } }
  )
  if (!res.ok) throw new Error(`GolfCourseAPI search error: ${res.status}`)
  const data = await res.json()
  return data.courses || []
}

function normalizeGolfCourseAPICourse(raw) {
  // Prefer the longest male tee (championship/back); fall back to female tees
  const maleTees   = raw.tees?.male   || []
  const femaleTees = raw.tees?.female || []
  const allTees    = maleTees.length ? maleTees : femaleTees

  // Pick by name priority, then longest yardage
  const chosen = allTees.find(t => /black|championship|tournament/i.test(t.tee_name))
    || allTees.find(t => /blue/i.test(t.tee_name))
    || allTees.reduce((best, t) => (!best || t.total_yards > best.total_yards) ? t : best, null)

  if (!chosen) throw new Error('No tee data in response')

  const holes = (chosen.holes || []).map((h, i) => ({
    par:      h.par      || 4,
    yardage:  String(h.yardage || ''),
    handicap: h.handicap || i + 1,
    notes:    '',
  }))

  while (holes.length < 18) holes.push({ par: 4, yardage: '', handicap: holes.length + 1, notes: '' })

  const loc = raw.location || {}
  return {
    name:     raw.course_name || raw.club_name,
    location: [loc.city, loc.state].filter(Boolean).join(', '),
    yardage:  String(chosen.total_yards || ''),
    rating:   String(chosen.course_rating || ''),
    slope:    String(chosen.slope_rating  || ''),
    par:      chosen.par_total || holes.reduce((s, h) => s + h.par, 0),
    lat:      loc.latitude,
    lng:      loc.longitude,
    tees:     allTees.map(t => ({ name: t.tee_name, yardage: t.total_yards || '' })),
    source:   'GolfCourseAPI',
    holes,
  }
}

// ─── Greenskeeper fallback via Claude web search ──────────────────────────────
async function fetchScorecardViaClaudeSearch(apiKey, courseName, location) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2500,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{
        role: 'user',
        content: `Search greenskeeper.org and the course website for the verified scorecard of "${courseName}"${location ? ` in ${location}` : ''}.

Find REAL hole-by-hole yardages, pars, and handicap indexes. Do NOT guess.

Return ONLY this JSON (no markdown):
{
  "name": "Full course name",
  "location": "City, State",
  "yardage": <integer>,
  "rating": <float>,
  "slope": <integer>,
  "par": <integer>,
  "source": "greenskeeper.org or course website URL",
  "holes": [{"par":4,"yardage":379,"handicap":7}, ...all 18]
}

If not found: {"error": "No verified scorecard found"}`,
      }],
    }),
  })
  const data = await res.json()
  let text = ''
  for (const block of (data.content || [])) { if (block.type === 'text') text += block.text }
  const clean = text.replace(/```json|```/g, '').trim()
  const m = clean.match(/\{[\s\S]*\}/)
  if (!m) throw new Error('No JSON in response')
  const parsed = JSON.parse(m[0])
  if (parsed.error) throw new Error(parsed.error)
  return { ...parsed, source: parsed.source || 'web search' }
}

// ─── Course Search component ──────────────────────────────────────────────────
function CourseSearch({ apiKey, golfCourseApiKey, onApiKeyNeeded, onSelect }) {
  const [query,    setQuery]    = useState('')
  const [location, setLocation] = useState('')
  const [results,  setResults]  = useState([])
  const [detail,   setDetail]   = useState(null)
  const [loading,  setLoading]  = useState(false)
  const [status,   setStatus]   = useState('') // in-progress status message
  const [error,    setError]    = useState('')
  const [source,   setSource]   = useState('')
  // Race-condition guard: each load gets an ID; stale completions are ignored
  const loadIdRef = useRef(0)

  const search = async () => {
    if (!query.trim()) return
    setLoading(true); setError(''); setStatus(''); setResults([]); setDetail(null); setSource('')
    const q = query + (location ? ' ' + location : '')

    // Tier 1: GolfCourseAPI — real yardages, requires API key
    if (golfCourseApiKey) {
      try {
        const courses = await searchGolfCourseAPI(q, golfCourseApiKey)
        if (courses.length > 0) {
          setResults(courses)
          setSource('GolfCourseAPI')
          setLoading(false)
          return
        }
      } catch (e1) {
        // fall through to next tier
      }
    }

    // Tier 2: OpenGolfAPI — free, no key, but no yardages
    try {
      const data = await searchOpenGolfAPI(q)
      const courses = Array.isArray(data) ? data : (data.courses || data.results || [])
      if (courses.length > 0) {
        setResults(courses)
        setSource('OpenGolfAPI')
        setLoading(false)
        return
      }
    } catch {}

    // Tier 3: Claude web search
    if (!apiKey) {
      setError('No results found. Add your Anthropic API key (top-right) to enable web search fallback.')
      onApiKeyNeeded?.()
      setLoading(false)
      return
    }
    try {
      const d = await fetchScorecardViaClaudeSearch(apiKey, query, location)
      setDetail(d)
      setSource(d.source || 'web search')
    } catch (e) {
      setError(`No results found across all sources.\n\nTry a more specific course name (e.g. include city/state) or enter yardages manually below.`)
    }
    setLoading(false)
  }

  const loadCourse = async (courseStub) => {
    const myId = ++loadIdRef.current
    setLoading(true); setError(''); setStatus(''); setDetail(null)
    try {
      if (courseStub._source === 'GolfCourseAPI') {
        // Check cache before hitting API
        const stubName = courseStub.course_name || courseStub.name || ''
        const stubLoc  = courseStub.location || ''
        const cached = getCachedCourse(stubName, stubLoc)
        if (cached) {
          if (myId !== loadIdRef.current) return
          setDetail(cached)
          setSource('cache')
          setStatus('')
          setLoading(false)
          return
        }
        const normalized = normalizeGolfCourseAPICourse(courseStub)
        if (myId !== loadIdRef.current) return
        setCachedCourse(normalized)
        setDetail(normalized)
        setSource('GolfCourseAPI')
      } else {
        // OpenGolfAPI: fetch full detail, then supplement yardages via Claude if missing
        const raw = await fetchOpenGolfAPICourse(courseStub.id || courseStub._id)
        if (myId !== loadIdRef.current) return
        const normalized = normalizeOpenGolfCourse(raw)
        const missingYardages = normalized.holes.every(h => !h.yardage)
        if (missingYardages && apiKey) {
          setStatus('Fetching yardages via web search…')
          try {
            const webData = await fetchScorecardViaClaudeSearch(apiKey, normalized.name, normalized.location)
            if (myId !== loadIdRef.current) return
            const merged = {
              ...normalized,
              yardage: webData.yardage || normalized.yardage,
              rating:  webData.rating  || normalized.rating,
              slope:   webData.slope   || normalized.slope,
              source:  webData.source  || 'web search',
              holes: normalized.holes.map((h, i) => ({
                ...h,
                yardage:  String(webData.holes?.[i]?.yardage || h.yardage || ''),
                par:      webData.holes?.[i]?.par      || h.par,
                handicap: webData.holes?.[i]?.handicap || h.handicap,
              })),
            }
            setCachedCourse(merged)
            setDetail(merged)
            setSource(webData.source || 'web search')
          } catch {
            if (myId !== loadIdRef.current) return
            setDetail(normalized)
            setSource('OpenGolfAPI (no yardages — enter manually)')
          }
        } else {
          setCachedCourse(normalized)
          setDetail(normalized)
          setSource(normalized.source || 'OpenGolfAPI')
        }
      }
    } catch (e) {
      if (myId !== loadIdRef.current) return
      setError(`Failed to load scorecard: ${e.message}`)
    }
    setStatus('')
    setLoading(false)
  }

  return (
    <div style={{ ...card, marginBottom: 14, borderColor: C.accentMuted }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <p style={{ ...lbl, margin: 0 }}>Search verified scorecard</p>
        {golfCourseApiKey
          ? <Badge label="GolfCourseAPI" bg={C.greenMuted} fg={C.green} />
          : <Badge label="OpenGolfAPI" bg={C.bgInput} fg={C.textMuted} />}
        {source === 'GolfCourseAPI' && <Badge label="Full yardages" bg={C.accentMuted} fg={C.accent} />}
      </div>
      <p style={{ fontSize: 12, color: C.textMuted, marginBottom: 10, marginTop: 0 }}>
        {golfCourseApiKey
          ? 'Primary: GolfCourseAPI (verified yardages). Falls back to OpenGolfAPI then Claude web search.'
          : 'Primary: OpenGolfAPI (free). Add VITE_GOLF_COURSE_API_KEY to .env for verified yardages.'}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px auto', gap: 8 }}>
        <div>
          <label style={lbl}>Course name</label>
          <input style={inp} value={query} onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && search()} placeholder="e.g. Rhodes Ranch Golf Club" />
        </div>
        <div>
          <label style={lbl}>City / State</label>
          <input style={inp} value={location} onChange={e => setLocation(e.target.value)} placeholder="Las Vegas, NV" />
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <button style={{ ...btnP, display: 'flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap' }} onClick={search} disabled={loading}>
            {loading ? <><Spin /> Searching...</> : 'Search →'}
          </button>
        </div>
      </div>

      {status && (
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Spin /><p style={{ fontSize: 12, color: C.textMuted, margin: 0 }}>{status}</p>
        </div>
      )}

      {error && (
        <div style={{ marginTop: 10, padding: '10px 14px', background: C.redMuted, border: `1px solid ${C.red}`, borderRadius: 8 }}>
          <p style={{ fontSize: 12, color: C.red, margin: 0, whiteSpace: 'pre-wrap' }}>⚠ {error}</p>
        </div>
      )}

      {results.length > 0 && !detail && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {results.map((r, i) => {
            const isGCA   = source === 'GolfCourseAPI'
            const name    = r.course_name || r.club_name || r.name
            const loc     = isGCA ? r.location : r
            const city    = loc?.city || ''
            const state   = loc?.state || ''
            const maleTees = r.tees?.male || []
            const backTee  = maleTees.find(t => /black|championship|tournament/i.test(t.tee_name))
              || maleTees.find(t => /blue/i.test(t.tee_name))
              || maleTees.reduce((best, t) => (!best || t.total_yards > best.total_yards) ? t : best, null)
            return (
              <div key={i} style={{ background: C.bgInput, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <p style={{ fontSize: 13, fontWeight: 500, color: C.text, margin: 0 }}>{name}</p>
                  <p style={{ fontSize: 11, color: C.textMuted, margin: '2px 0 0' }}>
                    {[city, state].filter(Boolean).join(', ')}
                    {backTee && <span style={{ color: C.accent }}> · {backTee.tee_name} {backTee.total_yards?.toLocaleString()}y · Par {backTee.par_total} · {backTee.course_rating}/{backTee.slope_rating}</span>}
                  </p>
                </div>
                <button style={btnP} onClick={() => loadCourse({ ...r, _source: source })}>Load scorecard →</button>
              </div>
            )
          })}
        </div>
      )}

      {detail && (
        <div style={{ marginTop: 12, background: C.bgInput, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
            <div>
              <p style={{ fontSize: 14, fontWeight: 600, color: C.text, margin: 0 }}>{detail.name}</p>
              <p style={{ fontSize: 12, color: C.textMuted, margin: '2px 0 0' }}>
                {detail.location} · Par {detail.par} · {detail.yardage ? Number(detail.yardage).toLocaleString() + 'y' : ''}
                {detail.rating && ` · Rating ${detail.rating}`}{detail.slope && ` / Slope ${detail.slope}`}
              </p>
              <p style={{ fontSize: 11, color: source === 'cache' ? C.amber : C.green, margin: '4px 0 0' }}>
                {source === 'cache' ? '⚡ Loaded from local cache — no API call' : `✓ Verified from ${source}`}
              </p>
            </div>
            <button style={btnP} onClick={() => onSelect(detail)}>Use this scorecard →</button>
          </div>
          <ScorecardPreview holes={detail.holes} />
        </div>
      )}
    </div>
  )
}

function ScorecardPreview({ holes }) {
  if (!holes || holes.length < 18) return null
  const front = holes.slice(0, 9)
  const back  = holes.slice(9, 18)
  const row = (label, fn, color = C.textMuted) => (
    <tr>
      <td style={{ color: C.textFaint, padding: '3px 4px', fontSize: 10 }}>{label}</td>
      {front.map((h, i) => <td key={i} style={{ color, padding: '3px 4px', textAlign: 'center', fontSize: 11 }}>{fn(h)}</td>)}
      <td style={{ color, padding: '3px 4px', textAlign: 'center', fontSize: 11, fontWeight: 600 }}>
        {front.reduce((s, h) => s + (Number(fn(h)) || 0), 0) || ''}
      </td>
      {back.map((h, i) => <td key={i + 9} style={{ color, padding: '3px 4px', textAlign: 'center', fontSize: 11 }}>{fn(h)}</td>)}
      <td style={{ color, padding: '3px 4px', textAlign: 'center', fontSize: 11, fontWeight: 600 }}>
        {back.reduce((s, h) => s + (Number(fn(h)) || 0), 0) || ''}
      </td>
    </tr>
  )
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, tableLayout: 'fixed' }}>
        <thead>
          <tr>
            <td style={{ color: C.textFaint, padding: '3px 4px', width: 36 }}>Hole</td>
            {[1,2,3,4,5,6,7,8,9].map(n => <td key={n} style={{ color: C.textFaint, padding: '3px 4px', textAlign: 'center', width: 34 }}>{n}</td>)}
            <td style={{ color: C.textFaint, padding: '3px 4px', textAlign: 'center', width: 38, fontWeight: 600 }}>Out</td>
            {[10,11,12,13,14,15,16,17,18].map(n => <td key={n} style={{ color: C.textFaint, padding: '3px 4px', textAlign: 'center', width: 34 }}>{n}</td>)}
            <td style={{ color: C.textFaint, padding: '3px 4px', textAlign: 'center', width: 38, fontWeight: 600 }}>In</td>
          </tr>
        </thead>
        <tbody>
          {row('Par', h => h.par, C.text)}
          {row('Yds', h => h.yardage, C.accent)}
          {row('HCP', h => h.handicap, C.textFaint)}
        </tbody>
      </table>
    </div>
  )
}

// ─── Weather + Tee Time panel ─────────────────────────────────────────────────
function WeatherPanel({ apiKey, course, coords, setCoords,
                        teeTime, setTeeTime, teeDate, setTeeDate, pace, setPace,
                        timezone, weather, setWeather, weatherLoading, setWeatherLoading }) {
  const [status,     setStatus]     = useState('')
  const [error,      setError]      = useState('')
  const [manualLat,  setManualLat]  = useState('')
  const [manualLng,  setManualLng]  = useState('')
  const [showManual, setShowManual] = useState(false)

  const holeTimes   = computeHoleTimes(teeTime, pace)
  const holeWeather = holeTimes.map(dt => weather ? getWeatherAtHour(weather, dt) : null)

  const doFetch = async (lat, lng, tierLabel) => {
    try {
      const hourly = await fetchOpenMeteo(lat, lng, timezone)
      setWeather(hourly)
      setCoords({ lat, lng })
      setStatus(`Weather loaded via ${tierLabel}`)
      setError('')
      setShowManual(false)
      return true
    } catch {
      return false
    }
  }

  const fetchWeather = async () => {
    if (!course.name) { setError('Enter a course name first.'); return }
    setWeatherLoading(true); setStatus(''); setError('')

    if (coords?.lat) {
      const ok = await doFetch(coords.lat, coords.lng, 'course coordinates')
      if (ok) { setWeatherLoading(false); return }
    }

    if (apiKey) {
      setStatus('Geocoding via Claude web search...')
      try {
        const c = await geocodeViaClaudeSearch(apiKey, course.name, course.location)
        const ok = await doFetch(c.lat, c.lng, 'Claude geocode')
        if (ok) { setWeatherLoading(false); return }
      } catch {}
    }

    setError(
      `Automatic geocoding failed. This can happen when:\n` +
      `• The course name is ambiguous or misspelled\n` +
      `• API key is missing (set VITE_ANTHROPIC_API_KEY in .env)\n` +
      `• Open-Meteo is temporarily unreachable\n\n` +
      `Enter coordinates manually below (find them on Google Maps).`
    )
    setShowManual(true)
    setWeatherLoading(false)
  }

  const fetchManual = async () => {
    const lat = parseFloat(manualLat), lng = parseFloat(manualLng)
    if (isNaN(lat) || isNaN(lng)) { setError('Enter valid decimal coordinates.'); return }
    setWeatherLoading(true)
    await doFetch(lat, lng, 'manual coordinates')
    setWeatherLoading(false)
  }

  const codes = { 0:'Clear', 1:'Mostly clear', 2:'Partly cloudy', 3:'Overcast', 45:'Foggy', 61:'Light rain', 63:'Rain', 80:'Showers' }

  return (
    <div style={{ ...card, marginBottom: 12 }}>
      <p style={{ ...lbl, marginBottom: 12 }}>Tee time & live weather</p>
      <div style={{ display: 'grid', gridTemplateColumns: '140px 120px 110px 1fr auto', gap: 10, alignItems: 'flex-end' }}>
        <div>
          <label style={lbl}>Date</label>
          <input type="date" style={inp} value={teeDate} onChange={e => setTeeDate(e.target.value)} />
        </div>
        <div>
          <label style={lbl}>Tee time</label>
          <input type="time" style={inp} value={teeTime} onChange={e => setTeeTime(e.target.value)} />
        </div>
        <div>
          <label style={lbl}>Pace (min/hole)</label>
          <input type="number" style={inp} value={pace} onChange={e => setPace(Number(e.target.value))} min={8} max={20} />
        </div>
        <div />
        <button style={{ ...btnP, display: 'flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap' }}
          onClick={fetchWeather} disabled={weatherLoading}>
          {weatherLoading ? <><Spin /> Fetching...</> : '🌤 Fetch live weather'}
        </button>
      </div>

      {status && <p style={{ fontSize: 12, color: C.green, marginTop: 8 }}>✓ {status}</p>}

      {error && (
        <div style={{ marginTop: 10, padding: '10px 14px', background: C.redMuted, border: `1px solid ${C.red}`, borderRadius: 8 }}>
          <p style={{ fontSize: 12, color: C.red, margin: 0, whiteSpace: 'pre-wrap' }}>⚠ {error}</p>
        </div>
      )}

      {showManual && (
        <div style={{ marginTop: 10, padding: '12px 14px', background: C.bgInput, border: `1px solid ${C.border}`, borderRadius: 8 }}>
          <p style={{ ...lbl, marginBottom: 8 }}>Manual coordinates</p>
          <p style={{ fontSize: 11, color: C.textMuted, margin: '0 0 10px' }}>
            Find on Google Maps: right-click the course → "What's here?" → copy the coordinates shown.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8 }}>
            <div>
              <label style={lbl}>Latitude</label>
              <input style={inp} value={manualLat} onChange={e => setManualLat(e.target.value)} placeholder="e.g. 36.0430" />
            </div>
            <div>
              <label style={lbl}>Longitude</label>
              <input style={inp} value={manualLng} onChange={e => setManualLng(e.target.value)} placeholder="e.g. -115.2889" />
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button style={btnP} onClick={fetchManual} disabled={weatherLoading}>Fetch →</button>
            </div>
          </div>
        </div>
      )}

      {weather && holeWeather[0] && (
        <div style={{ marginTop: 14 }}>
          <p style={{ ...lbl, marginBottom: 8 }}>Forecast by hole — {pace} min/hole pace from {teeTime}</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))', gap: 6 }}>
            {holeWeather.slice(0, 18).map((w, i) => w && (
              <div key={i} style={{ background: C.bgInput, border: `1px solid ${C.border}`, borderRadius: 7, padding: '7px 10px' }}>
                <div style={{ fontSize: 10, color: C.textFaint, marginBottom: 4 }}>
                  Hole {i + 1} · {holeTimes[i]?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
                <span style={{ fontSize: 11, color: C.blue }}>🌡 {Math.round(w.temp)}°F  </span>
                <span style={{ fontSize: 11, color: C.textMuted }}>💨 {windDir(w.windDir)} {Math.round(w.windSpeed)}mph</span>
                {w.precip > 20 && <span style={{ fontSize: 11, color: C.amber }}> 🌧 {w.precip}%</span>}
                {codes[w.code] && <div style={{ fontSize: 10, color: C.textFaint, marginTop: 2 }}>{codes[w.code]}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Google Maps satellite embed ──────────────────────────────────────────────
function CourseMapEmbed({ courseName, location, mapsKey }) {
  const [embedStatus, setEmbedStatus] = useState('loading') // 'loading' | 'ok' | 'error'
  const query    = encodeURIComponent(`${courseName} golf course ${location || ''}`)
  const mapsUrl  = `https://www.google.com/maps/search/${query}`
  const validKey = mapsKey && mapsKey.startsWith('AIza')

  // Pre-flight: check the embed URL actually returns 200 before rendering the iframe
  useEffect(() => {
    if (!validKey) return
    setEmbedStatus('loading')
    const embedUrl = `https://www.google.com/maps/embed/v1/place?key=${mapsKey}&q=${query}&zoom=15&maptype=satellite`
    fetch(embedUrl, { method: 'HEAD', mode: 'no-cors' })
      .then(() => setEmbedStatus('ok'))   // no-cors always resolves — use onLoad for real check
      .catch(() => setEmbedStatus('error'))
  }, [mapsKey, query, validKey])

  if (!mapsKey) {
    return (
      <div style={{ ...card, marginBottom: 14 }}>
        <p style={{ ...lbl, marginBottom: 8 }}>Satellite view</p>
        <InfoBox>
          <p style={{ fontSize: 12, color: C.blue, margin: 0 }}>
            Add <code>VITE_GOOGLE_MAPS_KEY</code> to your <code>.env</code> file to embed satellite imagery inline.
            Without it, use the link below to open in Google Maps.
          </p>
        </InfoBox>
        <a href={mapsUrl} target="_blank" rel="noreferrer"
          style={{ ...btnG, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          Open {courseName} in Google Maps ↗
        </a>
      </div>
    )
  }

  if (!validKey) {
    return (
      <div style={{ ...card, marginBottom: 14 }}>
        <p style={{ ...lbl, marginBottom: 8 }}>Satellite view</p>
        <div style={{ padding: '10px 14px', background: C.redMuted, border: `1px solid ${C.red}`, borderRadius: 8, marginBottom: 10 }}>
          <p style={{ fontSize: 12, color: C.red, margin: 0 }}>
            ⚠ Invalid key format — Google Maps API keys must start with <code>AIza</code>.
            Get one at <a href="https://console.cloud.google.com" target="_blank" rel="noreferrer" style={{ color: C.red }}>console.cloud.google.com</a> → enable <strong>Maps Embed API</strong>.
          </p>
        </div>
        <a href={mapsUrl} target="_blank" rel="noreferrer"
          style={{ ...btnG, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          Open {courseName} in Google Maps ↗
        </a>
      </div>
    )
  }

  const embedUrl = `https://www.google.com/maps/embed/v1/place?key=${mapsKey}&q=${query}&zoom=15&maptype=satellite`
  return (
    <div style={{ ...card, marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <p style={{ ...lbl, margin: 0 }}>Satellite — {courseName}</p>
        <a href={mapsUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: C.accent, textDecoration: 'none' }}>
          Open full screen ↗
        </a>
      </div>
      <div style={{ borderRadius: 10, overflow: 'hidden', border: `1px solid ${C.border}`, position: 'relative' }}>
        <iframe
          key={embedUrl}
          title="Course satellite view"
          src={embedUrl}
          width="100%" height="500"
          style={{ display: 'block', border: 'none' }}
          allowFullScreen loading="lazy"
          onLoad={e => {
            // If Google returned an error page, the iframe title contains "error"
            try { setEmbedStatus(e.target.contentDocument?.title?.toLowerCase().includes('error') ? 'error' : 'ok') } catch { setEmbedStatus('ok') }
          }}
          onError={() => setEmbedStatus('error')}
        />
      </div>
      {embedStatus === 'error' && (
        <div style={{ marginTop: 8, padding: '10px 14px', background: C.redMuted, border: `1px solid ${C.red}`, borderRadius: 8 }}>
          <p style={{ fontSize: 12, color: C.red, margin: '0 0 6px', fontWeight: 600 }}>⚠ Map failed to load — common causes:</p>
          <p style={{ fontSize: 12, color: C.red, margin: 0, lineHeight: 1.6 }}>
            1. Wrong API enabled — go to Google Cloud Console and enable <strong>Maps Embed API</strong> (not Maps JavaScript API)<br />
            2. Key has HTTP referrer restrictions — add <code>localhost:3000/*</code> to the allowed list<br />
            3. Billing not enabled on your Google Cloud project (required even for free tier)
          </p>
        </div>
      )}
      <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
        <a href={mapsUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: C.textFaint, textDecoration: 'none' }}>
          Open in Google Maps as fallback ↗
        </a>
      </div>
    </div>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────
function AppInner({ user, session, onSignOut }) {
  // ── API keys — loaded from localStorage, falling back to .env ────────────
  const [apiKey,          setApiKeyRaw]       = useState(() => loadSavedKeys().anthropic  || ENV_ANTHROPIC_KEY)
  const [mapsKey,         setMapsKeyRaw]      = useState(() => loadSavedKeys().maps        || ENV_MAPS_KEY)
  const [golfCourseApiKey,setGolfKeyRaw]      = useState(() => loadSavedKeys().golfCourse  || ENV_GOLF_COURSE_KEY)
  const [showKeysPanel,   setShowKeysPanel]   = useState(false)
  // Inputs for the keys panel
  const [draftAnthropicKey,  setDraftAnthropicKey]  = useState('')
  const [draftMapsKey,       setDraftMapsKey]       = useState('')
  const [draftGolfKey,       setDraftGolfKey]       = useState('')
  const [keyErrors,          setKeyErrors]          = useState({})

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

  // Profile switcher
  const [currentProfile, setCurrentProfile] = useState(() =>
    localStorage.getItem(LS_CURRENT_PROFILE) || 'Default'
  )
  const [newProfileName, setNewProfileName] = useState('')
  const [showNewProfile, setShowNewProfile] = useState(false)

  const switchProfile = (name) => {
    const profiles = loadProfiles()
    const currentData = { ...playerInfo, clubs }
    if (JSON.stringify(profiles[currentProfile]) !== JSON.stringify(currentData)) {
      profiles[currentProfile] = currentData
      saveProfiles(profiles)
    }
    const next = profiles[name] || DEFAULT_PLAYER
    setPlayerInfo(stripClubs(next))
    setClubs(clubsFromProfile(next))
    setExpandedClubs({})
    setCurrentProfile(name)
    localStorage.setItem(LS_CURRENT_PROFILE, name)
  }
  const createProfile = () => {
    const name = newProfileName.trim()
    if (!name) return
    const profiles = loadProfiles()
    profiles[currentProfile] = { ...playerInfo, clubs }
    profiles[name] = { ...DEFAULT_PLAYER, clubs: DEFAULT_CLUBS }
    saveProfiles(profiles)
    setPlayerInfo(DEFAULT_PLAYER)
    setClubs(DEFAULT_CLUBS)
    setExpandedClubs({})
    setCurrentProfile(name)
    localStorage.setItem(LS_CURRENT_PROFILE, name)
    setNewProfileName('')
    setShowNewProfile(false)
  }
  const deleteProfile = () => {
    const profiles = loadProfiles()
    delete profiles[currentProfile]
    saveProfiles(profiles)
    const remaining = Object.keys(profiles)
    const next = remaining[0] || 'Default'
    if (!profiles[next]) profiles[next] = DEFAULT_PLAYER
    saveProfiles(profiles)
    setPlayerInfo(stripClubs(profiles[next]))
    setClubs(clubsFromProfile(profiles[next]))
    setExpandedClubs({})
    setCurrentProfile(next)
    localStorage.setItem(LS_CURRENT_PROFILE, next)
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
    targetScore: '', notes: '', source: '',
    holes: Array.from({ length: 18 }, (_, i) => ({
      par:      [4,4,3,5,4,3,4,5,4,4,3,4,5,4,3,4,4,5][i] || 4,
      yardage:  '',
      handicap: i + 1,
      notes:    '',
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

  // Game plan
  const [plan,        setPlan]        = useState('')
  const [planLoading, setPlanLoading] = useState(false)
  const [planError,   setPlanError]   = useState('')
  const [copied,      setCopied]      = useState(false)

  // History course-lookup state: { [roundIndex]: { query, results, loading, error } }
  const [historySearch, setHistorySearch] = useState({})
  const updateHS = (i, patch) => setHistorySearch(prev => ({ ...prev, [i]: { ...prev[i], ...patch } }))

  const historySearchCourse = async (i, query) => {
    if (!query.trim()) return
    updateHS(i, { loading: true, error: '', results: [] })
    try {
      if (golfCourseApiKey) {
        const courses = await searchGolfCourseAPI(query, golfCourseApiKey)
        if (courses.length > 0) { updateHS(i, { results: courses, loading: false }); return }
      }
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
  // Load user data from Supabase on mount (when authenticated)
  useEffect(() => {
    if (!user) return
    ;(async () => {
      try {
        // Load profiles
        const dbProfiles = await loadUserProfiles(user.id)
        if (Object.keys(dbProfiles).length > 0) {
          saveProfiles(dbProfiles)
          const settings = await loadUserSettings(user.id)
          const profileName = settings.current_profile || Object.keys(dbProfiles)[0]
          setCurrentProfile(profileName)
          if (dbProfiles[profileName]) {
            setPlayerInfo(stripClubs(dbProfiles[profileName]))
            setClubs(clubsFromProfile(dbProfiles[profileName]))
          }
        }
        // Load history
        const dbHistory = await loadUserHistory(user.id)
        if (dbHistory.length > 0) setScoringHistory(dbHistory)
        // Load settings (API keys)
        const settings = await loadUserSettings(user.id)
        if (settings.golf_course_api_key) setGolfKeyRaw(settings.golf_course_api_key)
      } catch (e) {
        console.warn('[supabase] load error:', e.message)
      }
    })()
  }, [user?.id])

  useEffect(() => {
    const profileData = { ...playerInfo, clubs }
    localStorage.setItem(LS_PLAYER, JSON.stringify(profileData))
    const profiles = loadProfiles()
    profiles[currentProfile] = profileData
    saveProfiles(profiles)
    // Sync to Supabase
    if (user) {
      saveUserProfile(user.id, currentProfile, profileData).catch(e => console.warn('[supabase] profile save:', e.message))
      saveUserSettings(user.id, { current_profile: currentProfile }).catch(e => console.warn('[supabase] settings save:', e.message))
    }
  }, [playerInfo, clubs, currentProfile])
  useEffect(() => {
    localStorage.setItem(LS_HISTORY, JSON.stringify(scoringHistory))
    // Sync to Supabase
    if (user) {
      saveUserHistory(user.id, scoringHistory).catch(e => console.warn('[supabase] history save:', e.message))
    }
  }, [scoringHistory])

  const holeTimes   = computeHoleTimes(teeTime, pace)
  const holeWeather = holeTimes.map(dt => weather ? getWeatherAtHour(weather, dt) : null)

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
      holes: r.holes.map((h, i) => ({
        ...prev.holes[i],
        par:      h.par,
        yardage:  String(h.yardage || ''),
        handicap: h.handicap || i + 1,
        notes:    prev.holes[i]?.notes || '',
      })),
    }))
    if (r.lat && r.lng) setCoords({ lat: r.lat, lng: r.lng })
    else setCoords(null)
  }, [])

  const buildPrompt = useCallback(() => {
    // ── Shared: club list ──
    const clubList = clubs.map(c => {
      let s = `${c.club}: ${c.carry}y (${c.shape})`
      const analytics = [
        c.ballSpeed   ? `${c.ballSpeed}mph ball speed`                                                       : '',
        c.launchAngle ? `${c.launchAngle}° launch`                                                           : '',
        c.spinRate    ? `${c.spinRate}rpm spin`                                                               : '',
        (c.dispLeft || c.dispRight) ? `${c.dispLeft || 0}yd left / ${c.dispRight || 0}yd right dispersion`  : '',
      ].filter(Boolean)
      if (analytics.length) s += ` | ${analytics.join(', ')}`
      return s
    }).join(', ')

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

    // ── Player profile block (cache-friendly prefix) ──
    const playerBlock = `PLAYER: ${playerInfo.name || 'Player'}, HCP ${playerInfo.handicap}
Miss tendency: ${playerInfo.miss} | Ball flight: ${playerInfo.ballFlight}
${playerInfo.swingNotes ? `Swing notes: ${playerInfo.swingNotes}` : ''}
${playerInfo.goals ? `Goals: ${playerInfo.goals}` : ''}
${playerInfo.strengths ? `Strengths: ${playerInfo.strengths}` : ''}

BAG (carry distances):
${clubList}`

    // ── Profile-only mode (no course loaded) ──
    if (!course.name) {
      return `You are an elite Tour caddy and performance analyst. The player has not set up a course for today — generate a profile-only competitive brief.

${playerBlock}
${historyBlock}

Generate a profile-only brief:

## Current form
Based on scoring history, summarize where the game is right now. Be specific — use the actual numbers.

## Where shots are leaking
Identify the 2-3 most likely sources of dropped shots based on par-type averages, tournament vs casual gaps, and noted tendencies.

## Pattern to watch
Front 9 vs back 9 pattern if visible. Tournament pressure patterns. Any trend from recent rounds.

## Focus areas for next competitive round
2-3 specific, actionable points — not generic tips. Tied to the player's actual data.

## Questions to ask yourself on the course
3-4 pre-shot or strategic questions specific to this player's tendencies.

Be direct. Use actual figures. No filler.`
    }

    // ── Course-loaded mode: full pre-round brief ──
    const isPractice = course.roundType === 'Practice round'
    const isMatchPlay = course.roundType === 'Match play'
    const sourceNote = course.source === 'GolfCourseAPI' ? 'Verified — GolfCourseAPI'
      : course.source === 'OpenGolfAPI'    ? 'Partial — OpenGolfAPI (par/HCP only, yardages from web)'
      : course.source                      ? `Unverified — sourced via web search (${course.source}). Caveat yardages where confidence is low.`
      : 'Manual entry'

    const holesData = course.holes.map((h, i) => {
      const w    = holeWeather[i]
      const time = holeTimes[i]?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      const wStr = w ? ` | ~${time}: ${Math.round(w.temp)}°F, ${windDir(w.windDir)} ${Math.round(w.windSpeed)}mph, ${w.precip}% rain` : ''
      const nStr = h.notes ? ` | Caddy note: ${h.notes}` : ''
      return `Hole ${i+1}: Par ${h.par}, ${h.yardage || '?'}y, HCP ${h.handicap}${nStr}${wStr}`
    }).join('\n')

    return `You are an elite Tour caddy. Generate a precision pre-round game plan.

${playerBlock}

COURSE: ${course.name}, ${course.yardage}y, Rating ${course.rating} / Slope ${course.slope}, Par ${course.par}
Data source: ${sourceNote}
Round type: ${course.roundType} | Target: ${course.targetScore || 'under par'} | Conditions: ${course.conditions}
${isPractice ? 'NOTE: This is a practice round — the player may be experimenting. Frame strategy around learning objectives, not just score.' : ''}
${isMatchPlay ? 'NOTE: Match play format — adjust aggression and risk-reward framing for hole-by-hole match context.' : ''}
${course.notes ? `Course notes: ${course.notes}` : ''}

TEE TIME: ${teeTime} (${teeDate}) — Pace ${pace} min/hole
${historyBlock}

HOLE-BY-HOLE:
${holesData}

Generate a complete competitive brief:

## Round strategy
2-3 sentences. Overall approach given conditions, course profile, and this player's tendencies. Be specific to today.

## Scoring roadmap
One line per hole: "Hole N (Par X, Yds) — [attack / par / damage control] — reason"
🟢 birdie targets | 🔴 danger holes | 🟡 par and move on

## Hole-by-hole strategy
### Hole [N] — Par [X] — [Yds]y — HCP [N]
- **Tee shot**: Club, target, shape, where NOT to miss given ${playerInfo.miss} tendency
- **Approach**: Distance from ideal position, club, landing zone
- **Caddy note**: Green tendencies, weather adjustment, specific intel

## Weather adjustments
How conditions shift across the round. Club up/down notes on key holes.

## Pressure management
Specific to this player's patterns${historyBlock ? ' (use the tournament vs casual data)' : ''}. Pre-shot anchor for the hardest stretch. How to handle bogeys.

Use actual yardages throughout. Be direct — no filler.`
  }, [clubs, course, playerInfo, holeWeather, holeTimes, teeTime, teeDate, pace, scoringHistory])

  const generate = async () => {
    // Use server-side proxy when deployed (no user API key needed), fall back to direct browser access for local dev
    const useProxy = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1'
    if (!useProxy && !apiKey) { setShowKeysPanel(true); setPlanError('Add your Anthropic API key (top-right 🔑) to generate a game plan.'); return }
    setPlanLoading(true); setPlanError(''); setPlan(''); setTab('plan')
    const payload = {
      model: MODEL,
      max_tokens: 6000,
      stream: true,
      messages: [{
        role: 'user',
        content: [{ type: 'text', text: buildPrompt(), cache_control: { type: 'ephemeral' } }],
      }],
    }
    try {
      // Get the current session token for the proxy (rate limiting + auth verification)
      const authToken = session?.access_token || ''
      const res = await fetch(useProxy ? '/api/generate' : 'https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: useProxy
          ? { 'Content-Type': 'application/json', ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}) }
          : {
              'Content-Type': 'application/json',
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
              'anthropic-beta': 'prompt-caching-2024-07-31',
              'anthropic-dangerous-direct-browser-access': 'true',
            },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`)
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
            if (j.type === 'content_block_delta' && j.delta?.text) setPlan(p => p + j.delta.text)
          } catch {}
        }
      }
    } catch (e) {
      setPlanError(e.message)
    }
    setPlanLoading(false)
  }

  const copyPlan = async () => {
    await navigator.clipboard.writeText(plan)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const printPlan = () => {
    const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const html = esc(plan)
      .replace(/## (.+)/g, '</p><h2>$1</h2><p>')
      .replace(/### (.+)/g, '</p><h3>$1</h3><p>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>')
    const doc = `<!DOCTYPE html><html><head><title>Game Plan — ${esc(course.name || 'Golf')}</title>
      <style>
        body{font-family:Georgia,serif;max-width:680px;margin:40px auto;color:#111;line-height:1.75;font-size:13px}
        h1{font-size:20px;margin-bottom:2px}.meta{color:#666;font-size:12px;margin-bottom:24px;border-bottom:1px solid #ddd;padding-bottom:12px}
        h2{font-size:15px;border-bottom:1px solid #ddd;padding-bottom:3px;margin-top:24px}
        h3{font-size:13px;margin:14px 0 3px;color:#333}
        @media print{body{margin:16px}}
      </style></head><body>
      <h1>${esc(course.name || 'Game Plan')}</h1>
      <div class="meta">${esc(playerInfo.name || 'Player')} · HCP ${playerInfo.handicap} · ${teeDate} ${teeTime} · Par ${course.par} · ${course.yardage}y · ${esc(course.conditions)}</div>
      <p>${html}</p>
    </body></html>`
    const url = URL.createObjectURL(new Blob([doc], { type: 'text/html' }))
    const w = window.open(url, '_blank')
    w?.addEventListener('load', () => { w.print(); URL.revokeObjectURL(url) })
  }

  const renderPlan = (text) => text.split('\n').map((line, i) => {
    const l = line.trim()
    if (!l) return <div key={i} style={{ height: 6 }} />
    if (l.startsWith('## '))  return <h2 key={i} style={{ fontSize: 16, fontWeight: 600, color: C.text, margin: '1.4rem 0 0.4rem', borderBottom: `1px solid ${C.border}`, paddingBottom: 6 }}>{l.slice(3)}</h2>
    if (l.startsWith('### ')) return <h3 key={i} style={{ fontSize: 13, fontWeight: 600, color: l.match(/Hole/i) ? C.accent : C.amber, margin: '1rem 0 3px' }}>{l.slice(4)}</h3>
    if (l.startsWith('- ') || l.startsWith('• ')) return (
      <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 3, paddingLeft: 6 }}>
        <span style={{ color: C.accentDim, flexShrink: 0, marginTop: 2 }}>▸</span>
        <span style={{ fontSize: 13, color: C.textMuted, lineHeight: 1.65 }} dangerouslySetInnerHTML={{ __html: l.replace(/^[-•]\s*/, '').replace(/\*\*([^*]+)\*\*/g, (_, m) => `<strong style="color:${C.text}">${m.replace(/[<>]/g, '')}</strong>`) }} />
      </div>
    )
    return <p key={i} style={{ fontSize: 13, color: C.textMuted, lineHeight: 1.7, margin: '3px 0' }} dangerouslySetInnerHTML={{ __html: l.replace(/\*\*([^*]+)\*\*/g, (_, m) => `<strong style="color:${C.text}">${m.replace(/[<>]/g, '')}</strong>`) }} />
  })

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
    setShowKeysPanel(false)
  }
  const clearKey = (which) => {
    if (which === 'anthropic') setApiKey('')
    if (which === 'maps')      setMapsKey('')
    if (which === 'golf')      setGolfKey('')
  }

  const TABS = [
    { id: 'player',  label: 'Bag & player',    icon: '🏌️' },
    { id: 'history', label: 'Scoring history', icon: '📊' },
    { id: 'course',  label: 'Course setup',    icon: '⛳' },
    { id: 'plan',    label: 'Game plan',       icon: '⚡' },
    { id: 'admin',   label: 'Course cache',    icon: '🗄️' },
  ]

  const nextTab = { player: 'history', history: 'course', course: 'plan' }

  return (
    <div style={{ background: C.bg, minHeight: '100vh', fontFamily: F }}>
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes blink{50%{opacity:0}}
        input::placeholder,textarea::placeholder{color:${C.textFaint}}
        input:focus,textarea:focus,select:focus{border-color:${C.accentDim}!important;outline:none}
        select option{background:${C.bgInput}}
        code{background:${C.bgInput};padding:1px 5px;border-radius:4px;font-size:0.9em}
      `}</style>

      {/* Header */}
      <div style={{ borderBottom: `1px solid ${C.border}`, padding: '0 1.5rem' }}>
        <div style={{ maxWidth: 1020, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 52 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: C.text, letterSpacing: '-0.01em' }}>Strategy Engine</span>
            <span style={{ color: C.border }}>|</span>
            <span style={{ fontSize: 13, color: C.textMuted }}>{playerInfo.name || 'Player'} · {playerInfo.handicap}</span>
            {currentProfile !== 'Default' && <span style={{ fontSize: 11, color: C.textFaint }}>({currentProfile})</span>}
            {course.name && <span style={{ fontSize: 13, color: C.textFaint }}>· {course.name}</span>}
            {weather && <Badge label="Weather live" bg={C.blueMuted} fg={C.blue} />}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'relative' }}>
            {/* Keys panel toggle */}
            <button
              style={{ ...btnG, fontSize: 11, padding: '5px 12px',
                borderColor: !apiKey ? C.amber : C.border,
                color:       !apiKey ? C.amber : C.textMuted }}
              onClick={() => setShowKeysPanel(p => !p)}
              title="Manage API keys">
              🔑 {apiKey ? 'Keys saved' : 'Add API key'}
            </button>

            {/* Floating keys panel */}
            {showKeysPanel && (
              <div style={{
                position: 'absolute', top: 42, right: 0, zIndex: 100,
                background: C.bgCard, border: `1px solid ${C.border}`,
                borderRadius: 12, padding: '16px 18px', width: 380,
                boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <p style={{ ...lbl, margin: 0 }}>API keys — saved locally</p>
                  <button style={{ background: 'none', border: 'none', color: C.textFaint, cursor: 'pointer', fontSize: 16 }}
                    onClick={() => { setShowKeysPanel(false); setKeyErrors({}) }}>✕</button>
                </div>

                {/* Anthropic */}
                <div style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <label style={lbl}>Anthropic API key <span style={{ color: C.textFaint, fontWeight: 400 }}>(game plans, yardages, weather)</span></label>
                    {apiKey && <button style={{ background: 'none', border: 'none', color: C.red, fontSize: 10, cursor: 'pointer', padding: 0 }} onClick={() => clearKey('anthropic')}>clear</button>}
                  </div>
                  {apiKey
                    ? <div style={{ ...inp, color: C.green, fontSize: 12 }}>✓ Saved ({apiKey.slice(0, 14)}…)</div>
                    : <input type="password" style={{ ...inp, fontSize: 12 }} placeholder="sk-ant-..."
                        value={draftAnthropicKey} onChange={e => { setDraftAnthropicKey(e.target.value); setKeyErrors(k => ({...k, anthropic: ''})) }} />
                  }
                  {keyErrors.anthropic && <p style={{ fontSize: 11, color: C.red, margin: '3px 0 0' }}>⚠ {keyErrors.anthropic}</p>}
                </div>

                {/* GolfCourseAPI */}
                <div style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <label style={lbl}>GolfCourseAPI key <span style={{ color: C.textFaint, fontWeight: 400 }}>(verified yardages)</span></label>
                    {golfCourseApiKey && <button style={{ background: 'none', border: 'none', color: C.red, fontSize: 10, cursor: 'pointer', padding: 0 }} onClick={() => clearKey('golf')}>clear</button>}
                  </div>
                  {golfCourseApiKey
                    ? <div style={{ ...inp, color: C.green, fontSize: 12 }}>✓ Saved ({golfCourseApiKey.slice(0, 10)}…)</div>
                    : <input style={{ ...inp, fontSize: 12 }} placeholder="XXXXX..."
                        value={draftGolfKey} onChange={e => setDraftGolfKey(e.target.value)} />
                  }
                </div>

                {/* Google Maps */}
                <div style={{ marginBottom: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <label style={lbl}>Google Maps key <span style={{ color: C.textFaint, fontWeight: 400 }}>(satellite view — optional)</span></label>
                    {mapsKey && <button style={{ background: 'none', border: 'none', color: C.red, fontSize: 10, cursor: 'pointer', padding: 0 }} onClick={() => clearKey('maps')}>clear</button>}
                  </div>
                  {mapsKey
                    ? <div style={{ ...inp, color: C.green, fontSize: 12 }}>✓ Saved ({mapsKey.slice(0, 10)}…)</div>
                    : <input style={{ ...inp, fontSize: 12 }} placeholder="AIza..."
                        value={draftMapsKey} onChange={e => { setDraftMapsKey(e.target.value); setKeyErrors(k => ({...k, maps: ''})) }} />
                  }
                  {keyErrors.maps && <p style={{ fontSize: 11, color: C.red, margin: '3px 0 0' }}>⚠ {keyErrors.maps}</p>}
                </div>

                {(!apiKey || !golfCourseApiKey || !mapsKey) && (
                  <button style={{ ...btnP, width: '100%', textAlign: 'center' }} onClick={saveKeysFromPanel}>
                    Save keys
                  </button>
                )}
                <p style={{ fontSize: 10, color: C.textFaint, marginTop: 10, marginBottom: 0 }}>
                  Stored in browser localStorage — never sent anywhere except their respective APIs.
                </p>
              </div>
            )}

            <button style={{ ...btnP, padding: '7px 18px', fontSize: 12, opacity: planLoading ? 0.6 : 1 }}
              onClick={generate} disabled={planLoading}>
              {planLoading ? 'Generating...' : '⚡ Generate game plan'}
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ borderBottom: `1px solid ${C.border}`, padding: '0 1.5rem' }}>
        <div style={{ maxWidth: 1020, margin: '0 auto', display: 'flex' }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              background: 'transparent', border: 'none',
              borderBottom: tab === t.id ? `2px solid ${C.accent}` : '2px solid transparent',
              padding: '13px 18px', fontSize: 13, fontFamily: F,
              color: tab === t.id ? C.text : C.textMuted, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 1020, margin: '0 auto', padding: '1.5rem 1.5rem 4rem' }}>

        {/* ── BAG & PLAYER ── */}
        {tab === 'player' && (
          <div>
            {/* Profile switcher */}
            <div style={{ ...card, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ ...lbl, margin: 0, whiteSpace: 'nowrap' }}>Profile</span>
              <select style={{ ...inp, width: 'auto', minWidth: 160 }}
                value={currentProfile}
                onChange={e => switchProfile(e.target.value)}>
                {(() => {
                  const profiles = loadProfiles()
                  profiles[currentProfile] = playerInfo
                  return Object.keys(profiles).map(n => <option key={n}>{n}</option>)
                })()}
              </select>
              {!showNewProfile
                ? <button style={btnG} onClick={() => setShowNewProfile(true)}>+ New profile</button>
                : <>
                    <input style={{ ...inp, width: 160 }} placeholder="Profile name" value={newProfileName}
                      onChange={e => setNewProfileName(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && createProfile()} autoFocus />
                    <button style={{ ...btnP, padding: '7px 14px', fontSize: 12 }} onClick={createProfile}>Create</button>
                    <button style={btnG} onClick={() => { setShowNewProfile(false); setNewProfileName('') }}>Cancel</button>
                  </>
              }
              {Object.keys(loadProfiles()).length > 1 &&
                <button style={{ ...btnG, color: C.red, borderColor: C.red, marginLeft: 'auto' }}
                  onClick={() => { if (window.confirm(`Delete profile "${currentProfile}"?`)) deleteProfile() }}>
                  Delete profile
                </button>
              }
            </div>
            <SectionHead
              title="Bag & player profile"
              sub="Player profile and club distances save automatically with your profile across sessions."
            />
            <div style={{ ...card, marginBottom: 12 }}>
              <p style={{ ...lbl, marginBottom: 12 }}>Player details</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                {[['Name','name','Player name'],['Handicap index','handicap','+0.7'],['GHIN number','ghin','Optional — for reference']].map(([l2,k,ph]) => (
                  <div key={k}>
                    <label style={lbl}>{l2}</label>
                    <input style={inp} value={playerInfo[k]} onChange={e => setPlayerInfo({ ...playerInfo, [k]: e.target.value })} placeholder={ph} />
                  </div>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
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
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
                <div>
                  <label style={lbl}>Goals — fed directly into AI strategy</label>
                  <textarea style={{ ...inp, height: 68, resize: 'vertical' }} value={playerInfo.goals || ''}
                    onChange={e => setPlayerInfo({ ...playerInfo, goals: e.target.value })}
                    placeholder="e.g. Stop leaking shots on par 3s, hold my game together on back 9 in tournaments..." />
                </div>
                <div>
                  <label style={lbl}>Strengths — fed directly into AI strategy</label>
                  <textarea style={{ ...inp, height: 68, resize: 'vertical' }} value={playerInfo.strengths || ''}
                    onChange={e => setPlayerInfo({ ...playerInfo, strengths: e.target.value })}
                    placeholder="e.g. Reliable iron player, strong lag putter, good SW from 80y..." />
                </div>
              </div>
              <div style={{ marginTop: 10 }}>
                <label style={lbl}>Swing notes — fed directly into AI strategy</label>
                <textarea style={{ ...inp, height: 56, resize: 'vertical' }} value={playerInfo.swingNotes}
                  onChange={e => setPlayerInfo({ ...playerInfo, swingNotes: e.target.value })}
                  placeholder="e.g. Gets steep under pressure, slight over-the-top move, left miss when tired on driver..." />
              </div>
            </div>

            <div style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <p style={{ ...lbl, margin: 0 }}>Club distances</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 11, color: C.textFaint }}>Saved automatically with your profile</span>
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
                      <div style={{ marginLeft: 34, marginTop: 4, marginBottom: 6, display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '4px 8px' }}>
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
            </div>
          </div>
        )}

        {/* ── SCORING HISTORY ── */}
        {tab === 'history' && (
          <div>
            <SectionHead title="Scoring history" sub="Recent rounds — AI weights these heavily to calibrate today's target score and risk strategy" />
            <div style={{ ...card, marginBottom: 12, borderColor: C.accentMuted }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                <p style={{ fontSize: 13, color: C.textMuted, margin: 0, lineHeight: 1.6, maxWidth: 600 }}>
                  Enter his most recent competitive and practice rounds. Claude identifies scoring patterns,
                  course-type tendencies, and condition-based trends — then adjusts today's target and
                  hole-by-hole strategy accordingly. Most recent rounds are weighted most heavily.
                </p>
                <button style={{ ...btnG, whiteSpace: 'nowrap', marginLeft: 16, flexShrink: 0 }}
                  onClick={() => setScoringHistory(h => [...h, { course: '', location: '', date: '', score: '', par: 72, toPar: '', roundType: 'Tournament', conditions: '', notes: '' }])}>
                  + Add round
                </button>
              </div>

              {scoringHistory.length === 0 ? (
                <p style={{ fontSize: 12, color: C.textFaint, fontStyle: 'italic', textAlign: 'center', padding: '1rem 0' }}>
                  No rounds yet — hit "+ Add round" to start tracking scoring history.
                </p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <div style={{ minWidth: 740 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '140px 90px 105px 46px 40px 40px 105px 105px 1fr 28px', gap: '4px 8px', marginBottom: 6 }}>
                      {['Course','City / State','Date','Score','Par','+/−','Round type','Conditions','Notes',''].map((h, i) =>
                        <span key={i} style={{ fontSize: 10, color: C.textFaint, letterSpacing: '0.07em', textTransform: 'uppercase' }}>{h}</span>
                      )}
                    </div>
                    {scoringHistory.map((r, i) => (
                      <div key={i} style={{ marginBottom: 6 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '140px 90px 105px 46px 40px 40px 105px 105px 1fr 28px', gap: '3px 8px', alignItems: 'center' }}>
                        <input style={{ ...inp, padding: '4px 8px', fontSize: 12 }} value={r.course}
                          onChange={e => setScoringHistory(h => h.map((rr, j) => j === i ? { ...rr, course: e.target.value } : rr))}
                          placeholder="Course name" />
                        <input style={{ ...inp, padding: '4px 8px', fontSize: 12 }} value={r.location}
                          onChange={e => setScoringHistory(h => h.map((rr, j) => j === i ? { ...rr, location: e.target.value } : rr))}
                          placeholder="City, ST" />
                        <input type="date" style={{ ...inp, padding: '4px 8px', fontSize: 12 }} value={r.date}
                          onChange={e => setScoringHistory(h => h.map((rr, j) => j === i ? { ...rr, date: e.target.value } : rr))} />
                        <input type="number" style={{ ...inp, padding: '4px 6px', fontSize: 12, textAlign: 'center' }} value={r.score}
                          onChange={e => {
                            const score = e.target.value
                            setScoringHistory(h => h.map((rr, j) => j === i ? {
                              ...rr, score,
                              toPar: !rr.toPar || rr.toPar === toParStr(rr.score, rr.par || 72) ? toParStr(score, rr.par || 72) : rr.toPar,
                            } : rr))
                          }}
                          placeholder="70" />
                        <input type="number" style={{ ...inp, padding: '4px 6px', fontSize: 12, textAlign: 'center' }} value={r.par ?? 72}
                          onChange={e => {
                            const par = Number(e.target.value) || 72
                            setScoringHistory(h => h.map((rr, j) => j === i ? {
                              ...rr, par,
                              toPar: rr.score ? toParStr(rr.score, par) : rr.toPar,
                            } : rr))
                          }}
                          placeholder="72" />
                        <input style={{ ...inp, padding: '4px 6px', fontSize: 12, textAlign: 'center' }} value={r.toPar}
                          onChange={e => setScoringHistory(h => h.map((rr, j) => j === i ? { ...rr, toPar: e.target.value } : rr))}
                          placeholder="E" />
                        <select style={{ ...inp, padding: '4px 6px', fontSize: 12 }} value={r.roundType || ''}
                          onChange={e => setScoringHistory(h => h.map((rr, j) => j === i ? { ...rr, roundType: e.target.value } : rr))}>
                          <option value="">Type</option>
                          {['Tournament','Qualifier','Stroke play','Match play','Practice round','Casual'].map(o => <option key={o}>{o}</option>)}
                        </select>
                        <select style={{ ...inp, padding: '4px 6px', fontSize: 12 }} value={r.conditions}
                          onChange={e => setScoringHistory(h => h.map((rr, j) => j === i ? { ...rr, conditions: e.target.value } : rr))}>
                          <option value="">Conditions</option>
                          {['Normal','Firm & fast','Soft','Windy','Hot & dry','Wet'].map(o => <option key={o}>{o}</option>)}
                        </select>
                        <input style={{ ...inp, padding: '4px 8px', fontSize: 12 }} value={r.notes}
                          onChange={e => setScoringHistory(h => h.map((rr, j) => j === i ? { ...rr, notes: e.target.value } : rr))}
                          placeholder="Drove it well, 3-putted twice..." />
                        <button style={{ background: 'transparent', border: 'none', color: C.textFaint, cursor: 'pointer', fontSize: 16, padding: '2px 4px' }}
                          onClick={() => setScoringHistory(h => h.filter((_, j) => j !== i))} title="Remove">×</button>
                      </div>
                      {/* Course lookup */}
                      {(() => {
                        const hs = historySearch[i] || {}
                        return (
                          <div style={{ marginTop: 3, marginBottom: 2 }}>
                            {r.courseData ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 2 }}>
                                <span style={{ fontSize: 11, color: C.green }}>⛳ Scorecard linked: {r.courseData.name} ({r.courseData.holes?.length || 18} holes)</span>
                                <button style={{ background: 'none', border: 'none', color: C.red, fontSize: 10, cursor: 'pointer', padding: 0 }}
                                  onClick={() => setScoringHistory(h => h.map((rr, j) => j === i ? { ...rr, courseData: null } : rr))}>remove</button>
                              </div>
                            ) : (
                              <div>
                                {!hs.open ? (
                                  <button style={{ ...btnG, fontSize: 10, padding: '2px 10px' }} onClick={() => updateHS(i, { open: true, query: r.course || '', results: [], error: '' })}>
                                    + Link scorecard
                                  </button>
                                ) : (
                                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                                    <input style={{ ...inp, fontSize: 12, padding: '3px 8px', width: 220 }}
                                      placeholder="Search course name…"
                                      value={hs.query || ''}
                                      onChange={e => updateHS(i, { query: e.target.value })}
                                      onKeyDown={e => e.key === 'Enter' && historySearchCourse(i, hs.query)} />
                                    <button style={{ ...btnP, fontSize: 11, padding: '4px 12px' }} onClick={() => historySearchCourse(i, hs.query)}>
                                      {hs.loading ? '…' : 'Search'}
                                    </button>
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
                ? recent3.reduce((a,b)=>a+b,0)/recent3.length < older3.reduce((a,b)=>a+b,0)/older3.length
                  ? 'Improving ↗' : 'Declining ↘'
                : '—'
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
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 8 }}>
                    {statCard('Overall avg', fmtF(avg), C.text, `${scores.length} rounds`)}
                    {statCard('Best round',  fmt(best),  C.green)}
                    {statCard('Worst round', fmt(worst), worst>2?C.red:C.textMuted)}
                    {statCard('Recent trend', trend, trend.includes('↗')?C.green:trend.includes('↘')?C.amber:C.textMuted)}
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

        {/* ── COURSE SETUP ── */}
        {tab === 'course' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600, color: C.text, margin: 0 }}>Course setup</h2>
              {course.source === 'GolfCourseAPI' && (
                <Badge label="✓ Verified — GolfCourseAPI" bg={C.greenMuted} fg={C.green} />
              )}
              {(course.source === 'OpenGolfAPI' || course.source?.includes('partial')) && (
                <Badge label="⚠ Partial data — yardages may be incomplete" bg={C.amberMuted} fg={C.amber} />
              )}
              {course.source && course.source !== 'GolfCourseAPI' && course.source !== 'OpenGolfAPI' && !course.source.includes('partial') && (
                <Badge label="⚠ Unverified — web search" bg={C.amberMuted} fg={C.amber} />
              )}
            </div>
            {course.source && course.source !== 'GolfCourseAPI' && course.source !== 'OpenGolfAPI' && (
              <div style={{ background: C.amberMuted, border: `1px solid ${C.amber}`, borderRadius: 8, padding: '10px 14px', marginBottom: 12 }}>
                <p style={{ fontSize: 12, color: C.amber, margin: 0, fontWeight: 500 }}>
                  ⚠ Unverified course data — yardages sourced from web search, not guaranteed accurate. Verify against your local scorecard before use.
                </p>
              </div>
            )}
            <p style={{ fontSize: 12, color: C.textMuted, marginTop: 0, marginBottom: 14 }}>Search verified scorecard, set tee time, add caddy notes per hole</p>
            <CourseSearch
              apiKey={apiKey}
              golfCourseApiKey={golfCourseApiKey}
              onApiKeyNeeded={() => setShowKeysPanel(true)}
              onSelect={applyScorecard}
            />

            <div style={{ ...card, marginBottom: 12 }}>
              <p style={{ ...lbl, marginBottom: 12 }}>Course details</p>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 10 }}>
                <div>
                  <label style={lbl}>Course name</label>
                  <input style={inp} value={course.name} onChange={e => setCourse({ ...course, name: e.target.value })} placeholder="e.g. Rhodes Ranch Golf Club" />
                </div>
                <div>
                  <label style={lbl}>City / State</label>
                  <input style={inp} value={course.location} onChange={e => setCourse({ ...course, location: e.target.value })} placeholder="Las Vegas, NV" />
                </div>
                <div>
                  <label style={lbl}>Total yardage</label>
                  <input style={inp} value={course.yardage} onChange={e => setCourse({ ...course, yardage: e.target.value })} placeholder="6582" />
                </div>
                <div>
                  <label style={lbl}>Rating / Slope</label>
                  <input style={inp}
                    value={`${course.rating}${course.slope ? '/' + course.slope : ''}`}
                    onChange={e => { const [r, s] = e.target.value.split('/'); setCourse({ ...course, rating: r?.trim(), slope: s?.trim() || course.slope }) }}
                    placeholder="70.6 / 128" />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginTop: 10 }}>
                <div>
                  <label style={lbl}>Conditions</label>
                  <select style={inp} value={course.conditions} onChange={e => setCourse({ ...course, conditions: e.target.value })}>
                    {['Normal','Firm & fast','Soft','Wet','Dry & links-like'].map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl}>Round type</label>
                  <select style={inp} value={course.roundType} onChange={e => setCourse({ ...course, roundType: e.target.value })}>
                    {['Stroke play tournament','Match play','Qualifier','Q School','Practice round','Casual round'].map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl}>Target score</label>
                  <input style={inp} value={course.targetScore} onChange={e => setCourse({ ...course, targetScore: e.target.value })} placeholder="-2 (69)" />
                </div>
              </div>
              <div style={{ marginTop: 10 }}>
                <label style={lbl}>General course notes</label>
                <textarea style={{ ...inp, height: 56, resize: 'vertical' }} value={course.notes}
                  onChange={e => setCourse({ ...course, notes: e.target.value })}
                  placeholder="Green speed, firmness, key local knowledge, previous experience..." />
              </div>
            </div>

            {/* Unified tee time + weather panel */}
            <WeatherPanel
              apiKey={apiKey} course={course}
              coords={coords} setCoords={setCoords}
              teeTime={teeTime} setTeeTime={setTeeTime}
              teeDate={teeDate} setTeeDate={setTeeDate}
              pace={pace} setPace={setPace}
              timezone={timezone}
              weather={weather} setWeather={setWeather}
              weatherLoading={weatherLoading} setWeatherLoading={setWeatherLoading}
            />

            {/* Hole table */}
            <div style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <p style={{ ...lbl, margin: 0 }}>Hole-by-hole</p>
                <p style={{ fontSize: 11, color: C.textFaint, margin: 0 }}>Notes = caddy intel for AI (green slopes, OB, pin tendencies…)</p>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <div style={{ minWidth: 500 }}>
                  {['Front 9', 'Back 9'].map((label, half) => (
                    <div key={half}>
                      <p style={{ fontSize: 10, color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>
                        {label} — {course.holes.slice(half * 9, half * 9 + 9).reduce((s, h) => s + (parseInt(h.yardage) || 0), 0)}y · Par {course.holes.slice(half * 9, half * 9 + 9).reduce((s, h) => s + h.par, 0)}
                      </p>
                      <div style={{ display: 'grid', gridTemplateColumns: '28px 48px 66px 50px 1fr', gap: '4px 8px', marginBottom: 4 }}>
                        {half === 0 && ['#','Par','Yds','HCP','Caddy notes'].map((h, i) =>
                          <span key={i} style={{ fontSize: 10, color: C.textFaint, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{h}</span>
                        )}
                      </div>
                      {course.holes.slice(half * 9, half * 9 + 9).map((h, i) => {
                        const idx = half * 9 + i
                        const upd = (field, val) => setCourse({ ...course, holes: course.holes.map((hh, j) => j === idx ? { ...hh, [field]: val } : hh) })
                        return (
                          <div key={idx} style={{ display: 'grid', gridTemplateColumns: '28px 48px 66px 50px 1fr', gap: '3px 8px', marginBottom: 3, alignItems: 'center' }}>
                            <span style={{ fontSize: 11, color: C.textMuted, textAlign: 'center' }}>{idx + 1}</span>
                            <select style={{ ...inp, padding: '4px 6px', fontSize: 12 }} value={h.par} onChange={e => upd('par', Number(e.target.value))}>
                              {[3,4,5].map(p => <option key={p}>{p}</option>)}
                            </select>
                            <input type="number" style={{ ...inp, padding: '4px 6px', fontSize: 12 }} value={h.yardage} onChange={e => upd('yardage', e.target.value)} placeholder="yds" />
                            <input type="number" style={{ ...inp, padding: '4px 6px', fontSize: 12 }} value={h.handicap} onChange={e => upd('handicap', e.target.value)} placeholder="HCP" />
                            <input style={{ ...inp, padding: '4px 8px', fontSize: 12 }} value={h.notes} onChange={e => upd('notes', e.target.value)}
                              placeholder="e.g. Green slopes back-to-front, false front, OB left, pin usually front-right..." />
                          </div>
                        )
                      })}
                      {half === 0 && <div style={{ borderTop: `1px solid ${C.border}`, margin: '10px 0 10px' }} />}
                    </div>
                  ))}
                  <div style={{ display: 'grid', gridTemplateColumns: '28px 48px 66px 50px 1fr', gap: '4px 8px', marginTop: 8, paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
                    <span style={{ fontSize: 11, color: C.textFaint }}>Tot</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: C.text, padding: '4px 6px' }}>{course.holes.reduce((s, h) => s + h.par, 0)}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: C.accent, padding: '4px 6px' }}>{course.holes.reduce((s, h) => s + (parseInt(h.yardage) || 0), 0).toLocaleString()}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── COURSE MAP (commented out for MVP) ── */}
        {/* {tab === 'map' && (
          <div>
            <SectionHead title="Course satellite view" sub="Visual orientation — use alongside hole caddy notes" />
            {course.name
              ? <CourseMapEmbed courseName={course.name} location={course.location} mapsKey={mapsKey} />
              : <div style={{ ...card, textAlign: 'center', padding: '3rem 2rem' }}>
                  <p style={{ fontSize: 16, color: C.textMuted }}>Set up the course first</p>
                  <button style={{ ...btnG, marginTop: 12 }} onClick={() => setTab('course')}>Go to course setup →</button>
                </div>
            }
            {!mapsKey && (
              <div style={{ ...card, marginTop: 12 }}>
                <p style={{ ...lbl, marginBottom: 8 }}>Enable inline satellite view</p>
                <p style={{ fontSize: 12, color: C.textMuted, margin: '0 0 10px' }}>
                  Add a Google Maps Embed API key to embed satellite imagery directly. Get one free at{' '}
                  <a href="https://console.cloud.google.com" target="_blank" rel="noreferrer" style={{ color: C.accent }}>console.cloud.google.com</a> → Maps Embed API.
                  Add to <code>.env</code> as <code>VITE_GOOGLE_MAPS_KEY=AIza...</code> and restart, or paste below for this session.
                </p>
                <input style={inp} placeholder="Paste Maps API key here — applies instantly" onChange={e => setMapsKey(e.target.value)} />
              </div>
            )}
          </div>
        )} */}

        {/* ── GAME PLAN ── */}
        {tab === 'plan' && (
          <div>
            {course.name && course.source && course.source !== 'GolfCourseAPI' && course.source !== 'OpenGolfAPI' && (
              <div style={{ background: C.amberMuted, border: `1px solid ${C.amber}`, borderRadius: 8, padding: '10px 14px', marginBottom: 12 }}>
                <p style={{ fontSize: 12, color: C.amber, margin: 0, fontWeight: 500 }}>
                  ⚠ Unverified course data — yardages sourced from web search. Claude will caveat where confidence is low. Verify against your local scorecard.
                </p>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <h2 style={{ fontSize: 18, fontWeight: 600, color: C.text, margin: 0 }}>Game plan</h2>
                {!course.name && <Badge label="Profile-only brief" bg={C.blueMuted} fg={C.blue} />}
                {planLoading && <><Spin /><span style={{ fontSize: 12, color: C.textMuted }}>Generating...</span></>}
                {plan && !planLoading && <Badge label="Ready" />}
              </div>
              {!planLoading && plan && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button style={btnG} onClick={copyPlan}>{copied ? '✓ Copied' : 'Copy text'}</button>
                  <button style={btnG} onClick={printPlan}>Print / PDF</button>
                  <button style={btnG} onClick={generate}>↺ Regenerate</button>
                </div>
              )}
            </div>
            {planError && (
              <div style={{ ...card, borderColor: C.red, marginBottom: 12 }}>
                <p style={{ color: C.red, fontSize: 13, margin: 0 }}>⚠ {planError}</p>
              </div>
            )}
            {!plan && !planLoading && (
              <div style={{ ...card, textAlign: 'center', padding: '3rem 2rem' }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>⚡</div>
                {course.name
                  ? <>
                      <p style={{ fontSize: 16, color: C.textMuted, margin: 0 }}>Ready to generate pre-round brief</p>
                      <p style={{ fontSize: 12, color: C.textFaint, marginTop: 6 }}>{course.name} · {course.roundType}</p>
                    </>
                  : <>
                      <p style={{ fontSize: 16, color: C.textMuted, margin: 0 }}>No course loaded — generate profile-only brief</p>
                      <p style={{ fontSize: 12, color: C.textFaint, marginTop: 6 }}>Claude will analyze your scoring patterns and tendencies without hole-by-hole strategy</p>
                    </>
                }
                <button style={{ ...btnP, marginTop: 16 }} onClick={generate}>Generate →</button>
              </div>
            )}
            {(plan || planLoading) && (
              <div style={card}>
                {renderPlan(plan)}
                {planLoading && <span style={{ display: 'inline-block', width: 7, height: 15, background: C.accent, animation: 'blink 0.8s step-end infinite', marginLeft: 2, verticalAlign: 'middle' }} />}
              </div>
            )}
          </div>
        )}

        {/* ── COURSE CACHE ADMIN ── */}
        {tab === 'admin' && (() => {
          const cache = loadCourseCache()
          const entries = Object.values(cache).sort((a, b) => (b._cachedAt || 0) - (a._cachedAt || 0))
          return (
            <div>
              {/* Account section */}
              {user && (
                <div style={{ ...card, marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <p style={{ fontSize: 13, fontWeight: 600, color: C.text, margin: 0 }}>Signed in as</p>
                    <p style={{ fontSize: 12, color: C.textMuted, margin: '2px 0 0' }}>{user.email}</p>
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
              )}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <div>
                  <h2 style={{ fontSize: 18, fontWeight: 600, color: C.text, margin: 0 }}>Course cache</h2>
                  <p style={{ fontSize: 12, color: C.textMuted, margin: '3px 0 0' }}>
                    {entries.length} course{entries.length !== 1 ? 's' : ''} stored locally — loaded instantly, no API call needed
                  </p>
                </div>
                {entries.length > 0 && (
                  <button style={{ ...btnG, color: C.red, borderColor: C.red }}
                    onClick={() => { if (window.confirm('Clear all cached courses?')) { localStorage.removeItem(LS_COURSE_CACHE); setTab('admin') } }}>
                    Clear all cache
                  </button>
                )}
              </div>
              {entries.length === 0 ? (
                <div style={{ ...card, textAlign: 'center', padding: '3rem 2rem' }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>🗄️</div>
                  <p style={{ fontSize: 16, color: C.textMuted, margin: 0 }}>No courses cached yet</p>
                  <p style={{ fontSize: 12, color: C.textFaint, marginTop: 6 }}>Courses are saved automatically after the first search — future loads are instant</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {entries.map((c, i) => (
                    <div key={i} style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <p style={{ fontSize: 14, fontWeight: 600, color: C.text, margin: 0 }}>{c.name}</p>
                          <Badge
                            label={c.source === 'GolfCourseAPI' ? '✓ Verified' : '⚠ Web search'}
                            bg={c.source === 'GolfCourseAPI' ? C.greenMuted : C.amberMuted}
                            fg={c.source === 'GolfCourseAPI' ? C.green : C.amber}
                          />
                        </div>
                        <p style={{ fontSize: 12, color: C.textMuted, margin: '0 0 6px' }}>
                          {c.location} · Par {c.par} · {c.yardage ? Number(c.yardage).toLocaleString() + 'y' : '—'}
                          {c.rating ? ` · Rating ${c.rating}` : ''}{c.slope ? ` / Slope ${c.slope}` : ''}
                        </p>
                        <div style={{ display: 'flex', gap: 16 }}>
                          <span style={{ fontSize: 11, color: C.textFaint }}>{c.holes?.length || 18} holes</span>
                          <span style={{ fontSize: 11, color: C.textFaint }}>
                            Cached {c._cachedAt ? new Date(c._cachedAt).toLocaleDateString() : '—'}
                          </span>
                          {c.tees?.length > 0 && (
                            <span style={{ fontSize: 11, color: C.textFaint }}>
                              Tees: {c.tees.map(t => t.name).join(', ')}
                            </span>
                          )}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginLeft: 16, flexShrink: 0 }}>
                        <button style={btnG} onClick={() => { applyScorecard(c); setTab('course') }}>Load →</button>
                        <button style={{ ...btnG, color: C.red, borderColor: C.red }}
                          onClick={() => {
                            const updated = loadCourseCache()
                            delete updated[cacheKey(c.name, c.location)]
                            saveCourseCache(updated)
                            setTab('admin')
                          }}>
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })()}

        {/* Footer nav */}
        {tab !== 'plan' && tab !== 'admin' && (
          <div style={{ marginTop: 16, ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <p style={{ fontSize: 13, fontWeight: 500, color: C.text, margin: 0 }}>
                {tab === 'player'  ? 'Next: add recent scoring history' :
                 tab === 'history' ? 'Next: search for your course'    :
                 course.name       ? `Ready — generate pre-round brief for ${course.name}` :
                                    'Generate a profile-only brief, or set up a course first'}
              </p>
              <p style={{ fontSize: 11, color: C.textMuted, margin: '2px 0 0' }}>
                {tab === 'player'  ? 'Tournament vs casual splits and par-type trends feed directly into your AI brief' :
                 tab === 'history' ? 'GolfCourseAPI pulls verified hole-by-hole yardages'                               :
                 course.name       ? 'Claude generates a full hole-by-hole competitive brief with weather adjustments'  :
                                    'No course loaded — Claude will analyze your player profile and scoring patterns'}
              </p>
            </div>
            <button style={btnP} onClick={() => nextTab[tab] ? setTab(nextTab[tab]) : generate()}>
              {tab === 'course' && !course.name ? 'Skip to profile brief →' : 'Continue →'}
            </button>
          </div>
        )}
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
  const handleOnboardingComplete = async ({ player, clubs, golfApiKey }) => {
    const u = user
    if (u) {
      const playerData = { ...player, clubs }
      try {
        await saveUserProfile(u.id, player.name || 'Default', playerData)
        if (golfApiKey) await saveUserSettings(u.id, { golf_course_api_key: golfApiKey, current_profile: player.name || 'Default' })
        else await saveUserSettings(u.id, { current_profile: player.name || 'Default' })
      } catch (e) {
        console.warn('[onboarding] save error:', e.message)
      }
    }
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
