import { useEffect, useState } from 'react'
import { C, card, lbl, inp, btnP, btnG } from '../theme.js'
import { Badge } from './ui.jsx'

const ROLE_RANK = { viewer: 0, editor: 1, admin: 2, owner: 3 }
const PLAN_BADGE = {
  free:  { bg: C.bgInput,    fg: C.textMuted },
  pro:   { bg: '#1a2240',    fg: '#818cf8'   },
  team:  { bg: '#1a2e1a',    fg: '#4ade80'   },
}

function MemberRow({ m, isOwner, callerRole, authToken, orgId, onRemoved, onRoleChanged }) {
  const [editing, setEditing] = useState(false)
  const [role,    setRole]    = useState(m.role)
  const [busy,    setBusy]    = useState(false)
  const [err,     setErr]     = useState('')
  const authH = { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' }

  const saveRole = async () => {
    if (role === m.role) { setEditing(false); return }
    setBusy(true); setErr('')
    try {
      const res = await fetch('/api/org-members', { method: 'PATCH', headers: authH, body: JSON.stringify({ orgId, userId: m.userId, role }) })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || res.status)
      onRoleChanged(m.userId, role)
      setEditing(false)
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  const remove = async () => {
    if (!confirm(`Remove ${m.email || m.userId} from this org?`)) return
    setBusy(true); setErr('')
    try {
      const res = await fetch('/api/org-members', { method: 'DELETE', headers: authH, body: JSON.stringify({ orgId, userId: m.userId }) })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || res.status)
      onRemoved(m.userId)
    } catch (e) { setErr(e.message); setBusy(false) }
  }

  const canEdit = ROLE_RANK[callerRole] >= ROLE_RANK['admin'] && !isOwner
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: `1px solid ${C.border}`, flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 180 }}>
        <span style={{ fontSize: 13, color: C.text }}>{m.email || m.userId.slice(0, 12) + '…'}</span>
        {isOwner && <Badge label="owner" bg="#1a2240" fg="#818cf8" style={{ marginLeft: 6 }} />}
      </div>
      {editing ? (
        <>
          <select value={role} onChange={e => setRole(e.target.value)} style={{ ...inp, width: 100, padding: '2px 6px', fontSize: 12 }}>
            {['viewer','editor','admin'].map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <button style={{ ...btnP, fontSize: 11, padding: '3px 10px' }} onClick={saveRole} disabled={busy}>{busy ? '…' : 'Save'}</button>
          <button style={{ ...btnG, fontSize: 11, padding: '3px 10px' }} onClick={() => { setEditing(false); setRole(m.role) }}>Cancel</button>
        </>
      ) : (
        <>
          <Badge label={m.role} bg={C.bgInput} fg={C.textMuted} />
          {canEdit && <button style={{ ...btnG, fontSize: 11, padding: '3px 10px' }} onClick={() => setEditing(true)}>Edit</button>}
          {canEdit && <button style={{ ...btnG, fontSize: 11, padding: '3px 10px', color: C.red, borderColor: C.red }} onClick={remove} disabled={busy}>Remove</button>}
        </>
      )}
      {err && <span style={{ fontSize: 11, color: C.red, width: '100%' }}>{err}</span>}
    </div>
  )
}

