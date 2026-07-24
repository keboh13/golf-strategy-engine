import { useEffect, useMemo, useState } from 'react'
import { C, F, card, inp, lbl, btnP, btnG } from '../theme.js'
import { Badge } from './ui.jsx'
import {
  getAllCachedCoursesDB,
  deleteCachedCourseDB,
  listCoursePdfs,
  uploadCoursePdfToBucket,
  deleteAllCoursePdfs,
  deleteCourseHazards,
  clearCachedScorecardPdfRef,
} from '../lib/supabase.js'
import { deleteCachedGeoDB } from '../lib/courseGeoCache.js'
import { adminUploadScorecardPdf } from '../lib/courseApi.js'
import AdminReparseQueue   from './AdminReparseQueue.jsx'
import AdminBulkImport     from './AdminBulkImport.jsx'
import AdminContributions  from './AdminContributions.jsx'
import AdminGeometryEditor from './AdminGeometryEditor.jsx'

const COURSE_SUBS = [
  { id: 'browser',      label: 'Browser',      icon: '⛳' },
  { id: 'reparse',      label: 'Reparse queue', icon: '🔄' },
  { id: 'import',       label: 'Bulk import',   icon: '📥' },
  { id: 'contribs',     label: 'Contributions', icon: '📍' },
  { id: 'geometry',     label: 'Geometry',      icon: '🗺' },
]

const SOURCE_FILTERS = [
  { id: 'all',     label: 'All sources' },
  { id: 'gca',     label: 'GolfCourseAPI', match: 'GolfCourseAPI' },
  { id: 'oga',     label: 'OpenGolf',      match: 'OpenGolfAPI' },
  { id: 'pdf',     label: 'Yardage book',  match: 'yardage_book' },
]

const SORT_OPTIONS = [
  { id: 'recent',   label: 'Newest cached' },
  { id: 'hits',     label: 'Most hits' },
  { id: 'name',     label: 'Course name (A→Z)' },
]

function shortDate(iso) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString() } catch { return iso }
}

function sourceBadge(c) {
  if (c.source === 'GolfCourseAPI') return { label: '✓ API', bg: C.greenMuted, fg: C.green }
  if (c.source === 'yardage_book')  return { label: '📄 Yardage book', bg: C.blueMuted, fg: C.blue }
  if (c.source === 'OpenGolfAPI')   return { label: '~ OpenGolf', bg: C.amberMuted, fg: C.amber }
  return { label: c.source || '—', bg: C.bgInput, fg: C.textMuted }
}

