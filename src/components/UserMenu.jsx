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

export default function UserMenu({ user, onSignOut, onOpenSettings, compact }) {
  const [open, setOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const rootRef = useRef(null)

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
