import { useState, useRef } from 'react'
import { C, card, inp, lbl, btnP } from '../theme.js'
import { useIsMobile, Badge, Spin } from './ui.jsx'
import ScorecardPreview from './ScorecardPreview.jsx'
import { searchGolfCourseAPI, searchOpenGolfAPI, fetchOpenGolfAPICourse, normalizeOpenGolfCourse, normalizeGolfCourseAPICourse, fetchScorecardViaClaudeSearch, fetchYardageBookViaClaudeSearch } from '../lib/courseApi.js'
import { getCachedCourse, setCachedCourse } from '../lib/courseCache.js'
import { getCachedCourseDB, setCachedCourseDB } from '../lib/supabase.js'

export default function CourseSearch({ authToken, onSelect }) {
  const isMobile = useIsMobile()
  const [query,    setQuery]    = useState('')
  const [location, setLocation] = useState('')
  const [results,  setResults]  = useState([])
  const [detail,   setDetail]   = useState(null)
  const [loading,  setLoading]  = useState(false)
  const [status,   setStatus]   = useState('')
  const [error,    setError]    = useState('')
  const [source,   setSource]   = useState('')
  const loadIdRef = useRef(0)

  const search = async () => {
    if (!query.trim()) return
    setLoading(true); setError(''); setStatus(''); setResults([]); setDetail(null); setSource('')
    const q = query + (location ? ' ' + location : '')

    // Shared cache lookup — pre-resolved courses skip the API ladder entirely.
    try {
      const cached = await getCachedCourseDB(query, location)
      if (cached) {
        setDetail(cached)
        setSource(cached.source ? `cache (${cached.source})` : 'cache')
        setLoading(false)
        return
      }
    } catch {}

    try {
      const courses = await searchGolfCourseAPI(q, authToken)
      if (courses.length > 0) {
        setResults(courses)
        setSource('GolfCourseAPI')
        setLoading(false)
        return
      }
    } catch {}

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

    if (!authToken) {
      setError('No results found. Sign in to enable web search fallback.')
      setLoading(false)
      return
    }
    try {
      setStatus('Searching for verified scorecard…')
      const d = await fetchScorecardViaClaudeSearch(authToken, query, location)
      const yardageSum = (d.holes || []).reduce((s, h) => s + (parseInt(h.yardage) || 0), 0)
      if (!d.holes?.length || yardageSum < 4000) throw new Error('Scorecard search returned incomplete data')
      const normalized = { ...d, _confidence: 'medium', _source: 'scorecard_search' }
      setDetail(normalized)
      setSource(d.source || 'web search')
      setCachedCourse(normalized)
      setCachedCourseDB(normalized).catch(() => {})
    } catch {
      try {
        setStatus('Falling back to yardage-book lookup…')
        const yb = await fetchYardageBookViaClaudeSearch(authToken, query, location)
        if (!yb?.holes?.length) throw new Error('Yardage book returned no holes')
        const normalized = { ...yb, _confidence: yb._confidence || 'low', _source: 'yardage_book', source: yb.source || 'yardage book', needs_review: yb._confidence !== 'high' }
        setDetail(normalized)
        setSource(`yardage book${normalized.needs_review ? ' (needs review)' : ''}`)
        setCachedCourse(normalized)
        setCachedCourseDB(normalized).catch(() => {})
      } catch (e2) {
        setError(`No results found across all sources.\n\nTry a more specific course name (e.g. include city/state) or enter yardages manually below.\n\n(${e2.message})`)
      }
    }
    setStatus('')
    setLoading(false)
  }

  const loadCourse = async (courseStub, selectedTee) => {
    const myId = ++loadIdRef.current
    setLoading(true); setError(''); setStatus(''); setDetail(null)
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
          setDetail(cached)
          setSource('cache')
          setStatus('')
          setLoading(false)
          return
        }
        normalized = normalizeGolfCourseAPICourse(courseStub, selectedTee)
        if (myId !== loadIdRef.current) return
        setCachedCourse(normalized)
        setCachedCourseDB(normalized).catch(() => {})
        setDetail(normalized)
        setSource('GolfCourseAPI')
      } else {
        const raw = await fetchOpenGolfAPICourse(courseStub.id || courseStub._id)
        if (myId !== loadIdRef.current) return
        normalized = normalizeOpenGolfCourse(raw)
        const missingYardages = normalized.holes.every(h => !h.yardage)
        if (missingYardages && authToken) {
          setStatus('Fetching yardages via web search…')
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
            setDetail(normalized)
            setSource(webData.source || 'web search')
          } catch {
            if (myId !== loadIdRef.current) return
            setDetail(normalized)
            setSource('OpenGolfAPI (no yardages — enter manually)')
          }
        } else {
          setCachedCourse(normalized)
          setCachedCourseDB(normalized).catch(() => {})
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
        <Badge label="GolfCourseAPI" bg={C.greenMuted} fg={C.green} />
        {source === 'GolfCourseAPI' && <Badge label="Full yardages" bg={C.accentMuted} fg={C.accent} />}
      </div>
      <p style={{ fontSize: 12, color: C.textMuted, marginBottom: 10, marginTop: 0 }}>
        Searches GolfCourseAPI (verified yardages), then OpenGolfAPI, then Claude web search.
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
              <p style={{ fontSize: 11, color: source === 'cache' ? C.amber : C.green, margin: '4px 0 0' }}>
                {source === 'cache' ? '⚡ Loaded from local cache — no API call' : `✓ Verified from ${source}`}
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
