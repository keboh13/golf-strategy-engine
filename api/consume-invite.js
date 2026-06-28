// Public endpoint — no admin auth required. Called by the invite landing page.
//
//   GET  ?token=<token>
//     → { email, role, profileName } if invite is valid (not expired, not consumed)
//     → 404 if token not found, 410 if expired/consumed
//
//   POST { token }  — Authorization: Bearer <user-jwt> required
//     → marks invite consumed_at, consumed_by; seeds user_roles with the invite role
//     → { ok: true }

export const config = { runtime: 'edge' }

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  process.env.ALLOWED_ORIGIN || '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS })

  const supabaseUrl = process.env.SUPABASE_URL
  const svcKey      = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !svcKey) return json({ error: 'Server not configured.' }, 500)

  const svcH = { apikey: svcKey, Authorization: `Bearer ${svcKey}`, 'Content-Type': 'application/json' }
  const base  = `${supabaseUrl}/rest/v1`

  // ── GET: look up invite by token (public — no auth) ───────────────────────
  if (req.method === 'GET') {
    const token = new URL(req.url).searchParams.get('token')
    if (!token) return json({ error: 'token is required.' }, 400)

    const res = await fetch(
      `${base}/invites?token=eq.${encodeURIComponent(token)}&select=email,role,profile_name,expires_at,consumed_at&limit=1`,
      { headers: svcH }
    )
    if (!res.ok) return json({ error: 'Lookup failed.' }, 500)
    const rows = await res.json()
    if (!rows.length) return json({ error: 'Invite not found.' }, 404)

    const inv = rows[0]
    if (inv.consumed_at) return json({ error: 'This invite has already been used.' }, 410)
    if (inv.expires_at && new Date(inv.expires_at) < new Date()) {
      return json({ error: 'This invite has expired.' }, 410)
    }

    return json({ email: inv.email, role: inv.role, profileName: inv.profile_name })
  }

  // ── POST: consume invite — user must be authenticated ────────────────────
  if (req.method === 'POST') {
    const bearerToken = (req.headers.get('Authorization') || '').replace('Bearer ', '')
    if (!bearerToken) return json({ error: 'Unauthorized — sign in first.' }, 401)

    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${bearerToken}`, apikey: svcKey },
    })
    if (!userRes.ok) return json({ error: 'Invalid or expired session.' }, 401)
    const user = await userRes.json()

    let body
    try { body = await req.json() } catch { return json({ error: 'Invalid JSON.' }, 400) }
    const { token } = body
    if (!token) return json({ error: 'token is required.' }, 400)

    // Re-read invite with lock-style check
    const invRes = await fetch(
      `${base}/invites?token=eq.${encodeURIComponent(token)}&select=email,role,profile_name,expires_at,consumed_at&limit=1`,
      { headers: svcH }
    )
    const invRows = invRes.ok ? await invRes.json() : []
    if (!invRows.length) return json({ error: 'Invite not found.' }, 404)
    const inv = invRows[0]
    if (inv.consumed_at) return json({ error: 'This invite has already been used.' }, 410)
    if (inv.expires_at && new Date(inv.expires_at) < new Date()) return json({ error: 'This invite has expired.' }, 410)

    // Mark consumed
    await fetch(`${base}/invites?token=eq.${encodeURIComponent(token)}`, {
      method: 'PATCH',
      headers: svcH,
      body: JSON.stringify({ consumed_at: new Date().toISOString(), consumed_by: user.id }),
    })

    // Seed user_roles with the pre-assigned role (don't overwrite if already has a higher role)
    const existingRoleRes = await fetch(`${base}/user_roles?user_id=eq.${user.id}&select=role&limit=1`, { headers: svcH })
    const existingRoles = existingRoleRes.ok ? await existingRoleRes.json() : []
    const ROLE_RANK = { viewer: 0, editor: 1, contributor: 2, admin: 3, owner: 4 }
    const existingRank = ROLE_RANK[existingRoles[0]?.role] ?? -1
    const inviteRank   = ROLE_RANK[inv.role] ?? 0

    if (existingRoles.length === 0) {
      await fetch(`${base}/user_roles`, {
        method: 'POST',
        headers: { ...svcH, Prefer: 'return=minimal' },
        body: JSON.stringify({ user_id: user.id, role: inv.role || 'viewer' }),
      }).catch(() => {})
    } else if (inviteRank > existingRank) {
      await fetch(`${base}/user_roles?user_id=eq.${user.id}`, {
        method: 'PATCH',
        headers: svcH,
        body: JSON.stringify({ role: inv.role }),
      }).catch(() => {})
    }

    // Audit log
    await fetch(`${base}/audit_log`, {
      method: 'POST',
      headers: svcH,
      body: JSON.stringify({
        actor_user_id: user.id,
        action: 'invite.consume',
        target_type: 'invite',
        target_id: token,
        payload: { email: inv.email, role: inv.role },
      }),
    }).catch(() => {})

    return json({ ok: true, role: inv.role })
  }

  return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS })
}
