import { useEffect, useMemo, useState, useRef } from 'react'
import { C, F, card, inp, lbl, btnP, btnG } from '../theme.js'
import { Badge } from '../components/ui.jsx'
import { supabase } from '../lib/supabase.js'
import CourseDetailDrawer from '../components/CourseDetailDrawer.jsx'

const PAGE_SIZE = 50

const SORT_OPTIONS = [
  { id: 'popular', label: 'Most popular' },
  { id: 'recent',  label: 'Recently added' },
  { id: 'name',    label: 'Name (A→Z)' },
]

function sourceBadge(source) {
  if (source === 'GolfCourseAPI') return { label: '✓ API',       bg: C.greenMuted,  fg: C.green  }
  if (source === 'yardage_book')  return { label: '📄 Yardage',  bg: C.blueMuted,   fg: C.blue   }
  if (source === 'OpenGolfAPI')   return { label: '~ OpenGolf',  bg: C.amberMuted,  fg: C.amber  }
  if (source === 'Claude')        return { label: '⚡ AI',        bg: C.accentMuted, fg: C.accent }
  return { label: source || '?', bg: C.bgInput, fg: C.textMuted }
}

function CourseCard({ course, onClick }) {
  const sb = sourceBadge(course.source)
  const holeCount = Array.isArray(course.course_data?.holes) ? course.course_data.holes.length : null
  return (
    <button
      onClick={() => onClick(course)}
      style={{
        ...card, padding: '14px 16px',
        cursor: 'pointer', textAlign: 'left', width: '100%',
        background: C.bgCard,
        border: `1px solid ${C.border}`,
        transition: 'border-color 0.12s',
        fontFamily: F,
      }}
      onMouseEnter={e => e.currentTarget.style.borderColor = C.accentDim}
      onMouseLeave={e => e.currentTarget.style.borderColor = C.border}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: C.text }}>{course.name}</p>
            {course.is_public && <Badge label="Library" bg={C.accentMuted} fg={C.accent} />}
          </div>
          <p style={{ margin: 0, fontSize: 12, color: C.textMuted }}>
            {course.location || '—'}
          </p>
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Badge label={sb.label} bg={sb.bg} fg={sb.fg} />
            {course.par && <Badge label={`Par ${course.par}`} bg={C.bgInput} fg={C.textMuted} />}
            {holeCount && <Badge label={`${holeCount} holes`} bg={C.bgInput} fg={C.textMuted} />}
            {course.hit_count > 0 && (
              <span style={{ fontSize: 11, color: C.textFaint }}>{course.hit_count} uses</span>
            )}
          </div>
        </div>
        <span style={{ color: C.textFaint, fontSize: 16, flexShrink: 0 }}>›</span>
      </div>
    </button>
  )
}

