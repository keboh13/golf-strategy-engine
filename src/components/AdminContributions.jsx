import { useEffect, useState } from 'react'
import { C, card, lbl, btnP, btnG } from '../theme.js'
import { Badge } from './ui.jsx'

function shortDate(iso) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString() } catch { return iso }
}

function fmtCoord(n) {
  return typeof n === 'number' ? n.toFixed(6) : '—'
}

export default function AdminContributions({ authToken }) {
  const [items,   setItems]   = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const [msg,     setMsg]     = useState('')
  const [busy,    setBusy]    = useState(null) // "courseKey|holeRef" of active action

  const authH = { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' }

  const load = async () => {
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/admin-contributions', { headers: authH })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.status)
      setItems(await res.json())
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }

  useEffect(() => { load() /* eslint-disable-next-line */ }, [])

  const act = async (courseKey, holeRef, action) => {
    const key = `${courseKey}|${holeRef}`
    setBusy(key); setMsg('')
    try {
      const res = await fetch('/api/admin-contributions', {
        method: 'PATCH',
        headers: authH,
        body: JSON.stringify({ courseKey, holeRef, action }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || res.status)
      setMsg(action === 'approve'
        ? `✓ Hole ${holeRef} geometry merged into course_geo for ${courseKey}.`
        : `Contribution for hole ${holeRef} rejected and removed.`)
      setItems(prev => prev ? prev.filter(i => !(i.course_key === courseKey && i.hole_ref === holeRef)) : prev)
    } catch (e) {
      setMsg(`Error: ${e.message}`)
    }
    setBusy(null)
  }

  // Group by course key for cleaner display
  const byCourse = {}
  for (const item of (items || [])) {
    if (!byCourse[item.course_key]) byCourse[item.course_key] = []
    byCourse[item.course_key].push(item)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ ...card }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <div>
            <p style={{ ...lbl, margin: 0 }}>Hole geometry contributions</p>
            <p style={{ fontSize: 12, color: C.textMuted, margin: '3px 0 0' }}>
              User-submitted tee + pin coordinates. Approve to merge into the canonical course geometry (course_geo) — all future users benefit. Reject to discard.
            </p>
          </div>
          <button style={{ ...btnG, flexShrink: 0 }} onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
        </div>
        {msg && <p style={{ fontSize: 12, margin: '6px 0 0', color: msg.startsWith('Error') ? C.red : msg.startsWith('✓') ? C.green : C.textMuted }}>{msg}</p>}
        {error && <p style={{ fontSize: 12, color: C.red, margin: '6px 0 0' }}>⚠ {error}</p>}
      </div>

      {items && Object.keys(byCourse).length === 0 && (
        <div style={{ ...card, textAlign: 'center', padding: '3rem 2rem' }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>✅</div>
          <p style={{ fontSize: 14, color: C.textMuted, margin: 0 }}>No pending contributions.</p>
          <p style={{ fontSize: 12, color: C.textFaint, margin: '4px 0 0' }}>When players mark tee/pin positions on unmapped holes, they appear here for review.</p>
        </div>
      )}

      {Object.entries(byCourse).map(([courseKey, holes]) => (
        <div key={courseKey} style={{ ...card }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: C.text, margin: '0 0 10px' }}>
            {courseKey}
            <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 400, color: C.textFaint }}>
              {holes.length} hole{holes.length !== 1 ? 's' : ''}
            </span>
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {holes.sort((a, b) => a.hole_ref - b.hole_ref).map(h => {
              const key = `${courseKey}|${h.hole_ref}`
              const isBusy = busy === key
              return (
                <div key={h.hole_ref} style={{ background: C.bgInput, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 240 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Hole {h.hole_ref}</span>
                      <Badge label={h.source} bg={C.bgInput} fg={C.textMuted} />
                    </div>
                    <p style={{ fontSize: 11, color: C.textMuted, margin: 0, fontFamily: 'monospace' }}>
                      Tee: {fmtCoord(h.tee_lng)}, {fmtCoord(h.tee_lat)}
                      {' · '}Pin: {fmtCoord(h.pin_lng)}, {fmtCoord(h.pin_lat)}
                    </p>
                    <p style={{ fontSize: 11, color: C.textFaint, margin: '2px 0 0' }}>
                      Submitted {shortDate(h.updated_at)}
                      {h.contributor ? ` · by user ${h.contributor.slice(0, 8)}…` : ''}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button style={{ ...btnP, fontSize: 11 }} disabled={isBusy} onClick={() => act(courseKey, h.hole_ref, 'approve')}>
                      {isBusy ? 'Working…' : 'Approve →'}
                    </button>
                    <button style={{ ...btnG, color: C.red, borderColor: C.red, fontSize: 11 }} disabled={isBusy} onClick={() => act(courseKey, h.hole_ref, 'reject')}>
                      Reject
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
