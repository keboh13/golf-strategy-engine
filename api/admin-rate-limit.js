// Vercel Edge Function — admin-only per-user rate limit configuration.
//
//   PATCH /api/admin-rate-limit { user_id, daily_cap }
//     daily_cap: integer (0+ sets a custom cap) | null (resets to global default)
//   Returns { ok: true, user_id, daily_cap }
//
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

export const config = { runtime: 'edge' }

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  process.env.ALLOWED_ORIGIN || '',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'PATCH, OPTIONS',
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

import { validateAuth, isAdminUser } from './_lib/admin.js'

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS })
  if (req.method !== 'PATCH') return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS })

  const supabaseUrl = process.env.SUPABASE_URL
  const svcKey      = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !svcKey) return jsonResponse({ error: 'Server not configured.' }, 500)

  const userId = await validateAuth(req)
  if (!userId) return jsonResponse({ error: 'Unauthorized' }, 401)
  if (!(await isAdminUser(userId))) return jsonResponse({ error: 'Forbidden — admin access only.' }, 403)

  let body
  try { body = await req.json() } catch { return jsonResponse({ error: 'Invalid JSON.' }, 400) }

  const { user_id, daily_cap } = body
  if (!user_id) return jsonResponse({ error: 'Missing user_id.' }, 400)
  if (daily_cap !== null && (typeof daily_cap !== 'number' || !Number.isInteger(daily_cap) || daily_cap < 0)) {
    return jsonResponse({ error: 'daily_cap must be a non-negative integer or null.' }, 400)
  }

  const svcHeaders = {
    apikey: svcKey,
    Authorization: `Bearer ${svcKey}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  }

  // Upsert into user_roles — create row if none exists, otherwise patch daily_cap only.
  const upsertRes = await fetch(
    `${supabaseUrl}/rest/v1/user_roles?on_conflict=user_id`,
    {
      method: 'POST',
      headers: svcHeaders,
      body: JSON.stringify({ user_id, daily_cap, role: 'viewer' }),
    },
  )

  if (!upsertRes.ok) {
    // If the user already has a row, upsert might conflict on role default — PATCH instead.
    const patchRes = await fetch(
      `${supabaseUrl}/rest/v1/user_roles?user_id=eq.${user_id}`,
      { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ daily_cap }) },
    )
    if (!patchRes.ok) {
      return jsonResponse({ error: `Failed to update rate limit: ${await patchRes.text()}` }, 500)
    }
  }

  return jsonResponse({ ok: true, user_id, daily_cap })
}
