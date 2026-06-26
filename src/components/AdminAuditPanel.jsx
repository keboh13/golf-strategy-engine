import { useEffect, useState } from 'react'
import { C, F, card, inp, lbl, btnG } from '../theme.js'
import { Badge } from './ui.jsx'

// Audit sub-tab (Part 4 step 12 of the optimization plan). Reads from the
// audit_log table the admin-* endpoints already populate with role grants,
// invite create/revoke, and so on. Reverse-chron with action + target filters.

const ACTION_FILTERS = [
  { id: 'all',            label: 'Any action' },
  { id: 'invite.create',  label: 'Invite created' },
  { id: 'invite.revoke',  label: 'Invite revoked' },
  { id: 'role.grant',     label: 'Role granted' },
  { id: 'user.delete',    label: 'User deleted' },
]

const TARGET_FILTERS = [
  { id: 'all',    label: 'Any target' },
  { id: 'user',   label: 'User' },
  { id: 'invite', label: 'Invite' },
  { id: 'course', label: 'Course' },
]

function actionColor(action) {
  if (action.endsWith('.revoke') || action.endsWith('.delete')) return C.red
  if (action.endsWith('.create') || action.endsWith('.grant')) return C.green
  return C.textMuted
}

function shortDateTime(iso) {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
  } catch { return iso }
}

export default function AdminAuditPanel({ authToken }) {
  const [rows, setRows] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [action, setAction] = useState('all')
  const [target, setTarget] = useState('all')

  const load = async () => {
    setLoading(true); setError('')
    const params = new URLSearchParams({ limit: '200' })
    if (action !== 'all') params.set('action', action)
    if (target !== 'all') params.set('target_type', target)
    try {
      const res = await fetch(`/api/admin-audit?${params.toString()}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || `${res.status}`)
      }
      setRows(await res.json())
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }

  useEffect(() => { load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [action, target])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ ...card }}>
        <p style={{ ...lbl, margin: '0 0 6px' }}>Audit log</p>
        <p style={{ fontSize: 12, color: C.textMuted, margin: '0 0 10px' }}>
          Reverse-chron record of every admin-side mutation. Newest first; capped at 200 rows per query — narrow with the filters if you need to go further back.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, alignItems: 'flex-end' }}>
          <div>
            <label style={lbl}>Action</label>
            <select style={inp} value={action} onChange={e => setAction(e.target.value)}>
              {ACTION_FILTERS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Target</label>
            <select style={inp} value={target} onChange={e => setTarget(e.target.value)}>
              {TARGET_FILTERS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button style={btnG} onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
          </div>
        </div>
        {error && (
          <div style={{ padding: '8px 12px', background: C.redMuted, border: `1px solid ${C.red}`, borderRadius: 8, marginTop: 10 }}>
            <p style={{ fontSize: 12, color: C.red, margin: 0 }}>⚠ {error}</p>
          </div>
        )}
      </div>

      <div style={{ ...card }}>
        <p style={{ fontSize: 12, color: C.textMuted, margin: '0 0 8px' }}>
          {rows == null ? 'Loading…' : `${rows.length} row${rows.length === 1 ? '' : 's'} shown`}
        </p>
        {rows && rows.length === 0 && (
          <p style={{ fontSize: 12, color: C.textFaint, margin: 0, fontStyle: 'italic' }}>Nothing matches the filters.</p>
        )}
        {rows && rows.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {rows.map(r => (
              <div key={r.id} style={{ background: C.bgInput, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <Badge label={r.action} bg={C.bgInput} fg={actionColor(r.action)} />
                  {r.target_type && <Badge label={r.target_type} bg={C.bgInput} fg={C.textMuted} />}
                  <span style={{ fontSize: 11, color: C.textFaint, marginLeft: 'auto' }}>{shortDateTime(r.created_at)}</span>
                </div>
                <p style={{ fontSize: 12, color: C.text, margin: '4px 0 2px' }}>
                  <strong>{r.actor_email || r.actor_user_id || 'unknown actor'}</strong>
                  {r.target_id ? <span style={{ color: C.textMuted }}> → <code style={{ fontSize: 11 }}>{r.target_id}</code></span> : null}
                </p>
                {r.payload && Object.keys(r.payload).length > 0 && (
                  <pre style={{
                    fontSize: 11, color: C.textMuted, background: C.bgCard,
                    border: `1px solid ${C.border}`, borderRadius: 6,
                    padding: '6px 10px', margin: '4px 0 0',
                    overflowX: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  }}>
                    {JSON.stringify(r.payload, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
