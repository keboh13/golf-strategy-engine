import { useState } from 'react'
import { C } from '../theme.js'

// Shared star-rating widget. Used by HistoryTab, AdminUsagePanel, and
// AdminOverviewPanel. Renders 5 stars; hover preview, click to commit.
// After commit the stars are static (re-click to change).

export default function StarRating({ value, onChange, saving }) {
  const [hovered, setHovered] = useState(null)
  const display = hovered ?? value ?? 0
  return (
    <div
      style={{ display: 'flex', gap: 2, alignItems: 'center' }}
      onMouseLeave={() => setHovered(null)}
    >
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          disabled={saving}
          onClick={() => onChange(n)}
          onMouseEnter={() => setHovered(n)}
          aria-label={`Rate ${n} star${n !== 1 ? 's' : ''}`}
          style={{
            background: 'transparent',
            border: 'none',
            padding: '2px 1px',
            cursor: saving ? 'default' : 'pointer',
            fontSize: 18,
            color: n <= display ? '#f59e0b' : C.textFaint,
            lineHeight: 1,
            transition: 'color 0.1s',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          {n <= display ? '★' : '☆'}
        </button>
      ))}
    </div>
  )
}

// Read-only star display for admin panels. Shows numeric value as filled stars.
export function StarDisplay({ value }) {
  if (value == null) return <span style={{ fontSize: 24, fontWeight: 700, color: C.textFaint }}>—</span>
  return (
    <span style={{ fontSize: 22, fontWeight: 700, color: '#f59e0b', fontVariantNumeric: 'tabular-nums' }}>
      {value.toFixed(1)} <span style={{ fontSize: 14, color: C.textMuted }}>/ 5</span>
    </span>
  )
}

// Compact star display for usage panel (shows filled/empty stars with numeric).
export function Stars({ value }) {
  if (value == null) return <span style={{ color: C.textFaint }}>—</span>
  const full = Math.round(value)
  return (
    <span style={{ color: C.amber, letterSpacing: 1 }}>
      {'★'.repeat(full)}{'☆'.repeat(5 - full)}
      <span style={{ color: C.textMuted, fontSize: 11, marginLeft: 6, letterSpacing: 0 }}>{value.toFixed(1)}</span>
    </span>
  )
}