export default function AdminCoursesPanel({ authToken, onEditCourse }) {
  const [sub, setSub] = useState('browser')
  const [rows, setRows] = useState(null)        // null = not loaded yet
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [busyKey, setBusyKey] = useState('')    // cache_key currently uploading/removing
  const [msg, setMsg] = useState('')

  const authHeaders = authToken
    ? { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' }
  const [search, setSearch] = useState('')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [onlyNeedsReview, setOnlyNeedsReview] = useState(false)
  const [onlyHasPdf, setOnlyHasPdf] = useState(false)
  const [sort, setSort] = useState('recent')

  const load = async () => {
    setLoading(true); setError(''); setMsg('')
    try {
      const courses = await getAllCachedCoursesDB()
      // PDFs come from a separate bucket query — fan out the lookups so the
      // table can render badges and the "has PDF" filter immediately.
      const withPdfs = await Promise.all(
        (courses || []).map(async (c) => ({
          ...c,
          _pdfs: await listCoursePdfs(c.name, c.location).catch(() => []),
        }))
      )
      setRows(withPdfs)
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }

  // Auto-load on mount — the admin clicked into Courses; almost certainly
  // wants to see them. Network is small, the wait is short.
  useEffect(() => { load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])

  const filtered = useMemo(() => {
    if (!rows) return []
    const q = search.trim().toLowerCase()
    const sf = SOURCE_FILTERS.find(s => s.id === sourceFilter)
    let out = rows
    if (q) out = out.filter(c =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.location || '').toLowerCase().includes(q)
    )
    if (sf?.match) out = out.filter(c => c.source === sf.match)
    if (onlyNeedsReview) out = out.filter(c => !!c._needs_review)
    if (onlyHasPdf)      out = out.filter(c => (c._pdfs?.length || 0) > 0 || !!c._sourcePdf)
    if (sort === 'name')   out = [...out].sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    if (sort === 'hits')   out = [...out].sort((a, b) => (b._hitCount || 0) - (a._hitCount || 0))
    if (sort === 'recent') out = [...out].sort((a, b) => new Date(b.cached_at || 0) - new Date(a.cached_at || 0))
    return out
  }, [rows, search, sourceFilter, onlyNeedsReview, onlyHasPdf, sort])

  const handleUpload = async (c, file) => {
    if (!file) return
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setMsg('Error: file must be a PDF.'); return
    }
    setBusyKey(c._cacheKey); setMsg(`Uploading PDF for ${c.name}…`)
    try {
      const { url } = await uploadCoursePdfToBucket(c.name, c.location, file)
      setMsg(`Parsing PDF for ${c.name}…`)
      const result = await adminUploadScorecardPdf(authToken, {
        courseName: c.name,
        location: c.location,
        pdfUrl: url,
      })
      const conf = result?._confidence || 'medium'
      const cov = result?.hazardCoverage
      const covMsg = cov
        ? cov.covered === cov.total
          ? ` Hazards: ${cov.covered}/${cov.total} holes.`
          : ` Hazards: ${cov.covered}/${cov.total} holes — missing ${cov.missingHoles.join(', ')}.`
        : ''
      setMsg(`✓ Scorecard updated for ${c.name} (confidence: ${conf}).${covMsg} Visible to all users.`)
      await load()
    } catch (e) {
      setMsg(`Error: ${e.message}`)
    }
    setBusyKey('')
  }

  const handleTogglePublic = async (c) => {
    const nextVal = !c.is_public
    setBusyKey(c._cacheKey); setMsg('')
    try {
      const res = await fetch('/api/admin-course', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ action: 'set-public', course_key: c._cacheKey, is_public: nextVal }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.status)
      setRows(prev => prev ? prev.map(r => r._cacheKey === c._cacheKey ? { ...r, is_public: nextVal } : r) : prev)
      setMsg(`✓ ${c.name} is ${nextVal ? 'now in the Library' : 'removed from the Library'}.`)
    } catch (e) {
      setMsg(`Error: ${e.message}`)
    }
    setBusyKey('')
  }

  const handleRemove = async (c) => {
    if (!window.confirm(`Remove the uploaded scorecard PDF + extracted hazards for ${c.name}?\n\nThe course will fall back to API / auto-discovered data on next lookup. All users will see this change.`)) return
    setBusyKey(c._cacheKey); setMsg('')
    try {
      const n = await deleteAllCoursePdfs(c.name, c.location)
      await deleteCourseHazards(c.name, c.location)
      await clearCachedScorecardPdfRef(c.name, c.location)
      setMsg(`✓ Removed ${n} PDF${n === 1 ? '' : 's'} + hazards for ${c.name}.`)
      await load()
    } catch (e) {
      setMsg(`Error: ${e.message}`)
    }
    setBusyKey('')
  }

  const handleDeleteFromCache = async (c) => {
    if (!window.confirm(
      `Permanently delete "${c.name}" from the shared cache?\n\n` +
      `This removes the course_cache row, its geometry (course_geo), all stored PDFs, ` +
      `and extracted hazards. Any user who next loads this course will trigger a fresh ` +
      `API + OSM lookup. This cannot be undone.`
    )) return
    setBusyKey(c._cacheKey); setMsg('')
    try {
      await Promise.all([
        deleteCachedCourseDB(c.name, c.location),
        deleteCachedGeoDB(c.name, c.location).catch(() => {}), // geo row may not exist
        deleteAllCoursePdfs(c.name, c.location).catch(() => {}),
        deleteCourseHazards(c.name, c.location).catch(() => {}),
      ])
      setRows(prev => prev ? prev.filter(r => r._cacheKey !== c._cacheKey) : prev)
      setMsg(`✓ "${c.name}" removed from cache.`)
    } catch (e) {
      setMsg(`Error: ${e.message}`)
    }
    setBusyKey('')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── Sub-tab nav ──────────────────────────────────────────────── */}
      <div role="tablist" style={{ display: 'flex', gap: 4, background: C.bgInput, borderRadius: 10, padding: 4, overflowX: 'auto' }}>
        {COURSE_SUBS.map(s => (
          <button
            key={s.id}
            role="tab"
            aria-selected={sub === s.id}
            onClick={() => setSub(s.id)}
            style={{
              flex: 1, padding: '8px 12px', fontSize: 12, fontWeight: 500, fontFamily: F,
              border: 'none', borderRadius: 8, cursor: 'pointer', whiteSpace: 'nowrap',
              background: sub === s.id ? C.accent : 'transparent',
              color: sub === s.id ? C.bg : C.textMuted,
              transition: 'all 0.15s', minHeight: 36,
            }}
          >
            {s.icon} {s.label}
          </button>
        ))}
      </div>

      {sub === 'reparse'  && <AdminReparseQueue  authToken={authToken} />}
      {sub === 'import'   && <AdminBulkImport />}
      {sub === 'contribs' && <AdminContributions authToken={authToken} />}
      {sub === 'geometry' && <AdminGeometryEditor />}

      {sub === 'browser' && <>
      {/* ── Toolbar ──────────────────────────────────────────────────── */}
      <div style={{ ...card }}>
        <p style={{ ...lbl, margin: '0 0 6px' }}>Course browser</p>
        <p style={{ fontSize: 12, color: C.textMuted, margin: '0 0 12px' }}>
          Every course in the shared cache. Click any row to open the metadata editor; upload an official yardage book PDF and Claude vision re-parses it on the spot.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, alignItems: 'flex-end' }}>
          <div>
            <label style={lbl}>Search</label>
            <input style={inp} value={search} onChange={e => setSearch(e.target.value)} placeholder="Name or location…" />
          </div>
          <div>
            <label style={lbl}>Source</label>
            <select style={inp} value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}>
              {SOURCE_FILTERS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Sort</label>
            <select style={inp} value={sort} onChange={e => setSort(e.target.value)}>
              {SORT_OPTIONS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.textMuted, cursor: 'pointer' }}>
              <input type="checkbox" checked={onlyHasPdf} onChange={e => setOnlyHasPdf(e.target.checked)} /> Has PDF
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.textMuted, cursor: 'pointer' }}>
              <input type="checkbox" checked={onlyNeedsReview} onChange={e => setOnlyNeedsReview(e.target.checked)} /> Needs review
            </label>
            <button style={btnG} onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
          </div>
        </div>
        {msg && (
          <p style={{ marginTop: 10, fontSize: 12, color: msg.startsWith('Error') ? C.red : msg.startsWith('✓') ? C.green : C.textMuted }}>{msg}</p>
        )}
        {error && (
          <div style={{ padding: '8px 12px', background: C.redMuted, border: `1px solid ${C.red}`, borderRadius: 8, marginTop: 10 }}>
            <p style={{ fontSize: 12, color: C.red, margin: 0 }}>⚠ {error}</p>
          </div>
        )}
      </div>

      {/* ── Result count + table ─────────────────────────────────────── */}
      <div style={{ ...card }}>
        <p style={{ fontSize: 12, color: C.textMuted, margin: '0 0 10px' }}>
          {rows == null
            ? 'Loading…'
            : `${filtered.length} of ${rows.length} course${rows.length === 1 ? '' : 's'} shown`}
        </p>
        {filtered.length === 0 && rows && (
          <p style={{ fontSize: 12, color: C.textFaint, fontStyle: 'italic', margin: 0 }}>
            Nothing matches the filters.
          </p>
        )}
        {filtered.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {filtered.map(c => {
              const busy = busyKey === c._cacheKey
              const hasPdf = (c._pdfs?.length || 0) > 0 || !!c._sourcePdf
              const sb = sourceBadge(c)
              return (
                <div key={c._cacheKey} style={{ background: C.bgInput, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 220 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <p style={{ fontSize: 13, fontWeight: 600, color: C.text, margin: 0 }}>{c.name}</p>
                        <Badge label={sb.label} bg={sb.bg} fg={sb.fg} />
                        {hasPdf && <Badge label="PDF on file" bg={C.accentMuted} fg={C.accent} />}
                        {c._needs_review && <Badge label="needs review" bg={C.redMuted} fg={C.red} />}
                        {c.is_public && <Badge label="📚 Library" bg={C.greenMuted} fg={C.green} />}
                      </div>
                      <p style={{ fontSize: 11, color: C.textMuted, margin: '2px 0 0' }}>
                        {c.location} · Par {c.par || '—'} · {c.yardage ? Number(c.yardage).toLocaleString() + 'y' : '—'}
                        {' · '}Cached {shortDate(c.cached_at)}
                        {c._hitCount != null ? ` · ${c._hitCount} hit${c._hitCount === 1 ? '' : 's'}` : ''}
                      </p>
                      {c._pdfs?.length > 0 && (
                        <p style={{ fontSize: 11, color: C.textFaint, margin: '4px 0 0' }}>
                          {c._pdfs.length} PDF{c._pdfs.length === 1 ? '' : 's'} stored ·{' '}
                          <a href={c._pdfs[c._pdfs.length - 1].url} target="_blank" rel="noopener noreferrer" style={{ color: C.accent }}>
                            view latest
                          </a>
                        </p>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap' }}>
                      <button
                        style={{ ...btnG, padding: '6px 10px' }}
                        disabled={busy}
                        onClick={() => onEditCourse?.(c)}
                      >✎ Edit metadata</button>
                      <button
                        style={{ ...btnG, padding: '6px 10px', color: c.is_public ? C.green : C.textMuted }}
                        disabled={busy}
                        onClick={() => handleTogglePublic(c)}
                      >{c.is_public ? '📚 In Library' : '+ Library'}</button>
                      <label
                        style={{
                          ...btnG, padding: '6px 10px',
                          cursor: busy ? 'not-allowed' : 'pointer',
                          opacity: busy ? 0.5 : 1, pointerEvents: busy ? 'none' : 'auto',
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                        }}
                      >
                        {busy ? 'Working…' : '📄 Upload PDF'}
                        <input
                          type="file"
                          accept="application/pdf,.pdf"
                          style={{ display: 'none' }}
                          disabled={busy}
                          onChange={e => {
                            const f = e.target.files?.[0]
                            e.target.value = ''
                            if (f) handleUpload(c, f)
                          }}
                        />
                      </label>
                      {hasPdf && (
                        <button style={{ ...btnG, color: C.red, borderColor: C.red, padding: '6px 10px' }} disabled={busy} onClick={() => handleRemove(c)}>
                          Remove PDF
                        </button>
                      )}
                      <button
                        style={{ ...btnG, color: C.red, borderColor: C.red, padding: '6px 10px' }}
                        disabled={busy}
                        onClick={() => handleDeleteFromCache(c)}
                        title="Permanently delete this course and all its data from the shared cache"
                      >
                        {busy ? 'Working…' : '🗑 Delete'}
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
      </>}
    </div>
  )
}