export default function LibraryTab({ isMobile, session, onUseForPrep }) {
  const [rows, setRows]           = useState(null)
  const [total, setTotal]         = useState(0)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')
  const [search, setSearch]       = useState('')
  const [sort, setSort]           = useState('popular')
  const [publicOnly, setPublicOnly] = useState(false)
  const [offset, setOffset]       = useState(0)
  const [selected, setSelected]   = useState(null)
  const searchTimer = useRef(null)

  const load = async (opts = {}) => {
    const q   = opts.search   ?? search
    const srt = opts.sort     ?? sort
    const pub = opts.publicOnly ?? publicOnly
    const off = opts.offset   ?? 0

    setLoading(true); setError('')
    try {
      let query = supabase
        .from('course_cache')
        .select('cache_key,course_data,source,cached_at,hit_count,is_public', { count: 'exact' })
        .range(off, off + PAGE_SIZE - 1)

      if (pub) query = query.eq('is_public', true)

      // Text search on cache_key (name|location pattern)
      if (q.trim()) {
        query = query.ilike('cache_key', `%${q.trim().toLowerCase()}%`)
      }

      if (srt === 'popular') query = query.order('hit_count', { ascending: false })
      else if (srt === 'recent') query = query.order('cached_at', { ascending: false })
      else if (srt === 'name')   query = query.order('cache_key',  { ascending: true })

      const { data, count, error: err } = await query
      if (err) throw err

      // Flatten course_data fields for easy card rendering
      const normalized = (data || []).map(r => ({
        ...r,
        _cacheKey: r.cache_key,
        name:     r.course_data?.name     || r.cache_key,
        location: r.course_data?.location || '',
        par:      r.course_data?.par      || null,
        coords:   r.course_data?.coords   || null,
        holes:    r.course_data?.holes    || [],
        yardage:  r.course_data?.yardage  || null,
        rating:   r.course_data?.rating   || null,
        slope:    r.course_data?.slope    || null,
        hazardSummary: r.course_data?.hazardSummary || [],
        cacheKey: r.cache_key,
        cachedAt: r.cached_at,
        hitCount: r.hit_count,
        isPublic: !!r.is_public,
      }))

      if (off === 0) {
        setRows(normalized)
      } else {
        setRows(prev => [...(prev || []), ...normalized])
      }
      setTotal(count || 0)
      setOffset(off)
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }

  // Initial load
  useEffect(() => { load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])

  const handleSearch = (val) => {
    setSearch(val)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => {
      setOffset(0)
      load({ search: val, offset: 0 })
    }, 300)
  }

  const handleSort = (val) => {
    setSort(val)
    setOffset(0)
    load({ sort: val, offset: 0 })
  }

  const handlePublicOnly = (val) => {
    setPublicOnly(val)
    setOffset(0)
    load({ publicOnly: val, offset: 0 })
  }

  const loadMore = () => load({ offset: offset + PAGE_SIZE })

  const hasMore = rows != null && rows.length < total

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Hero header */}
      <div style={{ ...card, padding: '20px 20px 16px' }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 700, color: C.text }}>Course Library</h2>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: C.textMuted }}>
          Browse courses in the shared database. Click any course to view the scorecard, satellite view, and details — then load it directly into Round Prep.
        </p>

        {/* Search + filters */}
        <div style={{ display: 'grid', gridTemplateColumns: `1fr ${isMobile ? '' : '160px 160px'}`, gap: 10, alignItems: 'flex-end' }}>
          <div>
            <label style={lbl}>Search</label>
            <input
              style={inp}
              value={search}
              onChange={e => handleSearch(e.target.value)}
              placeholder="Course name or location…"
            />
          </div>
          {!isMobile && (
            <>
              <div>
                <label style={lbl}>Sort</label>
                <select style={inp} value={sort} onChange={e => handleSort(e.target.value)}>
                  {SORT_OPTIONS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={lbl}>Filter</label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.textMuted, cursor: 'pointer' }}>
                  <input type="checkbox" checked={publicOnly} onChange={e => handlePublicOnly(e.target.checked)} />
                  Library courses only
                </label>
              </div>
            </>
          )}
        </div>

        {isMobile && (
          <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <select style={{ ...inp, flex: '1 1 140px' }} value={sort} onChange={e => handleSort(e.target.value)}>
              {SORT_OPTIONS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.textMuted, cursor: 'pointer' }}>
              <input type="checkbox" checked={publicOnly} onChange={e => handlePublicOnly(e.target.checked)} />
              Library only
            </label>
          </div>
        )}
      </div>

      {/* Stats line */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 4px' }}>
        <p style={{ margin: 0, fontSize: 12, color: C.textMuted }}>
          {rows == null
            ? 'Loading…'
            : `${total.toLocaleString()} course${total === 1 ? '' : 's'} in database${rows.length < total ? ` · showing ${rows.length}` : ''}`}
        </p>
        {!session && (
          <p style={{ margin: 0, fontSize: 11, color: C.textFaint }}>
            Sign in to use courses in Round Prep
          </p>
        )}
      </div>

      {/* Error */}
      {error && (
        <div style={{ padding: '10px 14px', background: C.redMuted, border: `1px solid ${C.red}`, borderRadius: 8 }}>
          <p style={{ margin: 0, fontSize: 12, color: C.red }}>⚠ {error}</p>
        </div>
      )}

      {/* Results grid */}
      {rows && rows.length === 0 && !loading && (
        <div style={{ ...card, textAlign: 'center', padding: '32px 20px' }}>
          <p style={{ margin: 0, fontSize: 14, color: C.textMuted }}>No courses match your search.</p>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: C.textFaint }}>
            Try a different search term, or clear the filters.
          </p>
        </div>
      )}

      {rows && rows.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(320px, 1fr))', gap: 10 }}>
          {rows.map(course => (
            <CourseCard key={course.cache_key} course={course} onClick={setSelected} />
          ))}
        </div>
      )}

      {/* Load more */}
      {hasMore && (
        <div style={{ textAlign: 'center', paddingTop: 8 }}>
          <button style={btnG} onClick={loadMore} disabled={loading}>
            {loading ? 'Loading…' : `Load more (${total - rows.length} remaining)`}
          </button>
        </div>
      )}

      {loading && rows == null && (
        <div style={{ ...card, textAlign: 'center', padding: '32px 20px' }}>
          <p style={{ margin: 0, fontSize: 13, color: C.textMuted }}>Loading courses…</p>
        </div>
      )}

      {/* Course detail drawer */}
      {selected && (
        <CourseDetailDrawer
          course={selected}
          session={session}
          onClose={() => setSelected(null)}
          onUseForPrep={onUseForPrep}
        />
      )}
    </div>
  )
}
