import { useEffect, useRef, useState } from 'react'
import { C, card, inp, lbl, btnP, btnG } from '../theme.js'
import { useIsMobile, Badge, Spin } from './ui.jsx'
import ProgressTracker from './ProgressTracker.jsx'
import ScorecardPreview from './ScorecardPreview.jsx'
import {
  searchGolfCourseAPI, searchOpenGolfAPI, fetchOpenGolfAPICourse,
  normalizeOpenGolfCourse, normalizeGolfCourseAPICourse,
  fetchScorecardViaClaudeSearch, fetchYardageBookViaClaudeSearch,
} from '../lib/courseApi.js'
import { getCachedCourse, setCachedCourse, searchLocalCache } from '../lib/courseCache.js'
import { getCachedCourseDB, setCachedCourseDB, queryCourseCacheDB } from '../lib/supabase.js'
import { STEP_STATES } from '../lib/progress.js'

// Step IDs are stable so ProgressTracker can map states to rows.
const STEP_LOCAL  = 'local'
const STEP_DB     = 'db'
const STEP_GCA    = 'gca'
const STEP_OGA    = 'oga'
const STEP_WEB    = 'web'
const STEP_YBOOK  = 'ybook'

const FAST_STEPS = [
  { id: STEP_LOCAL, label: 'Local cache' },
  { id: STEP_DB,    label: 'Shared cache' },
  { id: STEP_GCA,   label: 'GolfCourseAPI',  expectedMs: 2000 },
  { id: STEP_OGA,   label: 'OpenGolfAPI',    expectedMs: 2500 },
]

const WEB_STEPS = [
  { id: STEP_WEB,   label: 'Verified scorecard (web search)', expectedMs: 6000 },
  { id: STEP_YBOOK, label: 'Yardage book lookup',             expectedMs: 8000 },
]

