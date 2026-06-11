// Vercel Edge Function — admin-only user management.
// GET    /api/admin-users              → list all users with usage stats
// POST   /api/admin-users { grantId } → grant admin to a user by ID
// DELETE /api/admin-users { userId }  → delete a user and their data
//
// Access is gated to the `admins` Supabase table. The initial row is seeded
// from ADMIN_EMAIL. Admins can grant access to others via POST.
// Required Vercel env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

export const config = { runtime: 'edge' }

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  process.env.ALLOWED_ORIGIN || '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
}

async function isAdmin(supabaseUrl, supabaseServiceKey, userId) {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/admins?user_id=eq.${userId}&select=user_id&limit=1`,
    { headers: { apikey: supabaseServiceKey, Authorization: `Bearer ${supabaseServiceKey}` } }
  )
  const rows = res.ok ? await res.json() : []
  return Array.isArray(rows) && rows.length > 0
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS })

  const supabaseUrl        = process.env.SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    return new Response(JSON.stringify({ error: 'Server not configured.' }), {
      status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  // Auth — validate the requesting user's session
  const token = (req.headers.get('Authorization') || '').replace('Bearer ', '')
  if (!token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: supabaseServiceKey },
  })
  if (!userRes.ok) {
    return new Response(JSON.stringify({ error: 'Invalid or expired session.' }), {
      status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }
  const requester = await userRes.json()

  // Gate: admins table check
  if (!(await isAdmin(supabaseUrl, supabaseServiceKey, requester.id))) {
    return new Response(JSON.stringify({ error: 'Forbidden — admin access only.' }), {
      status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  const svcHeaders = {
    apikey: supabaseServiceKey,
    Authorization: `Bearer ${supabaseServiceKey}`,
    'Content-Type': 'application/json',
  }

  // ── GET: list all users ──────────────────────────────────────────────────
  if (req.method === 'GET') {
    const listRes = await fetch(`${supabaseUrl}/auth/v1/admin/users?per_page=500`, { headers: svcHeaders })
    if (!listRes.ok) {
      const err = await listRes.text()
      return new Response(JSON.stringify({ error: `Supabase error: ${err}` }), {
        status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }
    const { users } = await listRes.json()

    // Pull today's usage counts from api_usage table
    const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const [todayRes, totalRes] = await Promise.all([
      fetch(`${supabaseUrl}/rest/v1/api_usage?used_at=gte.${encodeURIComponent(windowStart)}&select=user_id`, { headers: { ...svcHeaders, Prefer: 'count=exact' } }),
      fetch(`${supabaseUrl}/rest/v1/api_usage?select=user_id`, { headers: svcHeaders }),
    ])

    let todayByUser = {}
    let totalByUser = {}

    if (todayRes.ok) {
      const todayRows = await todayRes.json()
      for (const r of todayRows) todayByUser[r.user_id] = (todayByUser[r.user_id] || 0) + 1
    }
    if (totalRes.ok) {
      const totalRows = await totalRes.json()
      for (const r of totalRows) totalByUser[r.user_id] = (totalByUser[r.user_id] || 0) + 1
    }

    // Fetch current admin IDs
    const adminsRes = await fetch(`${supabaseUrl}/rest/v1/admins?select=user_id`, { headers: svcHeaders })
    const adminRows = adminsRes.ok ? await adminsRes.json() : []
    const adminIds  = new Set((adminRows || []).map(r => r.user_id))

    const enriched = (users || []).map(u => ({
      id:              u.id,
      email:           u.email,
      created_at:      u.created_at,
      last_sign_in_at: u.last_sign_in_at,
      usage_today:     todayByUser[u.id] || 0,
      usage_total:     totalByUser[u.id] || 0,
      isAdmin:         adminIds.has(u.id),
    }))

    return new Response(JSON.stringify(enriched), {
      status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  // ── POST: grant admin to a user ─────────────────────────────────────────
  if (req.method === 'POST') {
    let body
    try { body = await req.json() } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body.' }), {
        status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }
    const { grantId } = body
    if (!grantId) {
      return new Response(JSON.stringify({ error: 'grantId is required.' }), {
        status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }
    const grantRes = await fetch(`${supabaseUrl}/rest/v1/admins`, {
      method: 'POST',
      headers: { ...svcHeaders, Prefer: 'resolution=ignore-duplicates' },
      body: JSON.stringify({ user_id: grantId, granted_by: requester.id }),
    })
    if (!grantRes.ok) {
      const err = await grantRes.text()
      return new Response(JSON.stringify({ error: `Failed to grant admin: ${err}` }), {
        status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  // ── DELETE: remove a user ────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    let body
    try { body = await req.json() } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body.' }), {
        status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }
    const { userId } = body
    if (!userId) {
      return new Response(JSON.stringify({ error: 'userId is required.' }), {
        status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    const base = `${supabaseUrl}/rest/v1`

    // Delete all app data for this user
    await Promise.allSettled([
      fetch(`${base}/user_profiles?user_id=eq.${userId}`,   { method: 'DELETE', headers: svcHeaders }),
      fetch(`${base}/scoring_history?user_id=eq.${userId}`, { method: 'DELETE', headers: svcHeaders }),
      fetch(`${base}/user_settings?user_id=eq.${userId}`,   { method: 'DELETE', headers: svcHeaders }),
      fetch(`${base}/api_usage?user_id=eq.${userId}`,       { method: 'DELETE', headers: svcHeaders }),
    ])

    // Delete auth account
    const delRes = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
      method: 'DELETE', headers: svcHeaders,
    })
    if (!delRes.ok) {
      const err = await delRes.text()
      return new Response(JSON.stringify({ error: `Failed to delete user: ${err}` }), {
        status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS })
}
