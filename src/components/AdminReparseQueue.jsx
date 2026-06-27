import { useEffect, useState } from 'react'
import { C, F, card, inp, lbl, btnP, btnG } from '../theme.js'
import { Badge } from './ui.jsx'
import { uploadCoursePdfToBucket } from '../lib/supabase.js'

function shortDate(iso) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString() } catch { return iso }
}

const STATUS_BADGE = {
  pending:          { label: 'Pending',          bg: C.bgInput,   fg: C.textMuted },
  running:          { label: 'Running…',         bg: C.accentMuted, fg: C.accent },
  pending_approval: { label: 'Needs approval',   bg: C.amberMuted, fg: C.amber },
  approved:         { label: 'Approved',         bg: '#0d2a1a',    fg: '#4ade80' },
  rejected:         { label: 'Rejected',         bg: C.redMuted,   fg: C.red },
  error:            { label: 'Error',            bg: C.redMuted,   fg: C.red },
}

export default function AdminReparseQueue({ authToken }) {
  const [items,   setItems]   = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const [msg,     setMsg]     = useState('')
  const [busy,    setBusy]    = useState(null) // id of item being acted on
  const [expanded, setExpanded] = useState(null)

  // Enqueue form
  const [enqCourseName, setEnqCourseName] = useState('')
  const [enqLocation,   setEnqLocation]   = useState('')
  const [enqFile,       setEnqFile]       = useState(null)
  const [enqueueing,    setEnqueueing]    = useState(false)

  const authH = { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' }

  const load = async () => {
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/admin-reparse-queue', { headers: authH })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.status)
      setItems(await res.json())
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }

  useEffect(() => { load() /* eslint-disable-next-line */ }, [])

  const act = async (id, action, extraMsg) => {
    setBusy(id); setMsg(extraMsg || `Running ${action}…`)
    try {
      const res = await fetch('/api/admin-reparse-queue', {
        method: 'PATCH',
        headers: authH,
        body: JSON.stringify({ id, action }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || res.status)
      setMsg(action === 'run' ? '✓ Parse complete — review the diff and approve or reject.' : `✓ ${action} applied.`)
      await load()
    } catch (e) {
      setMsg(`Error: ${e.message}`)
    }
    setBusy(null)
  }

  const remove = async (id) => {
    if (!window.confirm('Remove this item from the queue?')) return
    setBusy(id)
    try {
      await fetch('/api/admin-reparse-queue', {
        method: 'DELETE', headers: authH, body: JSON.stringify({ id }),
      })
      setItems(prev => prev ? prev.filter(i => i.id !== id) : prev)
    } catch {}
    setBusy(null)
  }

  const enqueue = async (e) => {
    e?.preventDefault?.()
    if (!enqCourseName.trim() || !enqFile) { setMsg('Course name and PDF required.'); return }
    setEnqueueing(true); setMsg('Uploading PDF…')
    try {
      const { url } = await uploadCoursePdfToBucket(enqCourseName.trim(), enqLocation.trim(), enqFile)
      const cacheKey = `${enqCourseName.trim().toLowerCase()}|${enqLocation.trim().toLowerCase()}`
      setMsg('Enqueueing…')
      const res = await fetch('/api/admin-reparse-queue', {
        method: 'POST',
        headers: authH,
        body: JSON.stringify({ courseKey: cacheKey, pdfUrl: url, courseName: enqCourseName.trim(), location: enqLocation.trim() }),
      })
      if (!res.ok) throw new Error((await res.json()).error || res.status)
      setMsg('✓ Enqueued. Click "Run parse" when ready.')
      setEnqCourseName(''); setEnqLocation(''); setEnqFile(null)
      await load()
    } catch (e) {
      setMsg(`Error: ${e.message}`)
    }
    setEnqueueing(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* ── Enqueue form ───────────────────────────────────────────── */}
      <div style={{ ...card }}>
        <p style={{ ...lbl, margin: '0 0 6px' }}>Add PDF to reparse queue</p>
        <p style={{ fontSize: 12, color: C.textMuted, margin: '0 0 12px' }}>
          Upload a yardage book PDF. The admin reviews the parsed diff before it goes live in the shared cache.
        </p>
        <form onSubmit={enqueue} style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', alignItems: 'flex-end' }}>
          <div>
            <label style={lbl}>Course name</label>
            <input style={inp} value={enqCourseName} onChange={e => setEnqCourseName(e.target.value)} placeholder="Pebble Beach Golf Links" required />
          </div>
          <div>
            <label style={lbl}>Location</label>
            <input style={inp} value={enqLocation} onChange={e => setEnqLocation(e.target.value)} placeholder="Pebble Beach, CA" />
          </div>
          <div>
            <label style={lbl}>PDF file</label>
            <input
              type="file"
              accept="application/pdf,.pdf"
              style={{ ...inp, padding: '5px 8px', cursor: 'pointer' }}
              onChange={e => setEnqFile(e.target.files?.[0] || null)}
              required
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button style={btnP} type="submit" disabled={enqueueing}>{enqueueing ? 'Uploading…' : 'Add to queue →'}</button>
          </div>
        </form>
        {msg && (
          <p style={{ fontSize: 12, margin: '8px 0 0', color: msg.startsWith('Error') ? C.red : msg.startsWith('✓') ? C.green : C.textMuted }}>{msg}</p>
        )}
      </div>

      {/* ── Queue list ─────────────────────────────────────────────── */}
      <div style={{ ...card }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <p style={{ ...lbl, margin: 0 }}>Queue {Array.isArray(items) && <span style={{ color: C.textFaint, fontWeight: 400 }}>· {items.length} items</span>}</p>
          <button style={btnG} onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
        </div>
        {error && <p style={{ fontSize: 12, color: C.red, margin: '0 0 8px' }}>⚠ {error}</p>}
        {items && items.length === 0 && <p style={{ fontSize: 12, color: C.textFaint, margin: 0 }}>Queue is empty.</p>}
        {items && items.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items.map(item => {
              const sb = STATUS_BADGE[item.status] || STATUS_BADGE.pending
              const isExpanded = expanded === item.id
              const isBusy = busy === item.id
              return (
                <div key={item.id} style={{ background: C.bgInput, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{item.course_name}</span>
                        <Badge label={sb.label} bg={sb.bg} fg={sb.fg} />
                      </div>
                      <p style={{ fontSize: 11, color: C.textMuted, margin: '2px 0 0' }}>
                        {item.location || '—'} · Submitted {shortDate(item.submitted_at)}
                        {item.finished_at ? ` · Finished ${shortDate(item.finished_at)}` : ''}
                      </p>
                      {item.error_msg && <p style={{ fontSize: 11, color: C.red, margin: '2px 0 0' }}>⚠ {item.error_msg}</p>}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap' }}>
                      {item.status === 'pending' && (
                        <button style={{ ...btnP, fontSize: 11 }} disabled={isBusy} onClick={() => act(item.id, 'run', 'Parsing PDF…')}>
                          {isBusy ? 'Running…' : 'Run parse'}
                        </button>
                      )}
                      {item.status === 'pending_approval' && (
                        <>
                          <button style={{ ...btnG, fontSize: 11 }} onClick={() => setExpanded(isExpanded ? null : item.id)}>
                            {isExpanded ? 'Hide diff' : 'Review diff'}
                          </button>
                          <button style={{ ...btnP, fontSize: 11 }} disabled={isBusy} onClick={() => act(item.id, 'approve')}>Approve</button>
                          <button style={{ ...btnG, color: C.red, borderColor: C.red, fontSize: 11 }} disabled={isBusy} onClick={() => act(item.id, 'reject')}>Reject</button>
                        </>
                      )}
                      {item.status === 'error' && (
                        <button style={{ ...btnG, fontSize: 11 }} disabled={isBusy} onClick={() => act(item.id, 'run', 'Retrying…')}>Retry</button>
                      )}
                      <button style={{ ...btnG, color: C.red, borderColor: C.red, fontSize: 11 }} disabled={isBusy} onClick={() => remove(item.id)}>Remove</button>
                    </div>
                  </div>

                  {/* Diff viewer */}
                  {isExpanded && item.result_data && (
                    <div style={{ marginTop: 10, borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
                      <p style={{ fontSize: 11, color: C.textMuted, margin: '0 0 6px', fontWeight: 600 }}>Parsed result preview</p>
                      <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: '10px 12px', maxHeight: 300, overflowY: 'auto' }}>
                        <pre style={{ fontSize: 11, color: C.text, margin: 0, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          {JSON.stringify(item.result_data, null, 2)}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
