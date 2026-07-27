import { useEffect, useState } from 'react'
import { queryCourseCacheDB } from '../lib/supabase.js'
import { C, F, card, btnG, lbl } from '../theme.js'
import { Badge } from './ui.jsx'
import { sourceBadge as sourceBadgeProps } from '../lib/formatters.js'

// Reads the shared course_cache directly via the Supabase JS client (uses the
// anon key + the RLS policies admins already have). Focuses on cache-health
// metrics the Courses sub-tab doesn't surface: tier distribution, source mix,
// hit-count, and courses that need a review pass.

const SOURCE_LABELS = {
  GolfCourseAPI: { label: '✓ API',         bg: C.greenMuted,  fg: C.green },
  yardage_book:  { label: '📄 Yardage book', bg: C.blueMuted,   fg: C.blue },
  OpenGolfAPI:   { label: '~ OpenGolf',     bg: C.amberMuted,  fg: C.amber },
  claude_vision: { label: '🤖 Vision',      bg: C.accentMuted, fg: C.accent },
}
function sourceBadge(src) {
  const s = SOURCE_LABELS[src] || { label: src || '—', bg: C.bgCard, fg: C.textMuted }
  return <Badge label={s.label} bg={s.bg} fg={s.fg} />
}

function StatBar({ label, value, total, color }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <span style={{ fontSize: 12, color: C.textMuted }}>{label}</span>
        <span style={{ fontSize: 12, color: C.text, fontVariantNumeric: 'tabular-nums' }}>{value} <span style={{ color: C.textFaint }}>({pct}%)</span></span>
      </div>
      <div style={{ height: 6, background: C.bgCard, borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color || C.accent, borderRadius: 99, transition: 'width 0.3s' }} />
      </div>
    </div>
  )
}

