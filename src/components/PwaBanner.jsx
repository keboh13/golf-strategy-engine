import { C, F } from '../theme.js'

// Shows two optional banners:
//   1. Offline warning strip at the top of the viewport (when !isOnline)
//   2. Install-to-home-screen CTA at the bottom (when canInstall)
//
// Either or both can be absent; the component renders nothing when neither
// condition is active.

export default function PwaBanner({ isOnline, canInstall, onInstall, onDismiss }) {
  if (isOnline && !canInstall) return null

  return (
    <>
      {/* ── Offline warning ────────────────────────────────────────── */}
      {!isOnline && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 9999,
            background: '#78350f',
            borderBottom: '1px solid #b45309',
            padding: '8px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontFamily: F,
            fontSize: 13,
            color: '#fde68a',
            lineHeight: 1.4,
          }}
        >
          <span style={{ fontSize: 16 }}>📵</span>
          <span>
            <strong>Offline</strong> — saved briefs and player data are still available.
            Generating new briefs requires a connection.
          </span>
        </div>
      )}

      {/* ── Install CTA ────────────────────────────────────────────── */}
      {canInstall && isOnline && (
        <div
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 9998,
            background: '#1e2130',
            borderTop: '1px solid #2a2f45',
            padding: '10px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontFamily: F,
          }}
        >
          <span style={{ fontSize: 22 }}>⛳</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: C.text, margin: 0 }}>
              Add to Home Screen
            </p>
            <p style={{ fontSize: 11, color: C.textMuted, margin: 0 }}>
              Access your briefs offline, on-course
            </p>
          </div>
          <button
            onClick={onInstall}
            style={{
              padding: '8px 16px',
              background: C.accent,
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: F,
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            Install
          </button>
          <button
            onClick={onDismiss}
            aria-label="Dismiss install prompt"
            style={{
              background: 'transparent',
              border: 'none',
              color: C.textFaint,
              fontSize: 18,
              cursor: 'pointer',
              padding: '4px 6px',
              lineHeight: 1,
              flexShrink: 0,
            }}
          >
            ×
          </button>
        </div>
      )}
    </>
  )
}
