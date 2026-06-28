import { useEffect, useMemo, useState } from 'react'
import { C, F, card, inp, lbl, btnG, btnP } from '../theme.js'

const RANGE_OPTIONS = [
  { id: 7,  label: 'Last 7 days' },
  { id: 14, label: 'Last 14 days' },
  { id: 30, label: 'Last 30 days' },
  { id: 90, label: 'Last 90 days' },
]

const DIMENSIONS = ['overall', 'accuracy', 'strategy', 'clarity']

function StatTile({ label, value, sub, color = C.text }) {
  return (
    <div style={{ background: C.bgInput, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 14px' }}>
      <p style={{ ...lbl, margin: '0 0 4px' }}>{label}</p>
      <p style={{ fontSize: 20, fontWeight: 600, color, margin: 0, fontVariantNumeric: 'tabular-nums' }}>{value}</p>
      {sub && <p style={{ fontSize: 10, color: C.textFaint, margin: '3px 0 0' }}>{sub}</p>}
    </div>
  )
}

function Stars({ value }) {
  if (value == null) return <span style={{ color: C.textFaint }}>—</span>
  const full  = Math.round(value)
  return (
    <span style={{ color: C.amber, letterSpacing: 1 }}>
      {'★'.repeat(full)}{'☆'.repeat(5 - full)}
      <span style={{ color: C.textMuted, fontSize: 11, marginLeft: 6, letterSpacing: 0 }}>{value.toFixed(1)}</span>
    </span>
  )
}

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
            <rect x={x + 2} y={y} width={Math.max(2, barW - 4)} height={h} fill={color} opacity={v > 0 ? 0.85 : 0.15} />
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

function shortKey(key) {
  if (!key) return '—'
  const parts = key.split('|')
  return parts[0]?.replace(/\b\w/g, c => c.toUpperCase()) || key
}

// Inline rate-limit editor for a single user row.
function RateLimitCell({ userId, cap, globalDefault, authToken, onSaved }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal]         = useState(cap != null ? String(cap) : '')
  const [saving, setSaving]   = useState(false)
  const [err, setErr]         = useState('')

  const save = async () => {
    setSaving(true); setErr('')
    const parsed = val.trim() === '' ? null : parseInt(val, 10)
    if (val.trim() !== '' && (isNaN(parsed) || parsed < 0)) {
      setErr('Enter a positive number or leave blank to reset.')
      setSaving(false)
      return
    }
    try {
      const res = await fetch('/api/admin-rate-limit', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ user_id: userId, daily_cap: parsed }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || res.status) }
      onSaved(userId, parsed)
      setEditing(false)
    } catch (e) { setErr(e.message) }
    setSaving(false)
  }

  if (!editing) {
    const display = cap != null ? `${cap}/day` : `default (${globalDefault}/day)`
    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 11, color: cap != null ? C.amber : C.textFaint }}>{display}</span>
        <button onClick={() => setEditing(true)} style={{ fontSize: 10, color: C.accent, background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: F }}>
          edit
        </button>
      </span>
    )
  }

  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <input
        style={{ ...inp, width: 60, padding: '2px 6px', fontSize: 11 }}
        value={val}
        onChange={e => setVal(e.target.value)}
        placeholder={String(globalDefault)}
        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
        autoFocus
      />
      <button onClick={save} disabled={saving} style={{ ...btnP, padding: '2px 8px', fontSize: 10 }}>
        {saving ? '…' : 'Save'}
      </button>
      <button onClick={() => { setEditing(false); setErr('') }} style={{ ...btnG, padding: '2px 6px', fontSize: 10 }}>✕</button>
      {err && <span style={{ fontSize: 10, color: C.red }}>{err}</span>}
    </span>
  )
}