export default function AdminDataPanel({ onNavigate }) {
  const [rows,    setRows]    = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const [search,  setSearch]  = useState('')
  const [filter,  setFilter]  = useState('all') // 'all' | 'needs_review' | 'no_pdf'

  const load = async () => {
    setLoading(true); setError('')
    try {
      const { rows } = await queryCourseCacheDB({ sort: 'popular', limit: 500, raw: true })
      setRows(rows || [])
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const courses = (rows || []).map(r => ({
    key:         r.cache_key,
    name:        r.course_data?.name || r.cache_key,
    location:    r.course_data?.location || '',
    source:      r.source || r.course_data?.source || '',
    hits:        r.hit_count || 0,
    cachedAt:    r.cached_at,
    needsReview: !!r.course_data?._needs_review,
    hasPdf:      !!r.course_data?._sourcePdf,
    par:         r.course_data?.par,
    holes:       Array.isArray(r.course_data?.holes) ? r.course_data.holes.length : 0,
  }))

  const filtered = courses.filter(c => {
    if (filter === 'needs_review' && !c.needsReview) return false
    if (filter === 'no_pdf' && c.hasPdf) return false
    if (search && !c.name.toLowerCase().includes(search.toLowerCase()) &&
        !c.location.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  // Stats
  const total = courses.length
  const bySource = {}
  for (const c of courses) bySource[c.source] = (bySource[c.source] || 0) + 1
  const needsReviewCount = courses.filter(c => c.needsReview).length
  const hasPdfCount      = courses.filter(c => c.hasPdf).length
  const totalHits        = courses.reduce((s, c) => s + c.hits, 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── Cache health stats ─────────────────────────────────── */}
      <div style={{ ...card }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
          <p style={{ ...lbl, margin: 0 }}>Shared course cache ({total} courses · {totalHits.toLocaleString()} total hits)</p>
          <button style={btnG} onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
        </div>
        {error && (
          <div style={{ padding: '8px 12px', background: C.redMuted, border: `1px solid ${C.red}`, borderRadius: 8, marginBottom: 12 }}>
            <p style={{ fontSize: 12, color: C.red, margin: 0 }}>⚠ {error}</p>
          </div>
        )}
        {rows && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
            {/* Source breakdown */}
            <div>
              <p style={{ fontSize: 12, fontWeight: 600, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.06em', margin: '0 0 10px' }}>By source</p>
              {Object.entries(bySource).sort((a, b) => b[1] - a[1]).map(([src, count]) => (
                <StatBar key={src} label={src || 'unknown'} value={count} total={total}
                  color={SOURCE_LABELS[src]?.fg || C.textFaint} />
              ))}
            </div>
            {/* Health flags */}
            <div>
              <p style={{ fontSize: 12, fontWeight: 600, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.06em', margin: '0 0 10px' }}>Health flags</p>
              <StatBar label="Needs review" value={needsReviewCount} total={total} color={C.red} />
              <StatBar label="Has PDF on file" value={hasPdfCount} total={total} color={C.green} />
              <StatBar label="Fully reviewed" value={total - needsReviewCount} total={total} color={C.accent} />
            </div>
          </div>
        )}
        {rows && onNavigate && (
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
            <p style={{ fontSize: 12, color: C.textMuted, margin: '0 0 8px' }}>
              For metadata editing, PDF upload/removal, and per-course reparse, use the Courses sub-tab.
            </p>
            <button style={{ ...btnG, fontSize: 12 }} onClick={() => onNavigate('courses')}>
              Open Courses sub-tab →
            </button>
          </div>
        )}
      </div>

      {/* ── Course browser ─────────────────────────────────────── */}
      <div style={{ ...card }}>
        <p style={{ ...lbl, margin: '0 0 10px' }}>Browse cache</p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <input
            style={{ flex: 1, minWidth: 180, background: C.bgInput, border: `1px solid ${C.border}`, borderRadius: 8, padding: '7px 12px', color: C.text, fontSize: 13, fontFamily: F, outline: 'none' }}
            placeholder="Search by name or location…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select
            style={{ background: C.bgInput, border: `1px solid ${C.border}`, borderRadius: 8, padding: '7px 10px', color: C.text, fontSize: 12, fontFamily: F, cursor: 'pointer', outline: 'none' }}
            value={filter}
            onChange={e => setFilter(e.target.value)}
          >
            <option value="all">All courses</option>
            <option value="needs_review">Needs review</option>
            <option value="no_pdf">No PDF on file</option>
          </select>
        </div>

        {!rows && loading && (
          <p style={{ fontSize: 12, color: C.textFaint, margin: 0 }}>Loading…</p>
        )}
        {rows && filtered.length === 0 && (
          <p style={{ fontSize: 12, color: C.textFaint, margin: 0, fontStyle: 'italic' }}>No courses match the current filter.</p>
        )}
        {filtered.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 480, overflowY: 'auto' }}>
            {filtered.map(c => (
              <div key={c.key} style={{ background: C.bgInput, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{c.name}</span>
                    {sourceBadge(c.source)}
                    {c.needsReview && <Badge label="needs review" bg={C.redMuted} fg={C.red} />}
                    {c.hasPdf && <Badge label="PDF" bg={C.accentMuted} fg={C.accent} />}
                  </div>
                  <p style={{ fontSize: 11, color: C.textMuted, margin: 0 }}>
                    {c.location}{c.par ? ` · Par ${c.par}` : ''}{c.holes ? ` · ${c.holes} holes` : ''}
                    {' · '}{c.hits.toLocaleString()} hits
                    {c.cachedAt ? ` · Cached ${new Date(c.cachedAt).toLocaleDateString()}` : ''}
                  </p>
                </div>
              </div>
            ))}
            {filtered.length === 500 && (
              <p style={{ fontSize: 11, color: C.textFaint, textAlign: 'center', margin: '4px 0 0', fontStyle: 'italic' }}>
                Showing first 500 results — use search to narrow down.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
