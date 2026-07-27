import { useEffect, useState } from 'react'
import { C, F, card, btnG, lbl } from '../theme.js'
import { fmtMs } from '../lib/formatters.js'
import { StarDisplay } from './StarRating.jsx'
import MetricTile from './MetricTile.jsx'

function fmtNum(n, fallback = '—') {
  if (n == null || n === 0 && fallback === '—') return n === 0 ? '0' : fallback
  return typeof n === 'number' ? n.toLocaleString() : n
}

export default function AdminOverviewPanel({ authToken, onSubNav }) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const [loadedAt, setLoadedAt] = useState(null)

  const load = async () => {
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/admin-overview', {
        headers: { Authorization: `Bearer ${authToken}` },
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || `${res.status}`)
      }
      setData(await res.json())
      setLoadedAt(new Date())
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }

  useEffect(() => { load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── Header ────────────────────────────────────────────── */}
      <div style={{ ...card }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: error ? 10 : 0 }}>
          <div>
            <p style={{ ...lbl, margin: 0 }}>Dashboard overview</p>
            {loadedAt && (
              <p style={{ fontSize: 11, color: C.textFaint, margin: '2px 0 0' }}>
                Updated {loadedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
          </div>
          <button style={btnG} onClick={load} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
        {error && (
          <div style={{ padding: '8px 12px', background: C.redMuted, border: `1px solid ${C.red}`, borderRadius: 8 }}>
            <p style={{ fontSize: 12, color: C.red, margin: 0 }}>⚠ {error}</p>
          </div>
        )}
      </div>

      {/* ── KPI grid ──────────────────────────────────────────── */}
      {(data || loading) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
          <MetricTile size="lg"
            label="Registered users"
            value={loading ? '…' : fmtNum(data?.totalUsers)}
            color={C.accent}
          />
          <MetricTile size="lg"
            label="Courses cached"
            value={loading ? '…' : fmtNum(data?.totalCourses)}
            sub={data?.needsReview > 0 ? `${data.needsReview} need review` : 'all reviewed'}
            color={C.text}
          />
          <MetricTile size="lg"
            label="Calls today"
            value={loading ? '…' : fmtNum(data?.callsToday)}
            color={data?.callsToday > 0 ? C.green : C.textMuted}
          />
          <MetricTile size="lg"
            label="Calls this week"
            value={loading ? '…' : fmtNum(data?.callsThisWeek)}
            sub={data ? `${(data.tokensThisWeek || 0).toLocaleString()} tokens` : undefined}
          />
          <MetricTile size="lg"
            label="Avg brief rating"
            value={loading ? '…' : <StarDisplay value={data?.avgRating ?? null} />}
            sub={data?.ratingCount > 0 ? `${data.ratingCount} rating${data.ratingCount === 1 ? '' : 's'} (30d)` : 'No ratings yet'}
          />
          <MetricTile size="lg"
            label="Gen latency p50"
            value={loading ? '…' : fmtMs(data?.phaseP50)}
            sub={data?.phaseP95 != null ? `p95 ${fmtMs(data.phaseP95)}` : '14-day window'}
            color={data?.phaseP50 != null && data.phaseP50 > 20000 ? C.amber : C.text}
          />
        </div>
      )}

      {/* ── Quick links ───────────────────────────────────────── */}
      <div style={{ ...card }}>
        <p style={{ ...lbl, margin: '0 0 10px' }}>Quick links</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          {[
            { icon: '👥', label: 'Manage users', hint: 'Invite, grant roles, delete', tab: 'users' },
            { icon: '⛳', label: 'Course browser', hint: 'Edit metadata, upload scorecards', tab: 'courses' },
            { icon: '📈', label: 'Usage charts', hint: 'API calls, tokens, phase latency', tab: 'usage' },
            { icon: '📜', label: 'Audit log', hint: 'Who changed what and when', tab: 'audit' },
            { icon: '🗂', label: 'Data & cache', hint: 'Cache health, OSM stats', tab: 'data' },
          ].map(({ icon, label, hint, tab }) => (
            <button
              key={tab}
              onClick={() => onSubNav?.(tab)}
              style={{
                background: C.bgInput, border: `1px solid ${C.border}`, borderRadius: 10,
                padding: '12px 14px', cursor: 'pointer', textAlign: 'left', fontFamily: F,
                transition: 'border-color 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = C.accent}
              onMouseLeave={e => e.currentTarget.style.borderColor = C.border}
            >
              <p style={{ fontSize: 16, margin: '0 0 4px' }}>{icon}</p>
              <p style={{ fontSize: 13, fontWeight: 600, color: C.text, margin: '0 0 2px' }}>{label}</p>
              <p style={{ fontSize: 11, color: C.textMuted, margin: 0 }}>{hint}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
