// Vercel Edge Function — accept a human rating for a previously-generated
// recommendation and store it in public.rec_quality.
//
// Eval harness loop:
//   1. User generates a plan (api/generate.js logs to rec_log)
//   2. After playing the round, user posts to this endpoint with
//      { rec_log_id, rating: 1..5, dimension?, notes? }
//   3. Admin dashboard aggregates rec_quality joined with rec_log to compare
//      prompt versions / models / styles.
//
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

export const config = { runtime: 'edge' }

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  process.env.ALLOWED_ORIGIN || '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS })

  const authHeader = req.headers.get('Authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return jsonResponse({ error: 'Sign in required.' }, 401)

  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseServiceKey) return jsonResponse({ error: 'Server misconfigured.' }, 500)

  // Validate JWT
  let userId = null
  try {
    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: supabaseServiceKey },
    })
    if (!userRes.ok) return jsonResponse({ error: 'Invalid session.' }, 401)
    const user = await userRes.json()
    userId = user.id
  } catch {
    return jsonResponse({ error: 'Auth check failed.' }, 500)
  }

  let body
  try { body = await req.json() } catch { return jsonResponse({ error: 'Invalid JSON.' }, 400) }

  const { rec_log_id, rating, dimension, notes } = body || {}
  if (typeof rec_log_id !== 'string' || rec_log_id.length < 8) {
    return jsonResponse({ error: 'rec_log_id (uuid) required.' }, 400)
  }
  const r = parseInt(rating, 10)
  if (!Number.isFinite(r) || r < 1 || r > 5) {
    return jsonResponse({ error: 'rating must be 1..5.' }, 400)
  }
  if (dimension != null && !['accuracy', 'strategy', 'clarity', 'overall'].includes(dimension)) {
    return jsonResponse({ error: 'dimension must be accuracy|strategy|clarity|overall.' }, 400)
  }
  if (notes != null && (typeof notes !== 'string' || notes.length > 2000)) {
    return jsonResponse({ error: 'notes must be a string ≤ 2000 chars.' }, 400)
  }

  const ins = await fetch(`${supabaseUrl}/rest/v1/rec_quality`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseServiceKey,
      Authorization: `Bearer ${supabaseServiceKey}`,
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ rec_log_id, rater_id: userId, rating: r, dimension: dimension ?? 'overall', notes: notes ?? null }),
  })

  if (!ins.ok) {
    const text = await ins.text().catch(() => '')
    return jsonResponse({ error: `Insert failed (${ins.status}): ${text}` }, 502)
  }

  const rows = await ins.json().catch(() => [])
  return jsonResponse({ ok: true, row: Array.isArray(rows) ? rows[0] : null }, 200)
}
