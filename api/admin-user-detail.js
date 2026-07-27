// GET /api/admin-user-detail?userId=<uuid>
// Returns a rich profile for a single user: auth record, profiles, recent
// briefs (rec_log), usage summary, and their own rec_quality ratings given.
// Admin-gated.

export const config = { runtime: 'edge' }

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  process.env.ALLOWED_ORIGIN || '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

import { validateAuth, isAdminUser } from './_lib/admin.js'

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS })
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS })

  const supabaseUrl = process.env.SUPABASE_URL
  const svcKey      = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !svcKey) return json({ error: 'Server not configured.' }, 500)

  const userId = await validateAuth(req)
  if (!userId) return json({ error: 'Unauthorized' }, 401)
  if (!(await isAdminUser(userId))) return json({ error: 'Forbidden — admin access only.' }, 403)

  const url      = new URL(req.url)
  const targetId = url.searchParams.get('userId')
  if (!targetId) return json({ error: 'userId query param required.' }, 400)

  const svcH = { apikey: svcKey, Authorization: `Bearer ${svcKey}`, 'Content-Type': 'application/json' }
  const base  = `${supabaseUrl}/rest/v1`

  // Fire all lookups in parallel
  const [authRes, profilesRes, usageRes, briefsRes, ratingsRes, softDeleteRes] = await Promise.all([
    fetch(`${supabaseUrl}/auth/v1/admin/users/${targetId}`, { headers: svcH }),
    fetch(`${base}/user_profiles?user_id=eq.${targetId}&select=profile_name,handicap,home_course,created_at&order=created_at.asc`, { headers: svcH }),
    fetch(`${base}/api_usage?user_id=eq.${targetId}&select=used_at,input_tokens,output_tokens&order=used_at.desc&limit=500`, { headers: svcH }),
    fetch(`${base}/rec_log?user_id=eq.${targetId}&select=id,course_name,tee,created_at,phase_durations&order=created_at.desc&limit=10`, { headers: svcH }),
    fetch(`${base}/rec_quality?rater_id=eq.${targetId}&select=rec_log_id,rating,dimension,created_at&order=created_at.desc&limit=50`, { headers: svcH }),
    fetch(`${base}/user_soft_deletes?user_id=eq.${targetId}&select=deleted_at,deleted_by,restore_before&limit=1`, { headers: svcH }),
  ])

  const authUser     = authRes.ok     ? await authRes.json()     : null
  const profiles     = profilesRes.ok ? await profilesRes.json() : []
  const usageRows    = usageRes.ok    ? await usageRes.json()    : []
  const briefs       = briefsRes.ok   ? await briefsRes.json()   : []
  const ratings      = ratingsRes.ok  ? await ratingsRes.json()  : []
  const softDelRow   = softDeleteRes.ok ? await softDeleteRes.json() : []

  // Compute usage aggregates
  const todayCutoff = new Date(Date.now() - 86400000).toISOString()
  let callsTotal = 0, tokensTotal = 0, callsToday = 0, tokensToday = 0
  for (const r of usageRows) {
    callsTotal  += 1
    tokensTotal += (r.input_tokens || 0) + (r.output_tokens || 0)
    if ((r.used_at || '') >= todayCutoff) {
      callsToday  += 1
      tokensToday += (r.input_tokens || 0) + (r.output_tokens || 0)
    }
  }

  const avgRating = ratings.length
    ? parseFloat((ratings.reduce((s, r) => s + (r.rating || 0), 0) / ratings.length).toFixed(1))
    : null

  return json({
    user: authUser ? {
      id:              authUser.id,
      email:           authUser.email,
      created_at:      authUser.created_at,
      last_sign_in_at: authUser.last_sign_in_at,
      email_confirmed: !!authUser.email_confirmed_at,
    } : null,
    profiles:   Array.isArray(profiles) ? profiles : [],
    briefs:     Array.isArray(briefs)   ? briefs   : [],
    usage: { callsTotal, tokensTotal, callsToday, tokensToday },
    ratings: { count: ratings.length, avg: avgRating },
    softDelete: Array.isArray(softDelRow) && softDelRow.length > 0 ? softDelRow[0] : null,
  })
}
