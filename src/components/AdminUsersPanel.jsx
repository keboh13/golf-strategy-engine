import { useEffect, useRef, useState } from 'react'
import { C, F, card, inp, lbl, btnP, btnG } from '../theme.js'
import { Badge } from './ui.jsx'
import { shortDate } from '../lib/formatters.js'
import useEscapeClose from '../hooks/useEscapeClose.js'

const ROLE_OPTIONS = ['viewer', 'editor', 'admin', 'owner']

// ── User detail drawer ────────────────────────────────────────────────────────
function UserDrawer({ user, authToken, currentUserId, onClose, onSoftDelete, onRestore, onImpersonate }) {
  const [detail,  setDetail]  = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')
  const [impMsg,  setImpMsg]  = useState('')
  const drawerRef = useRef(null)

  useEffect(() => {
    const load = async () => {
      setLoading(true); setError('')
      try {
        const res = await fetch(`/api/admin-user-detail?userId=${user.id}`, {
          headers: { Authorization: `Bearer ${authToken}` },
        })
        if (!res.ok) {
          const d = await res.json().catch(() => ({}))
          throw new Error(d.error || `${res.status}`)
        }
        setDetail(await res.json())
      } catch (e) {
        setError(e.message)
      }
      setLoading(false)
    }
    load()
  }, [user.id, authToken])

  // Close on Escape
  useEscapeClose(onClose)

  const handleImpersonate = async () => {
    setImpMsg('Generating link…')
    try {
      const res = await fetch('/api/admin-impersonate', {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId: user.id }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || `${res.status}`)
      await navigator.clipboard.writeText(d.actionLink)
      setImpMsg('Link copied — open in an incognito tab to act as this user. Link is single-use and expires in ~1 hour.')
    } catch (e) {
      setImpMsg(`Error: ${e.message}`)
    }
  }

  const isSelf = user.id === currentUserId

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 200 }}
      />
      {/* Drawer */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-label={`User detail: ${user.email}`}
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(480px, 100vw)',
          background: C.bgCard, borderLeft: `1px solid ${C.border}`, zIndex: 201,
          overflowY: 'auto', padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 16,
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <p style={{ fontSize: 16, fontWeight: 700, color: C.text, margin: 0 }}>{user.email}</p>
            <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
              {isSelf && <Badge label="You" bg={C.accentMuted} fg={C.accent} />}
              {user.isAdmin && <Badge label="Admin" bg={C.amberMuted} fg={C.amber} />}
              {user.softDeleted && <Badge label="Soft-deleted" bg={C.redMuted} fg={C.red} />}
            </div>
            <p style={{ fontSize: 11, color: C.textMuted, margin: '6px 0 0' }}>
              Joined {shortDate(user.created_at)}
              {user.last_sign_in_at ? ` · Last login ${shortDate(user.last_sign_in_at)}` : ''}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: C.textMuted, lineHeight: 1, padding: 4 }}>×</button>
        </div>

        {error && (
          <div style={{ padding: '10px 12px', background: C.redMuted, border: `1px solid ${C.red}`, borderRadius: 8 }}>
            <p style={{ fontSize: 12, color: C.red, margin: 0 }}>⚠ {error}</p>
          </div>
        )}

        {loading && <p style={{ fontSize: 12, color: C.textFaint }}>Loading…</p>}

        {detail && (
          <>
            {/* Usage */}
            <div style={{ background: C.bgInput, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px' }}>
              <p style={{ ...lbl, margin: '0 0 8px' }}>Usage</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {[
                  ['Today',     `${detail.usage.callsToday} calls · ${detail.usage.tokensToday.toLocaleString()} tokens`],
                  ['All-time',  `${detail.usage.callsTotal} calls · ${detail.usage.tokensTotal.toLocaleString()} tokens`],
                  ['Avg rating', detail.ratings.count > 0 ? `${detail.ratings.avg} / 5 (${detail.ratings.count} ratings)` : 'No ratings yet'],
                  ['Briefs',    `${detail.briefs.length} recent`],
                ].map(([k, v]) => (
                  <div key={k}>
                    <p style={{ fontSize: 10, color: C.textFaint, textTransform: 'uppercase', letterSpacing: '.06em', margin: '0 0 2px' }}>{k}</p>
                    <p style={{ fontSize: 13, color: C.text, margin: 0 }}>{v}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Profiles */}
            {detail.profiles.length > 0 && (
              <div style={{ background: C.bgInput, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px' }}>
                <p style={{ ...lbl, margin: '0 0 8px' }}>Profiles</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {detail.profiles.map(p => (
                    <div key={p.profile_name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <span style={{ color: C.text, fontWeight: 500 }}>{p.profile_name}</span>
                      <span style={{ color: C.textMuted }}>
                        {p.handicap != null ? `HCP ${p.handicap}` : 'No HCP'}
                        {p.home_course ? ` · ${p.home_course}` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recent briefs */}
            {detail.briefs.length > 0 && (
              <div style={{ background: C.bgInput, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px' }}>
                <p style={{ ...lbl, margin: '0 0 8px' }}>Recent briefs</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {detail.briefs.map(b => (
                    <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <span style={{ color: C.text }}>{b.course_name || 'Unknown course'}</span>
                      <span style={{ color: C.textMuted }}>{b.tee ? `${b.tee} · ` : ''}{shortDate(b.created_at)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Soft delete info */}
            {detail.softDelete && (
              <div style={{ background: C.redMuted, border: `1px solid ${C.red}`, borderRadius: 10, padding: '12px 14px' }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: C.red, margin: '0 0 4px' }}>Soft-deleted</p>
                <p style={{ fontSize: 12, color: C.textMuted, margin: 0 }}>
                  Deletable after {shortDate(detail.softDelete.restore_before)}.
                  Restore before then to undo.
                </p>
              </div>
            )}
          </>
        )}

        {/* Actions */}
        {!isSelf && (
          <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <p style={{ ...lbl, margin: 0 }}>Actions</p>

            {/* Impersonate */}
            <div style={{ background: C.bgInput, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px' }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: C.text, margin: '0 0 4px' }}>Impersonate</p>
              <p style={{ fontSize: 11, color: C.textMuted, margin: '0 0 8px' }}>
                Generates a one-time magic link. Open it in an incognito tab to act as this user. Audit-logged.
              </p>
              <button style={{ ...btnG, fontSize: 12 }} onClick={handleImpersonate}>
                Copy impersonate link
              </button>
              {impMsg && (
                <p style={{ fontSize: 11, color: impMsg.startsWith('Error') ? C.red : C.green, margin: '6px 0 0' }}>{impMsg}</p>
              )}
            </div>

            {/* Soft delete / restore */}
            {detail && (
              <div style={{ background: C.bgInput, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px' }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: C.text, margin: '0 0 4px' }}>
                  {detail.softDelete ? 'Restore account' : 'Soft delete'}
                </p>
                <p style={{ fontSize: 11, color: C.textMuted, margin: '0 0 8px' }}>
                  {detail.softDelete
                    ? 'Remove the soft-delete flag. The account becomes fully active again.'
                    : 'Marks the account for deletion with a 30-day grace period. The user keeps access until permanent deletion.'}
                </p>
                {detail.softDelete ? (
                  <button style={{ ...btnG, fontSize: 12 }} onClick={() => onRestore(user)}>Restore account</button>
                ) : (
                  <button style={{ ...btnG, color: C.amber, borderColor: C.amber, fontSize: 12 }} onClick={() => onSoftDelete(user)}>
                    Soft delete (30-day grace)
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────
export default function AdminUsersPanel({ authToken, currentUserId }) {
  const [users, setUsers]       = useState(null)
  const [invites, setInvites]   = useState(null)
  const [usersLoading, setUsersLoading] = useState(false)
  const [invitesLoading, setInvitesLoading] = useState(false)
  const [error, setError]       = useState('')
  const [grantMsg, setGrantMsg] = useState('')
  const [deleteMsg, setDeleteMsg] = useState('')
  const [inviteMsg, setInviteMsg] = useState('')
  const [drawerUser, setDrawerUser] = useState(null) // user whose drawer is open
  const [deleteConfirm, setDeleteConfirm] = useState(null) // user pending hard delete
  const [showDeleted, setShowDeleted] = useState(false)

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

  const softDelete = async (u) => {
    setDeleteMsg('')
    try {
      const res = await fetch('/api/admin-users', {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({ userId: u.id, action: 'soft_delete' }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.status)
      const d = await res.json()
      setDeleteMsg(`${u.email} soft-deleted. Permanent deletion available after ${new Date(d.restoreBefore).toLocaleDateString()}.`)
      setUsers(prev => prev ? prev.map(x => x.id === u.id ? { ...x, softDeleted: { restore_before: d.restoreBefore } } : x) : prev)
      setDrawerUser(null)
    } catch (e) {
      setDeleteMsg(`Error: ${e.message}`)
    }
  }

  const restore = async (u) => {
    setDeleteMsg('')
    try {
      const res = await fetch('/api/admin-users', {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({ userId: u.id, action: 'restore' }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.status)
      setDeleteMsg(`${u.email} restored.`)
      setUsers(prev => prev ? prev.map(x => x.id === u.id ? { ...x, softDeleted: null } : x) : prev)
      setDrawerUser(null)
    } catch (e) {
      setDeleteMsg(`Error: ${e.message}`)
    }
  }

  const permanentDelete = async (u) => {
    setDeleteMsg(''); setDeleteConfirm(null)
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
      setDeleteMsg(`Permanently deleted ${u.email}`)
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
      setInviteMsg('✓ Invite created — link copied below.')
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

  const visibleUsers = (users || []).filter(u => showDeleted || !u.softDeleted)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── Invite form ───────────────────────────────────────────────── */}
      <div style={{ ...card }}>
        <p style={{ ...lbl, margin: '0 0 6px' }}>Invite a new user</p>
        <p style={{ fontSize: 12, color: C.textMuted, margin: '0 0 12px' }}>
          Generates a one-time signup URL. The invitee gets the chosen role when they finish onboarding. Tokens expire after the set number of days.
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
          <p style={{ ...lbl, margin: 0 }}>
            Registered users {Array.isArray(users) && <span style={{ color: C.textFaint, fontWeight: 400 }}>· {users.length}</span>}
          </p>
          <div style={{ display: 'flex', gap: 6 }}>
            {users && users.some(u => u.softDeleted) && (
              <button
                style={{ ...btnG, fontSize: 11, color: showDeleted ? C.amber : C.textMuted, borderColor: showDeleted ? C.amber : C.border }}
                onClick={() => setShowDeleted(v => !v)}
              >
                {showDeleted ? 'Hide soft-deleted' : 'Show soft-deleted'}
              </button>
            )}
            <button style={btnG} onClick={loadUsers} disabled={usersLoading}>{usersLoading ? 'Loading…' : 'Refresh'}</button>
          </div>
        </div>
        {error && (
          <div style={{ padding: '8px 12px', background: C.redMuted, border: `1px solid ${C.red}`, borderRadius: 8, marginBottom: 8 }}>
            <p style={{ fontSize: 12, color: C.red, margin: 0 }}>⚠ {error}</p>
          </div>
        )}
        {grantMsg  && <p style={{ fontSize: 12, color: grantMsg.startsWith('Error')  ? C.red : C.green, margin: '0 0 8px' }}>{grantMsg}</p>}
        {deleteMsg && <p style={{ fontSize: 12, color: deleteMsg.startsWith('Error') ? C.red : C.green, margin: '0 0 8px' }}>{deleteMsg}</p>}
        {visibleUsers.length === 0 && users && <p style={{ fontSize: 12, color: C.textFaint, margin: 0 }}>No users yet.</p>}
        {visibleUsers.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {visibleUsers.map(u => (
              <div
                key={u.id}
                onClick={() => setDrawerUser(u)}
                style={{
                  background: C.bgInput, border: `1px solid ${u.softDeleted ? C.amber : C.border}`,
                  borderRadius: 8, padding: '10px 14px', display: 'flex',
                  justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                  cursor: 'pointer', transition: 'border-color 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.borderColor = C.accent}
                onMouseLeave={e => e.currentTarget.style.borderColor = u.softDeleted ? C.amber : C.border}
              >
                <div style={{ flex: 1, minWidth: 200, pointerEvents: 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: C.text, margin: 0 }}>{u.email}</p>
                    {u.id === currentUserId && <Badge label="You" bg={C.accentMuted} fg={C.accent} />}
                    {u.isAdmin && <Badge label="Admin" bg={C.amberMuted} fg={C.amber} />}
                    {u.softDeleted && <Badge label="Soft-deleted" bg={C.redMuted} fg={C.red} />}
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
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                    {!u.isAdmin && (
                      <button style={{ ...btnG, fontSize: 11 }} onClick={() => grantAdmin(u)}>Grant admin</button>
                    )}
                    {u.softDeleted ? (
                      <>
                        <button style={{ ...btnG, fontSize: 11 }} onClick={() => restore(u)}>Restore</button>
                        {deleteConfirm?.id === u.id ? (
                          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                            <span style={{ fontSize: 11, color: C.red, fontWeight: 600 }}>Permanent — cannot undo</span>
                            <button style={{ background: C.red, color: '#fff', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: F }}
                              onClick={() => permanentDelete(u)}>Delete forever</button>
                            <button style={{ ...btnG, fontSize: 11 }} onClick={() => setDeleteConfirm(null)}>Cancel</button>
                          </div>
                        ) : (
                          <button style={{ ...btnG, color: C.red, borderColor: C.red, fontSize: 11 }}
                            onClick={() => setDeleteConfirm(u)}>Permanent delete</button>
                        )}
                      </>
                    ) : (
                      <button style={{ ...btnG, color: C.amber, borderColor: C.amber, fontSize: 11 }}
                        onClick={() => softDelete(u)}>Soft delete</button>
                    )}
                  </div>
                )}
                <span style={{ fontSize: 11, color: C.textFaint, flexShrink: 0, pointerEvents: 'none' }}>Details →</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── User detail drawer ──────────────────────────────────────────── */}
      {drawerUser && (
        <UserDrawer
          user={drawerUser}
          authToken={authToken}
          currentUserId={currentUserId}
          onClose={() => setDrawerUser(null)}
          onSoftDelete={softDelete}
          onRestore={restore}
          onImpersonate={() => {}}
        />
      )}
    </div>
  )
}
