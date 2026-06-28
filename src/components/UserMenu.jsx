import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { C, F } from '../theme.js'

// Header user button. Click → dropdown with email + Sign out. Click outside
// or Escape closes it. Sign-out path calls supabase.auth.signOut() then the
// parent's onSignOut so the AppInner state is also cleared.

function initialsFor(email) {
  if (!email) return '?'
  const local = email.split('@')[0] || ''
  const parts = local.split(/[._-]/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return (local[0] || '?').toUpperCase()
}

export default function UserMenu({
  user,
  onSignOut,
  onOpenSettings,
  compact,
  // Profile switcher props (Part 4 step 6). Optional — when absent the
  // menu hides the profile section entirely, matching the pre-switcher UI.
  currentProfile,
  profileNames,
  onSwitchProfile,
  onCreateProfile,
  // Org switcher props. Optional — hidden when absent.
  orgs,
  activeOrgId,
  onSwitchOrg,
}) {
  const [open, setOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [creatingProfile, setCreatingProfile] = useState(false)
  const [newProfileName, setNewProfileName] = useState('')
  const [profileError, setProfileError] = useState('')
  const rootRef = useRef(null)
  const showProfiles = Array.isArray(profileNames) && profileNames.length > 0 && typeof onSwitchProfile === 'function'

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const handleSignOut = async () => {
    if (signingOut) return
    setSigningOut(true)
    try { await supabase.auth.signOut() } catch {}
    setOpen(false)
    setSigningOut(false)
    onSignOut?.()
  }

  const handleSwitchProfile = (name) => {
    if (!onSwitchProfile || name === currentProfile) return
    onSwitchProfile(name)
    setOpen(false)
  }

  const handleCreateProfile = async () => {
    const name = newProfileName.trim()
    if (!name) { setProfileError('Profile name is required.'); return }
    try {
      await onCreateProfile?.(name)
      setNewProfileName('')
      setCreatingProfile(false)
      setProfileError('')
      setOpen(false)
    } catch (e) {
      setProfileError(e?.message || 'Could not create profile.')
    }
  }

  const email = user?.email || ''
  const initials = initialsFor(email)

  return (
    <div ref={rootRef} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${email || 'user'}`}
        onClick={() => setOpen(o => !o)}
        style={{
          width: 34, height: 34, borderRadius: '50%',
          background: open ? C.accent : C.bgInput,
          color: open ? '#0f1117' : C.text,
          border: `1px solid ${open ? C.accent : C.border}`,
          fontFamily: F, fontSize: 12, fontWeight: 700, letterSpacing: '0.02em',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 0,
        }}
      >
        {initials}
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 20,
            minWidth: 220, background: C.bgCard, border: `1px solid ${C.border}`,
            borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            padding: 6, fontFamily: F,
          }}
        >
          <div style={{ padding: '8px 10px 10px', borderBottom: `1px solid ${C.border}`, marginBottom: 4 }}>
            <p style={{ margin: 0, fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Signed in as</p>
            <p style={{ margin: '4px 0 0', fontSize: 13, fontWeight: 600, color: C.text, wordBreak: 'break-all' }}>{email || 'unknown'}</p>
          </div>

          {showProfiles && (
            <div style={{ padding: '4px 4px 6px', borderBottom: `1px solid ${C.border}`, marginBottom: 4 }}>
              <p style={{ margin: '4px 10px 6px', fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Profile</p>
              {profileNames.map(name => {
                const active = name === currentProfile
                return (
                  <button
                    key={name}
                    role="menuitemradio"
                    aria-checked={active}
                    onClick={() => handleSwitchProfile(name)}
                    style={{
                      ...menuItemStyle(false),
                      fontWeight: active ? 600 : 500,
                      color: active ? C.accent : C.text,
                    }}
                  >
                    <span style={{ width: 18 }}>{active ? '✓' : ' '}</span> {name}
                  </button>
                )
              })}
              {!creatingProfile ? (
                <button
                  role="menuitem"
                  onClick={() => { setCreatingProfile(true); setProfileError('') }}
                  style={{ ...menuItemStyle(false), color: C.textMuted }}
                >
                  <span style={{ width: 18 }}>＋</span> New profile…
                </button>
              ) : (
                <div style={{ padding: '6px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <input
                    autoFocus
                    type="text"
                    placeholder="Profile name"
                    value={newProfileName}
                    onChange={e => { setNewProfileName(e.target.value); setProfileError('') }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleCreateProfile()
                      else if (e.key === 'Escape') { setCreatingProfile(false); setNewProfileName(''); setProfileError('') }
                    }}
                    style={{
                      background: C.bgInput, border: `1px solid ${C.border}`, borderRadius: 6,
                      padding: '6px 8px', fontFamily: F, fontSize: 13, color: C.text,
                    }}
                  />
                  {profileError && (
                    <span style={{ fontSize: 11, color: C.red }}>{profileError}</span>
                  )}
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      onClick={handleCreateProfile}
                      style={{
                        flex: 1, padding: '6px 10px', borderRadius: 6, border: 'none',
                        background: C.accent, color: '#0f1117',
                        fontFamily: F, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      }}
                    >Create</button>
                    <button
                      onClick={() => { setCreatingProfile(false); setNewProfileName(''); setProfileError('') }}
                      style={{
                        flex: 1, padding: '6px 10px', borderRadius: 6,
                        background: 'transparent', border: `1px solid ${C.border}`, color: C.textMuted,
                        fontFamily: F, fontSize: 12, cursor: 'pointer',
                      }}
                    >Cancel</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {Array.isArray(orgs) && orgs.length > 0 && (
            <div style={{ padding: '4px 4px 6px', borderBottom: `1px solid ${C.border}`, marginBottom: 4 }}>
              <p style={{ margin: '4px 10px 6px', fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Organisation</p>
              <button
                role="menuitemradio"
                aria-checked={!activeOrgId}
                onClick={() => { onSwitchOrg?.(null); setOpen(false) }}
                style={{ ...menuItemStyle(false), fontWeight: !activeOrgId ? 600 : 500, color: !activeOrgId ? C.accent : C.text }}
              >
                <span style={{ width: 18 }}>{!activeOrgId ? '✓' : ' '}</span> Personal
              </button>
              {orgs.map(o => {
                const active = o.id === activeOrgId
                return (
                  <button
                    key={o.id}
                    role="menuitemradio"
                    aria-checked={active}
                    onClick={() => { onSwitchOrg?.(o.id); setOpen(false) }}
                    style={{ ...menuItemStyle(false), fontWeight: active ? 600 : 500, color: active ? C.accent : C.text }}
                  >
                    <span style={{ width: 18 }}>{active ? '✓' : ' '}</span> {o.name}
                    <span style={{ marginLeft: 4, fontSize: 10, color: C.textFaint }}>{o.plan !== 'free' ? `· ${o.plan}` : ''}</span>
                  </button>
                )
              })}
            </div>
          )}

          {onOpenSettings && (
            <button
              role="menuitem"
              onClick={() => { setOpen(false); onOpenSettings() }}
              style={menuItemStyle(false)}
            >
              <span style={{ width: 18 }}>⚙️</span> Settings
            </button>
          )}

          <button
            role="menuitem"
            onClick={handleSignOut}
            disabled={signingOut}
            style={menuItemStyle(true, signingOut)}
          >
            <span style={{ width: 18 }}>↩</span> {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      )}

      {/* Optional inline email next to the avatar on desktop, so the button reads as "an account widget" not "a random circle". */}
      {!compact && email && (
        <span aria-hidden="true" style={{ display: 'none' }}>{email}</span>
      )}
    </div>
  )
}

function menuItemStyle(danger, disabled) {
  return {
    width: '100%', textAlign: 'left',
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '8px 10px', borderRadius: 6,
    background: 'transparent', border: 'none',
    fontFamily: F, fontSize: 13, color: danger ? C.red : C.text,
    cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
  }
}
