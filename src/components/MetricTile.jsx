import { C, lbl } from '../theme.js'

// Shared metric tile component. Replaces both KpiTile (AdminOverviewPanel)
// and StatTile (AdminUsagePanel). The `size` prop controls which variant
// renders: 'lg' for the overview KPI style, 'sm' (default) for the compact
// usage style.

export default function MetricTile({ label, value, sub, color = C.text, wide = false, size = 'sm' }) {
  const isLarge = size === 'lg'
  return (
    <div style={{
      background: C.bgInput,
      border: `1px solid ${C.border}`,
      borderRadius: isLarge ? 10 : 8,
      padding: isLarge ? '12px 16px' : '10px 14px',
      gridColumn: wide ? 'span 2' : undefined,
    }}>
      <p style={{ ...lbl, margin: isLarge ? '0 0 6px' : '0 0 4px' }}>{label}</p>
      <p style={{
        fontSize: isLarge ? 24 : 20,
        fontWeight: isLarge ? 700 : 600,
        color,
        margin: 0,
        fontVariantNumeric: 'tabular-nums',
        lineHeight: 1,
      }}>
        {value}
      </p>
      {sub && <p style={{ fontSize: isLarge ? 11 : 10, color: C.textFaint, margin: `${isLarge ? 4 : 3}px 0 0` }}>{sub}</p>}
    </div>
  )
}