export default function AdminUsagePanel({ authToken }) {
  const [days, setDays]     = useState(14)
  const [data, setData]     = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState('')
  const [caps, setCaps]     = useState({}) // user_id → daily_cap (local state after edits)

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
      const json = await res.json()
      setData(json)
      setCaps(json.dailyCaps || {})
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

  const globalDefault = 20 // mirrors RATE_LIMIT_PER_DAY env var default in generate.js

  const handleCapSaved = (userId, newCap) => {
    setCaps(prev => ({ ...prev, [userId]: newCap }))
  }

  const qs = data?.qualityStats

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── Usage rollup ──────────────────────────────────────────────────── */}
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

      {/* ── Top users + rate limits ───────────────────────────────────────── */}
      <div style={{ ...card }}>
        <p style={{ ...lbl, margin: '0 0 8px' }}>Top users — usage & rate limits</p>
        {!data && loading && <p style={{ fontSize: 12, color: C.textFaint, margin: 0 }}>Loading…</p>}
        {data?.topUsers?.length === 0 && (
          <p style={{ fontSize: 12, color: C.textFaint, margin: 0 }}>No usage in the selected range.</p>
        )}
        {data?.topUsers?.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {data.topUsers.map(u => (
              <div key={u.user_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 10px', background: C.bgInput, border: `1px solid ${C.border}`, borderRadius: 6, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 12, color: C.text, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                    {u.email || u.user_id}
                  </span>
                  <span style={{ fontSize: 11, color: C.textMuted, fontVariantNumeric: 'tabular-nums' }}>
                    {u.calls.toLocaleString()} calls · {u.tokens.toLocaleString()} tokens
                  </span>
                </div>
                <RateLimitCell
                  userId={u.user_id}
                  cap={caps[u.user_id] ?? null}
                  globalDefault={globalDefault}
                  authToken={authToken}
                  onSaved={handleCapSaved}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Quality dashboard ─────────────────────────────────────────────── */}
      <div style={{ ...card }}>
        <p style={{ ...lbl, margin: '0 0 4px' }}>Brief quality ratings</p>
        <p style={{ fontSize: 11, color: C.textMuted, margin: '0 0 12px' }}>
          User star ratings from History → "Rate this brief." All-time.
        </p>

        {!qs && loading && <p style={{ fontSize: 12, color: C.textFaint, margin: 0 }}>Loading…</p>}

        {qs?.totalRatings === 0 && (
          <p style={{ fontSize: 12, color: C.textFaint, margin: 0, fontStyle: 'italic' }}>
            No ratings yet. Generate a brief and rate it in History to start collecting signal.
          </p>
        )}

        {qs && qs.totalRatings > 0 && (
          <>
            {/* Overall + by dimension */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
              <div style={{ background: C.bgInput, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 14px' }}>
                <p style={{ ...lbl, margin: '0 0 4px' }}>Overall avg</p>
                <Stars value={qs.overallAvg} />
                <p style={{ fontSize: 10, color: C.textFaint, margin: '4px 0 0' }}>{qs.totalRatings} rating{qs.totalRatings !== 1 ? 's' : ''}</p>
              </div>
              {DIMENSIONS.map(dim => {
                const d = qs.byDimension?.[dim]
                if (!d) return null
                return (
                  <div key={dim} style={{ background: C.bgInput, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 14px' }}>
                    <p style={{ ...lbl, margin: '0 0 4px' }}>{dim.charAt(0).toUpperCase() + dim.slice(1)}</p>
                    <Stars value={d.avg} />
                    <p style={{ fontSize: 10, color: C.textFaint, margin: '4px 0 0' }}>{d.count} rating{d.count !== 1 ? 's' : ''}</p>
                  </div>
                )
              })}
            </div>

            {/* By course */}
            {qs.byCourse?.length > 0 && (
              <>
                <p style={{ ...lbl, margin: '0 0 8px' }}>By course</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {qs.byCourse.map(c => (
                    <div key={c.course_key} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 12, alignItems: 'center', padding: '6px 10px', background: C.bgInput, border: `1px solid ${C.border}`, borderRadius: 6 }}>
                      <span style={{ fontSize: 12, color: C.text, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {shortKey(c.course_key)}
                      </span>
                      <Stars value={c.avg} />
                      <span style={{ fontSize: 11, color: C.textFaint, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                        {c.count} rating{c.count !== 1 ? 's' : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* ── Phase durations ───────────────────────────────────────────────── */}
      <div style={{ ...card }}>
        <p style={{ ...lbl, margin: '0 0 4px' }}>Generation latency by phase</p>
        <p style={{ fontSize: 11, color: C.textMuted, margin: '0 0 10px' }}>
          p50 / p95 from <code>rec_log.phase_durations</code>.
        </p>
        {data && Object.keys(data.phaseStats || {}).length === 0 && (
          <p style={{ fontSize: 12, color: C.textFaint, margin: 0, fontStyle: 'italic' }}>
            No phase-duration samples yet.
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
