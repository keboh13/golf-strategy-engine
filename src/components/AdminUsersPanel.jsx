import { useEffect, useState } from 'react'
import { C, F, card, inp, lbl, btnP, btnG } from '../theme.js'
import { Badge } from './ui.jsx'

// Users sub-tab content (Part 4 step 10 of the optimization plan). Currently
// owns: user list, role badge, invite issuance + revocation, hard delete
// confirmation. Impersonation, soft-delete, and the user-detail drawer land
// in a sibling PR. Designed self-contained so the legacy panel in SettingsTab
// can stay untouched for one cycle while users get used to finding admin
// here.

const ROLE_OPTIONS = ['viewer', 'editor', 'admin', 'owner']

function shortDate(iso) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString() } catch { return iso }
}

export default function AdminUsersPanel({ authToken, currentUserId }) {
  const [users, setUsers]       = useState(null)
  const [invites, setInvites]   = useState(null)
  const [usersLoading, setUsersLoading] = useState(false)
  const [invitesLoading, setInvitesLoading] = useState(false)
  const [error, setError]       = useState('')
  const [grantMsg, setGrantMsg] = useState('')
  const [deleteMsg, setDeleteMsg] = useState('')
  const [inviteMsg, setInviteMsg] = useState('')

  // Invite form state
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole,  setInviteRole]  = useState('viewer')
  const [inviteProfile, setInviteProfile] = useState('')
  const [inviteTtl, setInviteTtl]     = useState(14)
  const [creating, setCreating] = useState(false)

  const authHeaders = authToken
    ? { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' }

  const loadUsers = async () => {
    setUsersLoading(true); setError(''); setGrantMsg(''); setDeleteMsg('')
    try {
      const res = await fetch('/api/admin-users', { headers: authHeaders })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || `${res.status}`)
      }
      setUsers(await res.json())
    } catch (e) {
      setError(e.message)
    }
    setUsersLoading(false)
  }

  const loadInvites = async () => {
    setInvitesLoading(true); setInviteMsg('')
    try {
      const res = await fetch('/api/admin-invites', { headers: authHeaders })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || `${res.status}`)
      }
      setInvites(await res.json())
    } catch (e) {
      setInviteMsg(`Error loading invites: ${e.message}`)
    }
    setInvitesLoading(false)
  }

  // Eagerly fetch both lists on first render — the operator basically always
  // wants to see them, and round-trip cost is small.
  useEffect(() => {
    loadUsers()
    loadInvites()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const grantAdmin = async (u) => {
    setGrantMsg('')
    try {
      const res = await fetch('/api/admin-users', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ grantId: u.id }),
      })
      if (!res.ok) throw new Error((await res.json()).error || res.status)
      setGrantMsg(`Admin granted to ${u.email}`)
      setUsers(prev => prev ? prev.map(x => x.id === u.id ? { ...x, isAdmin: true } : x) : prev)
    } catch (e) {
      setGrantMsg(`Error: ${e.message}`)
    }
  }

  const deleteUser = async (u) => {
    if (!window.confirm(`Permanently delete user ${u.email}? This cannot be undone.`)) return
    setDeleteMsg('')
    try {
      const res = await fetch('/api/admin-users', {
        method: 'DELETE',
        headers: authHeaders,
        body: JSON.stringify({ userId: u.id }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || `${res.status}`)
      }
      setDeleteMsg(`Deleted ${u.email}`)
      setUsers(prev => prev ? prev.filter(x => x.id !== u.id) : prev)
    } catch (e) {
      setDeleteMsg(`Error: ${e.message}`)
    }
  }

  const issueInvite = async (e) => {
    e?.preventDefault?.()
    if (!inviteEmail.trim()) { setInviteMsg('Email is required.'); return }
    setCreating(true); setInviteMsg('')
    try {
      const res = await fetch('/api/admin-invites', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          email: inviteEmail.trim(),
          role: inviteRole,
          profileName: inviteProfile.trim() || null,
          ttlDays: Number(inviteTtl) || 14,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || `${res.status}`)
      }
      const created = await res.json()
      setInviteMsg(`✓ Invite created — link copied below.`)
      setInviteEmail(''); setInviteProfile('')
      setInvites(prev => [created, ...(prev || [])])
    } catch (err) {
      setInviteMsg(`Error: ${err.message}`)
    }
    setCreating(false)
  }

  const revokeInvite = async (token) => {
    if (!window.confirm('Revoke this invite? The signup link will stop working.')) return
    setInviteMsg('')
    try {
      const res = await fetch('/api/admin-invites', {
        method: 'DELETE',
        headers: authHeaders,
        body: JSON.stringify({ token }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || `${res.status}`)
      }
      setInvites(prev => prev ? prev.filter(i => i.token !== token) : prev)
      setInviteMsg('Invite revoked.')
    } catch (err) {
      setInviteMsg(`Error: ${err.message}`)
    }
  }

  const copySignupUrl = async (signupUrl) => {
    if (!signupUrl) return
    try {
      await navigator.clipboard.writeText(signupUrl)
      setInviteMsg('Link copied to clipboard.')
    } catch {
      setInviteMsg(`Copy failed — link: ${signupUrl}`)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── Invite form ───────────────────────────────────────────────── */}
      <div style={{ ...card }}>
        <p style={{ ...lbl, margin: '0 0 6px' }}>Invite a new user</p>
        <p style={{ fontSize: 12, color: C.textMuted, margin: '0 0 12px' }}>
          Generates a one-time signup URL. The email gets the role you pick the moment they finish onboarding. Tokens expire after the chosen number of days.
        </p>
        <form onSubmit={issueInvite} style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', alignItems: 'flex-end' }}>
          <div>
            <label style={lbl}>Email</label>
            <input style={inp} type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="player@example.com" required />
          </div>
          <div>
            <label style={lbl}>Role</label>
            <select style={inp} value={inviteRole} onChange={e => setInviteRole(e.target.value)}>
              {ROLE_OPTIONS.map(r => <option key={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Profile (optional)</label>
            <input style={inp} value={inviteProfile} onChange={e => setInviteProfile(e.target.value)} placeholder="Default" />
          </div>
          <div>
            <label style={lbl}>Expires in (days)</label>
            <input style={inp} type="number" min={1} max={90} value={inviteTtl} onChange={e => setInviteTtl(e.target.value)} />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button style={btnP} type="submit" disabled={creating}>{creating ? 'Creating…' : 'Issue invite →'}</button>
          </div>
        </form>
        {inviteMsg && <p style={{ fontSize: 12, color: inviteMsg.startsWith('Error') ? C.red : C.green, margin: '8px 0 0' }}>{inviteMsg}</p>}
      </div>

      {/* ── Active invites ─────────────────────────────────────────────── */}
      <div style={{ ...card }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <p style={{ ...lbl, margin: 0 }}>Pending invites {Array.isArray(invites) && <span style={{ color: C.textFaint, fontWeight: 400 }}>· {invites.filter(i => !i.consumed_at).length}</span>}</p>
          <button style={btnG} onClick={loadInvites} disabled={invitesLoading}>{invitesLoading ? 'Loading…' : 'Refresh'}</button>
        </div>
        {!invites && invitesLoading && <p style={{ fontSize: 12, color: C.textFaint, margin: 0 }}>Loading…</p>}
        {invites && invites.length === 0 && <p style={{ fontSize: 12, color: C.textFaint, margin: 0 }}>No invites yet.</p>}
        {invites && invites.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {invites.map(inv => {
              const consumed = !!inv.consumed_at
              const expired  = !consumed && inv.expires_at && new Date(inv.expires_at) < new Date()
              return (
                <div key={inv.token} style={{ background: C.bgInput, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <p style={{ fontSize: 13, fontWeight: 600, color: C.text, margin: 0 }}>{inv.email}</p>
                      <Badge label={inv.role} bg={C.bgInput} fg={C.textMuted} />
                      {consumed && <Badge label="consumed" bg={C.greenMuted} fg={C.green} />}
                      {expired  && <Badge label="expired"  bg={C.amberMuted} fg={C.amber} />}
                    </div>
                    <p style={{ fontSize: 11, color: C.textMuted, margin: '3px 0 0' }}>
                      Created {shortDate(inv.created_at)} · Expires {shortDate(inv.expires_at)}
                      {inv.profile_name ? ` · Profile: ${inv.profile_name}` : ''}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {inv.signupUrl && !consumed && !expired && (
                      <button style={{ ...btnG, fontSize: 11 }} onClick={() => copySignupUrl(inv.signupUrl)}>Copy link</button>
                    )}
                    {!consumed && (
                      <button style={{ ...btnG, color: C.red, borderColor: C.red, fontSize: 11 }} onClick={() => revokeInvite(inv.token)}>Revoke</button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── User list ─────────────────────────────────────────────────── */}
      <div style={{ ...card }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
          <p style={{ ...lbl, margin: 0 }}>Registered users {Array.isArray(users) && <span style={{ color: C.textFaint, fontWeight: 400 }}>· {users.length}</span>}</p>
          <button style={btnG} onClick={loadUsers} disabled={usersLoading}>{usersLoading ? 'Loading…' : 'Refresh'}</button>
        </div>
        {error && (
          <div style={{ padding: '8px 12px', background: C.redMuted, border: `1px solid ${C.red}`, borderRadius: 8, marginBottom: 8 }}>
            <p style={{ fontSize: 12, color: C.red, margin: 0 }}>⚠ {error}</p>
          </div>
        )}
        {grantMsg && <p style={{ fontSize: 12, color: grantMsg.startsWith('Error') ? C.red : C.green, margin: '0 0 8px' }}>{grantMsg}</p>}
        {deleteMsg && <p style={{ fontSize: 12, color: deleteMsg.startsWith('Error') ? C.red : C.green, margin: '0 0 8px' }}>{deleteMsg}</p>}
        {users && users.length === 0 && <p style={{ fontSize: 12, color: C.textFaint, margin: 0 }}>No users yet.</p>}
        {users && users.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {users.map(u => (
              <div key={u.id} style={{ background: C.bgInput, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: C.text, margin: 0 }}>{u.email}</p>
                    {u.id === currentUserId && <Badge label="You" bg={C.accentMuted} fg={C.accent} />}
                    {u.isAdmin && <Badge label="Admin" bg={C.amberMuted} fg={C.amber} />}
                  </div>
                  <p style={{ fontSize: 11, color: C.textMuted, margin: '3px 0 0' }}>
                    Joined {shortDate(u.created_at)}
                    {u.last_sign_in_at ? ` · Last login ${shortDate(u.last_sign_in_at)}` : ''}
                  </p>
                  <p style={{ fontSize: 11, color: C.textMuted, margin: '2px 0 0' }}>
                    Today: {u.usage_today ?? 0} calls
                    {u.tokens_today > 0 ? ` · ${u.tokens_today.toLocaleString()} tokens` : ''}
                    {' · '}All-time: {u.usage_total ?? 0} calls
                    {u.tokens_total > 0 ? ` · ${u.tokens_total.toLocaleString()} tokens` : ''}
                  </p>
                </div>
                {u.id !== currentUserId && (
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    {!u.isAdmin && (
                      <button style={{ ...btnG, fontSize: 11 }} onClick={() => grantAdmin(u)}>Grant admin</button>
                    )}
                    <button style={{ ...btnG, color: C.red, borderColor: C.red, fontSize: 11 }} onClick={() => deleteUser(u)}>Delete</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