export default function CourseSearch({ authToken, onSelect, onBrowseLibrary }) {
  const isMobile = useIsMobile()
  const [query,    setQuery]    = useState('')
  const [location, setLocation] = useState('')
  const [results,  setResults]  = useState([])
  const [detail,   setDetail]   = useState(null)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')
  const [source,   setSource]   = useState('')
  const [libraryResults, setLibraryResults] = useState([])
  // Progress state: which steps are pending/running/done/skipped/error.
  const [progress, setProgress] = useState({ steps: FAST_STEPS, states: {}, startsAt: {}, endsAt: {}, errors: {} })
  // Live local-cache suggestions while the user is still typing.
  const [suggestions, setSuggestions] = useState([])
  // Becomes true after fast-source search runs and returns nothing, so the
  // "Search the web" button is the user's explicit next move.
  const [webPromptVisible, setWebPromptVisible] = useState(false)
  const loadIdRef = useRef(0)
  const abortRef = useRef(null)

  // Local-cache suggestion strip — debounced 250ms so we're not re-scanning
  // localStorage on every keystroke even though it's cheap.
  useEffect(() => {
    if (!query.trim()) { setSuggestions([]); return }
    const t = setTimeout(() => setSuggestions(searchLocalCache(query, location, 5)), 250)
    return () => clearTimeout(t)
  }, [query, location])

  const setStepState = (id, state, patch = {}) => {
    setProgress(p => ({
      ...p,
      states:   { ...p.states,   [id]: state },
      startsAt: patch.startedAt != null ? { ...p.startsAt, [id]: patch.startedAt } : p.startsAt,
      endsAt:   patch.endedAt   != null ? { ...p.endsAt,   [id]: patch.endedAt }   : p.endsAt,
      errors:   patch.error     != null ? { ...p.errors,   [id]: patch.error }     : p.errors,
    }))
  }

  const beginSearch = (steps) => {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setProgress({ steps, states: {}, startsAt: {}, endsAt: {}, errors: {} })
    return ac
  }

  const finishCachedHit = (entry, label) => {
    setDetail(entry)
    setSource(label)
    setLoading(false)
    setWebPromptVisible(false)
  }

  // Fuzzy search course_cache for courses matching the current query.
  // Called when fast sources fail so we surface library options before Claude.
  const searchLibrary = async (q, loc) => {
    const searchStr = (q + (loc ? ' ' + loc : '')).trim()
    const { rows } = await queryCourseCacheDB({ search: searchStr, sort: 'popular', limit: 5 })
    if (!rows?.length) return
    const hits = rows.map(r => ({
      ...r,
      _isPublic: r.is_public,
    }))
    setLibraryResults(hits)
  }

  // Race the GolfCourseAPI and OpenGolfAPI lookups. Whichever produces a
  // non-empty result set first wins; the other's still allowed to populate
  // its row in the tracker for honesty.
  const runFastSources = async (q, ac) => {
    let winner = null
    const tasks = [
      runOne(STEP_GCA, () => searchGolfCourseAPI(q, authToken, { signal: ac.signal }), 'GolfCourseAPI'),
      runOne(STEP_OGA, async () => {
        const data = await searchOpenGolfAPI(q, { signal: ac.signal })
        return Array.isArray(data) ? data : (data.courses || data.results || [])
      }, 'OpenGolfAPI'),
    ]
    const settled = await Promise.allSettled(tasks)
    for (const r of settled) {
      if (r.status !== 'fulfilled' || !r.value) continue
      const { source: src, courses } = r.value
      if (courses?.length && !winner) winner = { src, courses }
    }
    return winner
  }

  // Execute one ladder step, recording start/end + state into ProgressTracker.
  // Returns { source, courses } on success, throws otherwise so the caller can
  // decide whether to swallow the failure.
  const runOne = async (stepId, fn, sourceLabel) => {
    const startedAt = Date.now()
    setStepState(stepId, STEP_STATES.RUNNING, { startedAt })
    try {
      const courses = await fn()
      setStepState(stepId, courses?.length ? STEP_STATES.DONE : STEP_STATES.SKIPPED, { endedAt: Date.now() })
      return { source: sourceLabel, courses }
    } catch (e) {
      if (e?.name === 'AbortError') {
        // Don't paint a red row on user-driven cancellation.
        setStepState(stepId, STEP_STATES.SKIPPED, { endedAt: Date.now() })
      } else {
        setStepState(stepId, STEP_STATES.ERROR, { endedAt: Date.now(), error: e.message })
      }
      throw e
    }
  }

  const search = async () => {
    if (!query.trim()) return
    setLoading(true); setError(''); setResults([]); setDetail(null); setSource('')
    setWebPromptVisible(false); setLibraryResults([])
    const ac = beginSearch(FAST_STEPS)

    // Step 1 — instant local cache check. The DB cache key needs an exact
    // (name, location) match, so we use the query field as the name guess
    // first; if that misses, we still fan out to the network sources.
    setStepState(STEP_LOCAL, STEP_STATES.RUNNING, { startedAt: Date.now() })
    const localExact = getCachedCourse(query, location)
    const localFuzzy = searchLocalCache(query, location, 1)
    const localHit   = localExact || localFuzzy[0]
    setStepState(STEP_LOCAL, localHit ? STEP_STATES.DONE : STEP_STATES.SKIPPED, { endedAt: Date.now() })
    if (localHit) {
      finishCachedHit(localHit, 'local cache')
      // Mark the rest as skipped so the tracker reflects that we stopped early.
      for (const id of [STEP_DB, STEP_GCA, STEP_OGA]) setStepState(id, STEP_STATES.SKIPPED)
      return
    }

    // Step 2 — shared (Supabase) cache.
    try {
      const startedAt = Date.now()
      setStepState(STEP_DB, STEP_STATES.RUNNING, { startedAt })
      const cached = await getCachedCourseDB(query, location)
      setStepState(STEP_DB, cached ? STEP_STATES.DONE : STEP_STATES.SKIPPED, { endedAt: Date.now() })
      if (cached) {
        finishCachedHit(cached, cached.source ? `cache (${cached.source})` : 'cache')
        for (const id of [STEP_GCA, STEP_OGA]) setStepState(id, STEP_STATES.SKIPPED)
        return
      }
    } catch {
      setStepState(STEP_DB, STEP_STATES.SKIPPED, { endedAt: Date.now() })
    }

    // Step 3 — race the two scorecard APIs in parallel.
    const q = query + (location ? ' ' + location : '')
    let winner
    try {
      winner = await runFastSources(q, ac)
    } catch {}
    if (ac.signal.aborted) { setLoading(false); return }

    if (winner) {
      setResults(winner.courses)
      setSource(winner.src)
      setLoading(false)
      return
    }

    // No fast-source hit. Surface the opt-in web search button instead of
    // burning 5–8s automatically. Also kick off a background library search
    // so we can surface library courses before asking the user to burn Claude.
    setWebPromptVisible(true)
    searchLibrary(query, location).catch(() => {})
    if (!authToken) {
      setError('No results from the verified sources. Sign in to enable the web-search fallback.')
    }
    setLoading(false)
  }

  // Opt-in web-search ladder — runs the two Claude-backed sources sequentially
  // (the scorecard parse is more authoritative; only fall back to yardage book
  // when it fails). The ProgressTracker switches to the web step list.
  const searchTheWeb = async () => {
    if (!authToken) {
      setError('Sign in to enable web search fallback.')
      return
    }
    setLoading(true); setError(''); setDetail(null); setResults([])
    const ac = beginSearch(WEB_STEPS)
    try {
      const startedAt = Date.now()
      setStepState(STEP_WEB, STEP_STATES.RUNNING, { startedAt })
      const d = await fetchScorecardViaClaudeSearch(authToken, query, location, { signal: ac.signal })
      if (ac.signal.aborted) return
      const yardageSum = (d.holes || []).reduce((s, h) => s + (parseInt(h.yardage) || 0), 0)
      if (!d.holes?.length || yardageSum < 4000) throw new Error('Scorecard search returned incomplete data')
      setStepState(STEP_WEB, STEP_STATES.DONE, { endedAt: Date.now() })
      setStepState(STEP_YBOOK, STEP_STATES.SKIPPED)
      const normalized = { ...d, _confidence: 'medium', _source: 'scorecard_search' }
      setDetail(normalized)
      setSource(d.source || 'web search')
      setCachedCourse(normalized)
      setCachedCourseDB(normalized).catch(() => {})
      setWebPromptVisible(false)
    } catch (e1) {
      if (ac.signal.aborted) { setLoading(false); return }
      setStepState(STEP_WEB, STEP_STATES.ERROR, { endedAt: Date.now(), error: e1.message })
      try {
        const startedAt = Date.now()
        setStepState(STEP_YBOOK, STEP_STATES.RUNNING, { startedAt })
        const yb = await fetchYardageBookViaClaudeSearch(authToken, query, location, { signal: ac.signal })
        if (ac.signal.aborted) return
        if (!yb?.holes?.length) throw new Error('Yardage book returned no holes')
        setStepState(STEP_YBOOK, STEP_STATES.DONE, { endedAt: Date.now() })
        const normalized = { ...yb, _confidence: yb._confidence || 'low', _source: 'yardage_book', source: yb.source || 'yardage book', needs_review: yb._confidence !== 'high' }
        setDetail(normalized)
        setSource(`yardage book${normalized.needs_review ? ' (needs review)' : ''}`)
        setCachedCourse(normalized)
        setCachedCourseDB(normalized).catch(() => {})
        setWebPromptVisible(false)
      } catch (e2) {
        if (ac.signal.aborted) { setLoading(false); return }
        setStepState(STEP_YBOOK, STEP_STATES.ERROR, { endedAt: Date.now(), error: e2.message })
        setError(`No results found across all sources.\n\nTry a more specific course name (e.g. include city/state) or enter yardages manually below.\n\n(${e2.message})`)
      }
    }
    setLoading(false)
  }

  const cancelInFlight = () => { abortRef.current?.abort(); setLoading(false) }

  const loadCourse = async (courseStub, selectedTee) => {
    const myId = ++loadIdRef.current
    setLoading(true); setError(''); setDetail(null)
    try {
      let normalized
      if (courseStub._source === 'GolfCourseAPI') {
        const stubName = courseStub.course_name || courseStub.name || ''
        const rawLoc   = courseStub.location
        const stubLoc  = typeof rawLoc === 'object' && rawLoc !== null
          ? [rawLoc.city, rawLoc.state].filter(Boolean).join(', ')
          : (rawLoc || '')
        const teeSuffix = selectedTee ? `|${selectedTee.tee_name}` : ''
        const cached = getCachedCourse(stubName + teeSuffix, stubLoc)
          || await getCachedCourseDB(stubName + teeSuffix, stubLoc).catch(() => null)
        if (cached) {
          if (myId !== loadIdRef.current) return
          setDetail(cached); setSource('cache'); setLoading(false)
          return
        }
        normalized = normalizeGolfCourseAPICourse(courseStub, selectedTee)
        if (myId !== loadIdRef.current) return
        setCachedCourse(normalized)
        setCachedCourseDB(normalized).catch(() => {})
        setDetail(normalized); setSource('GolfCourseAPI')
      } else {
        const raw = await fetchOpenGolfAPICourse(courseStub.id || courseStub._id)
        if (myId !== loadIdRef.current) return
        normalized = normalizeOpenGolfCourse(raw)
        const missingYardages = normalized.holes.every(h => !h.yardage)
        if (missingYardages && authToken) {
          try {
            const webData = await fetchScorecardViaClaudeSearch(authToken, normalized.name, normalized.location)
            if (myId !== loadIdRef.current) return
            normalized = {
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
            setCachedCourse(normalized)
            setCachedCourseDB(normalized).catch(() => {})
            setDetail(normalized); setSource(webData.source || 'web search')
          } catch {
            if (myId !== loadIdRef.current) return
            setDetail(normalized); setSource('OpenGolfAPI (no yardages — enter manually)')
          }
        } else {
          setCachedCourse(normalized)
          setCachedCourseDB(normalized).catch(() => {})
          setDetail(normalized); setSource(normalized.source || 'OpenGolfAPI')
        }
      }
    } catch (e) {
      if (myId !== loadIdRef.current) return
      setError(`Failed to load scorecard: ${e.message}`)
    }
    setLoading(false)
  }

  const showProgressTracker = loading || Object.keys(progress.states).length > 0

  return (
    <div style={{ ...card, marginBottom: 14, borderColor: C.accentMuted }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <p style={{ ...lbl, margin: 0 }}>Search verified scorecard</p>
        <Badge label="GolfCourseAPI" bg={C.greenMuted} fg={C.green} />
        {source === 'GolfCourseAPI' && <Badge label="Full yardages" bg={C.accentMuted} fg={C.accent} />}
      </div>
      <p style={{ fontSize: 12, color: C.textMuted, marginBottom: 10, marginTop: 0 }}>
        Local cache first, then GolfCourseAPI and OpenGolfAPI in parallel. Web search is opt-in.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 160px auto', gap: 8 }}>
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
          <button style={{ ...btnP, display: 'flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap', minHeight: 44 }} onClick={search} disabled={loading} aria-label="Search for golf course">
            {loading ? <><Spin /> Searching...</> : 'Search →'}
          </button>
        </div>
      </div>

      {/* Suggestion strip — instant local-cache matches while typing. Hidden once
          a search has actually been run so it doesn't clash with results. */}
      {suggestions.length > 0 && !detail && !results.length && !loading && (
        <div style={{ marginTop: 10 }}>
          <p style={{ fontSize: 11, color: C.textFaint, margin: '0 0 4px' }}>From your local cache:</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {suggestions.map((s, i) => (
              <button key={i}
                onClick={() => finishCachedHit(s, 'local cache')}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  background: C.bgInput, border: `1px solid ${C.border}`, borderRadius: 6,
                  padding: '6px 10px', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                }}>
                <span style={{ fontSize: 12, color: C.text }}>{s.name}</span>
                <span style={{ fontSize: 11, color: C.textFaint }}>{s.location}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {showProgressTracker && (
        <div style={{ marginTop: 10 }}>
          <ProgressTracker
            steps={progress.steps}
            states={progress.states}
            startsAt={progress.startsAt}
            endsAt={progress.endsAt}
            errors={progress.errors}
            onCancel={loading ? cancelInFlight : undefined}
            cancelLabel="Cancel search"
            compact
          />
        </div>
      )}

      {webPromptVisible && !detail && !loading && (
        <>
          {/* Library results — shown first so users can pick without burning Claude */}
          {libraryResults.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <p style={{ fontSize: 11, color: C.textFaint, margin: '0 0 6px' }}>Found in library:</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {libraryResults.map((r, i) => (
                  <button key={i}
                    onClick={() => finishCachedHit(r, r._isPublic ? 'library' : 'shared cache')}
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      background: C.bgInput, border: `1px solid ${C.border}`, borderRadius: 7,
                      padding: '8px 12px', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                    }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = C.accentDim}
                    onMouseLeave={e => e.currentTarget.style.borderColor = C.border}
                  >
                    <div>
                      <span style={{ fontSize: 13, color: C.text, fontWeight: 500 }}>{r.name}</span>
                      <span style={{ fontSize: 11, color: C.textMuted, marginLeft: 8 }}>{r.location}</span>
                      {r.par && <span style={{ fontSize: 11, color: C.textFaint, marginLeft: 6 }}>· Par {r.par}</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                      {r._isPublic && <Badge label="Library" bg={C.accentMuted} fg={C.accent} />}
                      <span style={{ fontSize: 11, color: C.textMuted }}>Use →</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div style={{ marginTop: 10, padding: '10px 14px', background: C.bgInput, border: `1px dashed ${C.border}`, borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <p style={{ fontSize: 12, color: C.textMuted, margin: 0 }}>
              Can't find it in the verified sources? Try Claude's web search — slower (5–8s) and not free.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {onBrowseLibrary && (
                <button style={btnG} onClick={() => onBrowseLibrary(query)}>Browse library →</button>
              )}
              <button style={btnG} onClick={searchTheWeb} disabled={!authToken}>
                Search the web →
              </button>
            </div>
          </div>
        </>
      )}

      {error && (
        <div style={{ marginTop: 10, padding: '10px 14px', background: C.redMuted, border: `1px solid ${C.red}`, borderRadius: 8 }}>
          <p style={{ fontSize: 12, color: C.red, margin: 0, whiteSpace: 'pre-wrap' }}>⚠ {error}</p>
          {onBrowseLibrary && (
            <button style={{ ...btnG, marginTop: 8, fontSize: 11 }} onClick={() => onBrowseLibrary(query)}>
              Browse the course library →
            </button>
          )}
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
            const hasTees  = isGCA && maleTees.length > 0
            const backTee  = maleTees.find(t => /black|championship|tournament/i.test(t.tee_name))
              || maleTees.find(t => /blue/i.test(t.tee_name))
              || maleTees.reduce((best, t) => (!best || t.total_yards > best.total_yards) ? t : best, null)
            return (
              <div key={i} style={{ background: C.bgInput, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <p style={{ fontSize: 13, fontWeight: 500, color: C.text, margin: 0 }}>{name}</p>
                  <p style={{ fontSize: 11, color: C.textMuted, margin: '2px 0 0' }}>
                    {[city, state].filter(Boolean).join(', ')}
                    {backTee && <span style={{ color: C.accent }}> · {backTee.tee_name} {backTee.total_yards?.toLocaleString()}y · Par {backTee.par_total} · {backTee.course_rating}/{backTee.slope_rating}</span>}
                    {hasTees && <span style={{ color: C.textFaint }}> · {maleTees.length} tees</span>}
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
            <div>
              <p style={{ fontSize: 14, fontWeight: 600, color: C.text, margin: 0 }}>{detail.name}</p>
              <p style={{ fontSize: 12, color: C.textMuted, margin: '2px 0 0' }}>
                {detail.location} · Par {detail.par} · {detail.yardage ? Number(detail.yardage).toLocaleString() + 'y' : ''}
                {detail.rating && ` · Rating ${detail.rating}`}{detail.slope && ` / Slope ${detail.slope}`}
              </p>
              <p style={{ fontSize: 11, color: source.startsWith('local') || source.startsWith('cache') ? C.amber : C.green, margin: '4px 0 0' }}>
                {source.startsWith('local') ? '⚡ Loaded from local cache — no API call' :
                 source.startsWith('cache') ? '⚡ Loaded from shared cache — no API call' :
                 `✓ Verified from ${source}`}
              </p>
              {detail.osmEnriched && (
                <p style={{ fontSize: 11, color: C.blue, margin: '2px 0 0' }}>
                  🗺 Hole design data loaded from OpenStreetMap (hazards, greens)
                </p>
              )}
            </div>
            <button style={btnP} onClick={() => onSelect(detail)}>Use this scorecard →</button>
          </div>
          <ScorecardPreview holes={detail.holes} />
        </div>
      )}
    </div>
  )
}
