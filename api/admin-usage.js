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
  'Access-Control-Allow-Origin':  process.env.ALLOWED_ORIGIN || '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

async function isAdmin(supabaseUrl, svcKey, userId) {
  const [a, r] = await Promise.all([
    fetch(`${supabaseUrl}/rest/v1/admins?user_id=eq.${userId}&select=user_id&limit=1`,
      { headers: { apikey: svcKey, Authorization: `Bearer ${svcKey}` } }),
    fetch(`${supabaseUrl}/rest/v1/user_roles?user_id=eq.${userId}&role=in.(admin,owner)&select=user_id&limit=1`,
      { headers: { apikey: svcKey, Authorization: `Bearer ${svcKey}` } }),
  ])
  const rowsA = a.ok ? await a.json() : []
  const rowsR = r.ok ? await r.json() : []
  return (Array.isArray(rowsA) && rowsA.length > 0) || (Array.isArray(rowsR) && rowsR.length > 0)
}

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

  const token = (req.headers.get('Authorization') || '').replace('Bearer ', '')
  if (!token) return jsonResponse({ error: 'Unauthorized' }, 401)

  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: svcKey },
  })
  if (!userRes.ok) return jsonResponse({ error: 'Invalid or expired session.' }, 401)
  const requester = await userRes.json()
  if (!(await isAdmin(supabaseUrl, svcKey, requester.id))) {
    return jsonResponse({ error: 'Forbidden — admin access only.' }, 403)
  }

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

  return jsonResponse({
    days,
    dailyTotals: [...dailyByKey.values()],
    topUsers,
    phaseStats,
  })
}
