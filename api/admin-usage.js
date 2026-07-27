// Vercel Edge Function — admin-only usage telemetry.
//
//   GET /api/admin-usage?days=14 → {
//     dailyTotals: [{ day, calls, inputTokens, outputTokens }],
//     topUsers:    [{ user_id, email, calls, tokens }],
//     phaseStats:  { [phaseId]: { p50, p95, count } },
//   }
//
// Reads api_usage (per-day rollup) and rec_log.phase_durations (latency
// percentiles). All aggregation is done in the function — the client just
// renders. Admin-gated; supports the new user_roles table + legacy admins.
//
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

export const config = { runtime: 'edge' }

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  process.env.ALLOWED_ORIGIN || '',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

import { validateAuth, isAdminUser } from './_lib/admin.js'

// Compute a percentile from a sorted ascending number array. Returns 0 when
// the sample is empty so the client can render 0 instead of NaN.
function percentile(sorted, pct) {
  if (!sorted.length) return 0
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((pct / 100) * sorted.length)))
  return sorted[idx]
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS })
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS })

  const supabaseUrl = process.env.SUPABASE_URL
  const svcKey      = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !svcKey) return jsonResponse({ error: 'Server not configured.' }, 500)

  const userId = await validateAuth(req)
  if (!userId) return jsonResponse({ error: 'Unauthorized' }, 401)
  if (!(await isAdminUser(userId))) return jsonResponse({ error: 'Forbidden — admin access only.' }, 403)

  const url = new URL(req.url)
  const days = Math.min(Math.max(parseInt(url.searchParams.get('days') || '14', 10), 1), 90)
  const windowStartIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

  const svcHeaders = { apikey: svcKey, Authorization: `Bearer ${svcKey}` }

  // ── api_usage rollup (daily + per-user) ───────────────────────────────────
  const usageRes = await fetch(
    `${supabaseUrl}/rest/v1/api_usage?used_at=gte.${encodeURIComponent(windowStartIso)}&select=user_id,used_at,input_tokens,output_tokens&order=used_at.asc&limit=5000`,
    { headers: svcHeaders },
  )
  if (!usageRes.ok) return jsonResponse({ error: `api_usage read failed: ${await usageRes.text()}` }, 500)
  const usageRows = await usageRes.json()

  // Pre-fill every day in the window with zeros so the chart always has a
  // continuous x-axis even when nothing happened that day.
  const dailyByKey = new Map()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000)
    const key = d.toISOString().slice(0, 10)
    dailyByKey.set(key, { day: key, calls: 0, inputTokens: 0, outputTokens: 0 })
  }

  const perUser = new Map()
  for (const row of usageRows) {
    const key = (row.used_at || '').slice(0, 10)
    const bucket = dailyByKey.get(key)
    if (bucket) {
      bucket.calls += 1
      bucket.inputTokens  += row.input_tokens  || 0
      bucket.outputTokens += row.output_tokens || 0
    }
    const u = row.user_id
    if (!u) continue
    if (!perUser.has(u)) perUser.set(u, { user_id: u, calls: 0, tokens: 0 })
    const ub = perUser.get(u)
    ub.calls += 1
    ub.tokens += (row.input_tokens || 0) + (row.output_tokens || 0)
  }

  const topUsers = [...perUser.values()]
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 10)

  // Resolve emails for the top-N. Single batched auth admin call.
  if (topUsers.length > 0) {
    const listRes = await fetch(`${supabaseUrl}/auth/v1/admin/users?per_page=500`, { headers: { ...svcHeaders, 'Content-Type': 'application/json' } })
    if (listRes.ok) {
      const { users } = await listRes.json()
      const emailById = new Map((users || []).map(u => [u.id, u.email]))
      for (const u of topUsers) u.email = emailById.get(u.user_id) || u.user_id.slice(0, 8)
    }
  }

  // ── rec_log.phase_durations percentiles ──────────────────────────────────
  const recRes = await fetch(
    `${supabaseUrl}/rest/v1/rec_log?created_at=gte.${encodeURIComponent(windowStartIso)}&select=phase_durations&limit=5000`,
    { headers: svcHeaders },
  )
  const recRows = recRes.ok ? await recRes.json() : []
  const phaseSamples = new Map() // phaseId → number[]
  for (const r of recRows) {
    const pd = r.phase_durations || {}
    for (const [id, ms] of Object.entries(pd)) {
      if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) continue
      if (!phaseSamples.has(id)) phaseSamples.set(id, [])
      phaseSamples.get(id).push(ms)
    }
  }
  const phaseStats = {}
  for (const [id, arr] of phaseSamples.entries()) {
    arr.sort((a, b) => a - b)
    phaseStats[id] = {
      count: arr.length,
      p50:   percentile(arr, 50),
      p95:   percentile(arr, 95),
    }
  }

  // ── rec_quality: ratings by course + by dimension ─────────────────────────
  // Join rec_quality → rec_log to get course_key per rating. All-time (no
  // window) so even a sparse quality signal shows up even if it predates the
  // selected date range.
  const qualRes = await fetch(
    `${supabaseUrl}/rest/v1/rec_quality?select=rating,dimension,rec_log:rec_log_id!inner(course_key)&limit=5000`,
    { headers: svcHeaders },
  )
  const qualRows = qualRes.ok ? await qualRes.json() : []

  const avgArr = (arr) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null

  const allRatings = []
  const dimSamples = {}
  const courseSamples = new Map()

  for (const r of qualRows) {
    const courseKey = r.rec_log?.course_key || '(unknown)'
    const dim = r.dimension || 'overall'
    const rating = r.rating
    if (!Number.isFinite(rating)) continue

    allRatings.push(rating)
    if (!dimSamples[dim]) dimSamples[dim] = []
    dimSamples[dim].push(rating)

    if (!courseSamples.has(courseKey)) courseSamples.set(courseKey, { all: [], byDim: {} })
    const ce = courseSamples.get(courseKey)
    ce.all.push(rating)
    if (!ce.byDim[dim]) ce.byDim[dim] = []
    ce.byDim[dim].push(rating)
  }

  const byCourse = [...courseSamples.entries()]
    .map(([key, { all, byDim }]) => ({
      course_key: key,
      count: all.length,
      avg: avgArr(all),
      byDimension: Object.fromEntries(Object.entries(byDim).map(([k, arr]) => [k, avgArr(arr)])),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15)

  const qualityStats = {
    totalRatings: allRatings.length,
    overallAvg: avgArr(allRatings),
    byDimension: Object.fromEntries(
      Object.entries(dimSamples).map(([k, arr]) => [k, { avg: avgArr(arr), count: arr.length }])
    ),
    byCourse,
  }

  // ── per-user daily caps from user_roles ──────────────────────────────────
  const capsRes = await fetch(
    `${supabaseUrl}/rest/v1/user_roles?select=user_id,daily_cap&daily_cap=not.is.null`,
    { headers: svcHeaders },
  )
  const capsRows = capsRes.ok ? await capsRes.json() : []
  const dailyCaps = Object.fromEntries((capsRows || []).map(r => [r.user_id, r.daily_cap]))

  return jsonResponse({
    days,
    dailyTotals: [...dailyByKey.values()],
    topUsers,
    phaseStats,
    qualityStats,
    dailyCaps,
  })
}