function OrgDetail({ org, authToken, currentUserId, onDeleted, onUpdated }) {
  const [members,  setMembers]  = useState(null)
  const [loading,  setLoading]  = useState(false)
  const [err,      setErr]      = useState('')
  const [msg,      setMsg]      = useState('')
  const [addEmail, setAddEmail] = useState('')
  const [addRole,  setAddRole]  = useState('viewer')
  const [editName, setEditName] = useState(org.name)
  const [nameEdit, setNameEdit] = useState(false)
  const [delBusy,  setDelBusy]  = useState(false)

  const authH = { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' }
  const isOwner  = org.myRole === 'owner'
  const canAdmin = ['admin','owner'].includes(org.myRole)

  const loadMembers = async () => {
    setLoading(true); setErr('')
    try {
      const res = await fetch(`/api/org-members?orgId=${org.id}`, { headers: authH })
      const d   = await res.json()
      if (!res.ok) throw new Error(d.error || res.status)
      setMembers(d)
    } catch (e) { setErr(e.message) }
    setLoading(false)
  }

  useEffect(() => { loadMembers() /* eslint-disable-next-line */ }, [org.id])

  const addMember = async (e) => {
    e.preventDefault(); setMsg(''); setErr('')
    try {
      const res = await fetch('/api/org-members', { method: 'POST', headers: authH, body: JSON.stringify({ orgId: org.id, email: addEmail.trim(), role: addRole }) })
      const d   = await res.json()
      if (!res.ok) throw new Error(d.error || res.status)
      setMsg(`Added ${addEmail}.`); setAddEmail('')
      loadMembers()
    } catch (e) { setErr(e.message) }
  }

  const saveName = async () => {
    try {
      const res = await fetch('/api/orgs', { method: 'PATCH', headers: authH, body: JSON.stringify({ orgId: org.id, name: editName }) })
      const d   = await res.json()
      if (!res.ok) throw new Error(d.error || res.status)
      onUpdated({ ...org, name: d.name || editName })
      setNameEdit(false)
    } catch (e) { setErr(e.message) }
  }

  const deleteOrg = async () => {
    if (!confirm(`Delete org "${org.name}"? This will remove all members and private courses. Cannot be undone.`)) return
    setDelBusy(true)
    try {
      const res = await fetch('/api/orgs', { method: 'DELETE', headers: authH, body: JSON.stringify({ orgId: org.id }) })
      const d   = await res.json()
      if (!res.ok) throw new Error(d.error || res.status)
      onDeleted(org.id)
    } catch (e) { setErr(e.message); setDelBusy(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Org header */}
      <div style={{ ...card }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
          <div>
            {nameEdit ? (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                <input style={{ ...inp, fontSize: 15, fontWeight: 700, width: 200 }} value={editName} onChange={e => setEditName(e.target.value)} autoFocus />
                <button style={{ ...btnP, fontSize: 11, padding: '3px 10px' }} onClick={saveName}>Save</button>
                <button style={{ ...btnG, fontSize: 11, padding: '3px 10px' }} onClick={() => { setNameEdit(false); setEditName(org.name) }}>Cancel</button>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{org.name}</span>
                {isOwner && <button style={{ ...btnG, fontSize: 11, padding: '2px 8px' }} onClick={() => setNameEdit(true)}>Rename</button>}
              </div>
            )}
            <span style={{ fontSize: 12, color: C.textFaint, fontFamily: 'monospace' }}>{org.slug}</span>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <Badge label={org.plan} bg={PLAN_BADGE[org.plan]?.bg} fg={PLAN_BADGE[org.plan]?.fg} />
            <Badge label={`${org.memberCount ?? '?'} members`} bg={C.bgInput} fg={C.textMuted} />
            <Badge label={`your role: ${org.myRole}`} bg={C.bgInput} fg={C.textMuted} />
          </div>
        </div>
        {err && <p style={{ fontSize: 12, color: C.red, margin: '6px 0 0' }}>{err}</p>}
        {msg && <p style={{ fontSize: 12, color: C.green, margin: '6px 0 0' }}>{msg}</p>}
      </div>

      {/* Members list */}
      <div style={{ ...card }}>
        <p style={{ ...lbl, margin: '0 0 10px' }}>Members</p>
        {loading && <p style={{ fontSize: 12, color: C.textMuted }}>Loading…</p>}
        {members && members.length === 0 && <p style={{ fontSize: 12, color: C.textMuted }}>No members yet.</p>}
        {members && members.map(m => (
          <MemberRow
            key={m.userId}
            m={m}
            isOwner={m.userId === org.ownerId}
            callerRole={org.myRole}
            authToken={authToken}
            orgId={org.id}
            onRemoved={uid => setMembers(prev => prev.filter(x => x.userId !== uid))}
            onRoleChanged={(uid, role) => setMembers(prev => prev.map(x => x.userId === uid ? { ...x, role } : x))}
          />
        ))}
      </div>

      {/* Add member */}
      {canAdmin && (
        <div style={{ ...card }}>
          <p style={{ ...lbl, margin: '0 0 8px' }}>Add member</p>
          <form onSubmit={addMember} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label style={{ fontSize: 11, color: C.textMuted, display: 'block', marginBottom: 3 }}>Email address</label>
              <input style={{ ...inp, width: '100%' }} type="email" value={addEmail} onChange={e => setAddEmail(e.target.value)} placeholder="user@example.com" required />
            </div>
            <div>
              <label style={{ fontSize: 11, color: C.textMuted, display: 'block', marginBottom: 3 }}>Role</label>
              <select style={{ ...inp, width: 110 }} value={addRole} onChange={e => setAddRole(e.target.value)}>
                <option value="viewer">viewer</option>
                <option value="editor">editor</option>
                <option value="admin">admin</option>
              </select>
            </div>
            <button style={{ ...btnP, alignSelf: 'flex-end' }} type="submit">Add</button>
          </form>
          <p style={{ fontSize: 11, color: C.textFaint, margin: '6px 0 0' }}>
            The user must already have an account. For new users, send them an invite link instead (Admin → Users → Invites).
          </p>
        </div>
      )}

      {/* Danger zone */}
      {isOwner && (
        <div style={{ ...card, border: `1px solid ${C.red}20` }}>
          <p style={{ ...lbl, color: C.red, margin: '0 0 6px' }}>Danger zone</p>
          <p style={{ fontSize: 12, color: C.textMuted, margin: '0 0 10px' }}>
            Deleting this org removes all members and any org-private courses permanently.
          </p>
          <button style={{ ...btnG, color: C.red, borderColor: C.red, fontSize: 12 }} onClick={deleteOrg} disabled={delBusy}>
            {delBusy ? 'Deleting…' : `Delete "${org.name}"`}
          </button>
        </div>
      )}
    </div>
  )
}

export default function AdminOrgsPanel({ authToken, currentUserId, activeOrgId, onOrgChange }) {
  const [orgs,      setOrgs]     = useState(null)
  const [loading,   setLoading]  = useState(false)
  const [err,       setErr]      = useState('')
  const [newName,   setNewName]  = useState('')
  const [creating,  setCreating] = useState(false)
  const [selected,  setSelected] = useState(activeOrgId || null)

  const authH = { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' }

  const load = async () => {
    setLoading(true); setErr('')
    try {
      const res = await fetch('/api/orgs', { headers: authH })
      const d   = await res.json()
      if (!res.ok) throw new Error(d.error || res.status)
      setOrgs(d)
      if (!selected && d.length) setSelected(d[0].id)
    } catch (e) { setErr(e.message) }
    setLoading(false)
  }

  useEffect(() => { load() /* eslint-disable-next-line */ }, [])

  const createOrg = async (e) => {
    e.preventDefault(); setErr('')
    setCreating(true)
    try {
      const res = await fetch('/api/orgs', { method: 'POST', headers: authH, body: JSON.stringify({ name: newName.trim() }) })
      const d   = await res.json()
      if (!res.ok) throw new Error(d.error || res.status)
      setOrgs(prev => [...(prev || []), d])
      setSelected(d.id)
      setNewName('')
      onOrgChange?.(d.id)
    } catch (e) { setErr(e.message) }
    setCreating(false)
  }

  const activeOrg = orgs?.find(o => o.id === selected)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Org list + switcher */}
      <div style={{ ...card }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <p style={{ ...lbl, margin: 0 }}>Your organisations</p>
          <button style={{ ...btnG, fontSize: 11 }} onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
        </div>

        {err && <p style={{ fontSize: 12, color: C.red, margin: '0 0 8px' }}>{err}</p>}

        {orgs && orgs.length === 0 && (
          <p style={{ fontSize: 13, color: C.textMuted, margin: '0 0 12px' }}>
            You don't belong to any organisations yet. Create one below.
          </p>
        )}

        {orgs && orgs.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            {orgs.map(o => (
              <button
                key={o.id}
                onClick={() => { setSelected(o.id); onOrgChange?.(o.id) }}
                style={{
                  padding: '5px 12px', borderRadius: 6, fontSize: 13, cursor: 'pointer',
                  border: `1px solid ${selected === o.id ? C.accent : C.border}`,
                  background: selected === o.id ? C.accentMuted : C.bgInput,
                  color: selected === o.id ? C.accent : C.text,
                  fontWeight: selected === o.id ? 600 : 400,
                }}
              >
                {o.name}
              </button>
            ))}
          </div>
        )}

        {/* Create new org */}
        <form onSubmit={createOrg} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            style={{ ...inp, flex: 1, minWidth: 180 }}
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="New organisation name…"
            required
          />
          <button style={{ ...btnP, fontSize: 12 }} type="submit" disabled={creating || !newName.trim()}>
            {creating ? 'Creating…' : '+ Create org'}
          </button>
        </form>
      </div>

      {/* Selected org detail */}
      {activeOrg && (
        <OrgDetail
          key={activeOrg.id}
          org={activeOrg}
          authToken={authToken}
          currentUserId={currentUserId}
          onDeleted={id => {
            setOrgs(prev => prev.filter(o => o.id !== id))
            setSelected(orgs?.find(o => o.id !== id)?.id || null)
            onOrgChange?.(null)
          }}
          onUpdated={updated => setOrgs(prev => prev.map(o => o.id === updated.id ? { ...o, ...updated } : o))}
        />
      )}
    </div>
  )
}
