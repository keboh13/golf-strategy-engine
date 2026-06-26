import { useEffect, useMemo, useState } from 'react'
import { C, F, card, inp, lbl, btnG } from '../theme.js'

// Usage sub-tab (Part 4 step 12 of the optimization plan). Renders the rollup
// /api/admin-usage already computes server-side. Quality dashboard +
// per-user rate-limit configuration land once rec_quality has signal.

const RANGE_OPTIONS = [
  { id: 7,  label: 'Last 7 days' },
  { id: 14, label: 'Last 14 days' },
  { id: 30, label: 'Last 30 days' },
  { id: 90, label: 'Last 90 days' },
]

function StatTile({ label, value, sub, color = C.text }) {
  return (
    <div style={{ background: C.bgInput, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 14px' }}>
      <p style={{ ...lbl, margin: '0 0 4px' }}>{label}</p>
      <p style={{ fontSize: 20, fontWeight: 600, color, margin: 0, fontVariantNumeric: 'tabular-nums' }}>{value}</p>
      {sub && <p style={{ fontSize: 10, color: C.textFaint, margin: '3px 0 0' }}>{sub}</p>}
    </div>
  )
}

// Inline SVG bar chart — keeps the panel dep-free. dailyTotals[].calls drives
// height; the highest bar maps to 100% of the available height.
function DailyBarChart({ data, valueKey = 'calls', color = C.accent }) {
  const max = Math.max(1, ...data.map(d => d[valueKey] || 0))
  const W = 480, H = 110, pad = 8
  const barW = (W - pad * 2) / data.length
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Daily usage chart"
      preserveAspectRatio="none"
      style={{ width: '100%', height: H, display: 'block' }}
    >
      {data.map((d, i) => {
        const v = d[valueKey] || 0
        const h = ((H - pad * 2) * v) / max
        const x = pad + i * barW
        const y = H - pad - h
        return (
          <g key={d.day}>
            <rect
              x={x + 2}
              y={y}
              width={Math.max(2, barW - 4)}
              height={h}
              fill={color}
              opacity={v > 0 ? 0.85 : 0.15}
            />
            <title>{`${d.day}: ${v}`}</title>
          </g>
        )
      })}
    </svg>
  )
}

function fmtMs(ms) {
  if (!ms) return '—'
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

export default function AdminUsagePanel({ authToken }) {
  const [days, setDays] = useState(14)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = async (n) => {
    setLoading(true); setError('')
    try {
      const res = await fetch(`/api/admin-usage?days=${n}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || `${res.status}`)
      }
      setData(await res.json())
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }

  useEffect(() => { load(days) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [days])

  const totals = useMemo(() => {
    const d = data?.dailyTotals || []
    return d.reduce(
      (acc, x) => ({
        calls:        acc.calls        + (x.calls        || 0),
        inputTokens:  acc.inputTokens  + (x.inputTokens  || 0),
        outputTokens: acc.outputTokens + (x.outputTokens || 0),
      }),
      { calls: 0, inputTokens: 0, outputTokens: 0 },
    )
  }, [data])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ ...card }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
          <p style={{ ...lbl, margin: 0 }}>Usage rollup</p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select style={{ ...inp, width: 'auto' }} value={days} onChange={e => setDays(Number(e.target.value))}>
              {RANGE_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            <button style={btnG} onClick={() => load(days)} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
          </div>
        </div>
        {error && (
          <div style={{ padding: '8px 12px', background: C.redMuted, border: `1px solid ${C.red}`, borderRadius: 8, marginBottom: 10 }}>
            <p style={{ fontSize: 12, color: C.red, margin: 0 }}>⚠ {error}</p>
          </div>
        )}
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 14 }}>
              <StatTile label="Calls" value={totals.calls.toLocaleString()} sub={`${days}-day total`} color={C.accent} />
              <StatTile label="Input tokens" value={totals.inputTokens.toLocaleString()} />
              <StatTile label="Output tokens" value={totals.outputTokens.toLocaleString()} color={C.green} />
              <StatTile label="Active users" value={(data.topUsers || []).length} sub="non-zero usage" />
            </div>
            <DailyBarChart data={data.dailyTotals || []} valueKey="calls" color={C.accent} />
            <p style={{ fontSize: 10, color: C.textFaint, margin: '4px 0 0' }}>Calls per day</p>
          </>
        )}
      </div>

      {/* ── Top users ───────────────────────────────────────────────── */}
      <div style={{ ...card }}>
        <p style={{ ...lbl, margin: '0 0 8px' }}>Top users (by tokens)</p>
        {!data && loading && <p style={{ fontSize: 12, color: C.textFaint, margin: 0 }}>Loading…</p>}
        {data && data.topUsers && data.topUsers.length === 0 && (
          <p style={{ fontSize: 12, color: C.textFaint, margin: 0 }}>No usage in the selected range.</p>
        )}
        {data && data.topUsers && data.topUsers.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {data.topUsers.map(u => (
              <div key={u.user_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '6px 10px', background: C.bgInput, border: `1px solid ${C.border}`, borderRadius: 6 }}>
                <span style={{ fontSize: 12, color: C.text, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email || u.user_id}</span>
                <span style={{ fontSize: 11, color: C.textMuted, fontVariantNumeric: 'tabular-nums' }}>
                  {u.calls.toLocaleString()} calls · {u.tokens.toLocaleString()} tokens
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Phase durations (rec_log) ───────────────────────────────── */}
      <div style={{ ...card }}>
        <p style={{ ...lbl, margin: '0 0 4px' }}>Generation latency by phase</p>
        <p style={{ fontSize: 11, color: C.textMuted, margin: '0 0 10px' }}>
          p50 / p95 from <code>rec_log.phase_durations</code>. Populated by the streaming pipeline since Part 0.4 of the optimization plan.
        </p>
        {data && Object.keys(data.phaseStats || {}).length === 0 && (
          <p style={{ fontSize: 12, color: C.textFaint, margin: 0, fontStyle: 'italic' }}>
            No phase-duration samples yet. Generate a brief or two and refresh.
          </p>
        )}
        {data && Object.keys(data.phaseStats || {}).length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
            {Object.entries(data.phaseStats).map(([id, s]) => (
              <div key={id} style={{ background: C.bgInput, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px' }}>
                <p style={{ ...lbl, margin: '0 0 4px' }}>{id}</p>
                <p style={{ fontSize: 12, color: C.textMuted, margin: 0 }}>
                  p50 <strong style={{ color: C.text }}>{fmtMs(s.p50)}</strong>
                </p>
                <p style={{ fontSize: 12, color: C.textMuted, margin: 0 }}>
                  p95 <strong style={{ color: C.amber }}>{fmtMs(s.p95)}</strong>
                </p>
                <p style={{ fontSize: 10, color: C.textFaint, margin: '4px 0 0' }}>{s.count.toLocaleString()} samples</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
