// Vercel Edge Function — admin Overview dashboard data.
//
//   GET /api/admin-overview → {
//     totalUsers:      number,   // all-time registered users
//     totalCourses:    number,   // rows in course_cache
//     needsReview:     number,   // courses with _needs_review flag
//     callsToday:      number,
//     callsThisWeek:   number,
//     tokensThisWeek:  number,
//     avgRating:       number|null,  // last 30 days, null if no data
//     ratingCount:     number,
//     phaseP50:        number|null,  // ms, overall generation p50 (14 days)
//     phaseP95:        number|null,
//   }
//
// All data is aggregated server-side from existing tables so the Overview
// panel needs only one round-trip. Admin-gated.

export const config = { runtime: 'edge' }

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  process.env.ALLOWED_ORIGIN || '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

import { validateAuth, isAdminUser } from './_lib/admin.js'

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

function percentile(sorted, pct) {
  if (!sorted.length) return null
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

  const svcHeaders = { apikey: svcKey, Authorization: `Bearer ${svcKey}` }

  const todayStart = new Date()
  todayStart.setUTCHours(0, 0, 0, 0)
  const weekStartIso   = new Date(Date.now() - 7  * 86400000).toISOString()
  const monthStartIso  = new Date(Date.now() - 30 * 86400000).toISOString()
  const fortStartIso   = new Date(Date.now() - 14 * 86400000).toISOString()

  // Fire all reads in parallel to keep the response fast.
  const [usersRes, coursesRes, usageRes, ratingsRes, recLogRes] = await Promise.all([
    // Total registered users
    fetch(`${supabaseUrl}/auth/v1/admin/users?per_page=1`, {
      headers: { ...svcHeaders, 'Content-Type': 'application/json' },
    }),
    // Total courses + needs-review count
    fetch(`${supabaseUrl}/rest/v1/course_cache?select=cache_key,course_data->>_needs_review`, {
      headers: svcHeaders,
    }),
    // api_usage last 7 days
    fetch(`${supabaseUrl}/rest/v1/api_usage?used_at=gte.${encodeURIComponent(weekStartIso)}&select=used_at,input_tokens,output_tokens&limit=5000`, {
      headers: svcHeaders,
    }),
    // rec_quality last 30 days
    fetch(`${supabaseUrl}/rest/v1/rec_quality?created_at=gte.${encodeURIComponent(monthStartIso)}&select=rating&limit=2000`, {
      headers: svcHeaders,
    }),
    // rec_log phase_durations last 14 days
    fetch(`${supabaseUrl}/rest/v1/rec_log?created_at=gte.${encodeURIComponent(fortStartIso)}&select=phase_durations&limit=3000`, {
      headers: svcHeaders,
    }),
  ])

  // totalUsers — Supabase returns total in the response body pagination field
  let totalUsers = 0
  if (usersRes.ok) {
    const body = await usersRes.json()
    totalUsers = body.total ?? (body.users?.length ?? 0)
  }

  // totalCourses + needsReview
  let totalCourses = 0, needsReview = 0
  if (coursesRes.ok) {
    const rows = await coursesRes.json()
    totalCourses = rows.length
    needsReview  = rows.filter(r => r['?column?'] === 'true' || r._needs_review === 'true').length
  }

  // callsToday / callsThisWeek / tokensThisWeek
  let callsToday = 0, callsThisWeek = 0, tokensThisWeek = 0
  if (usageRes.ok) {
    const rows = await usageRes.json()
    const todayIso = todayStart.toISOString()
    for (const r of rows) {
      callsThisWeek += 1
      tokensThisWeek += (r.input_tokens || 0) + (r.output_tokens || 0)
      if ((r.used_at || '') >= todayIso) callsToday += 1
    }
  }

  // avgRating / ratingCount
  let avgRating = null, ratingCount = 0
  if (ratingsRes.ok) {
    const rows = await ratingsRes.json()
    ratingCount = rows.length
    if (ratingCount > 0) {
      avgRating = parseFloat((rows.reduce((s, r) => s + (r.rating || 0), 0) / ratingCount).toFixed(1))
    }
  }

  // phaseP50 / phaseP95 — flatten all per-phase durations into one pool
  let phaseP50 = null, phaseP95 = null
  if (recLogRes.ok) {
    const rows = await recLogRes.json()
    const allMs = []
    for (const r of rows) {
      const pd = r.phase_durations || {}
      for (const ms of Object.values(pd)) {
        if (typeof ms === 'number' && Number.isFinite(ms) && ms >= 0) allMs.push(ms)
      }
    }
    if (allMs.length) {
      allMs.sort((a, b) => a - b)
      phaseP50 = percentile(allMs, 50)
      phaseP95 = percentile(allMs, 95)
    }
  }

  return jsonResponse({
    totalUsers,
    totalCourses,
    needsReview,
    callsToday,
    callsThisWeek,
    tokensThisWeek,
    avgRating,
    ratingCount,
    phaseP50,
    phaseP95,
  })
}
