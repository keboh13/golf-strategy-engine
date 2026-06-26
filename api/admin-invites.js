// Vercel Edge Function — admin-only invite management.
//
//   GET    /api/admin-invites              → list every invite (active first)
//   POST   /api/admin-invites { email,     → issue a new invite, returns the
//                               role,       signup URL the admin should hand
//                               profileName, off
//                               ttlDays }
//   DELETE /api/admin-invites { token }    → revoke an unconsumed invite
//
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, optional
// PUBLIC_APP_URL (used to mint the signup link; falls back to the request
// Origin header).
//
// Every mutation also writes a row to audit_log so the future Audit sub-tab
// can replay who invited whom.

export const config = { runtime: 'edge' }

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  process.env.ALLOWED_ORIGIN || '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
}

const ALLOWED_ROLES = new Set(['viewer', 'editor', 'admin', 'owner'])

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

async function isAdmin(supabaseUrl, svcKey, userId) {
  // Honour either the legacy `admins` table or the new `user_roles.role in
  // ('admin','owner')` (the user_roles migration seeds both for back-compat).
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

async function writeAudit(supabaseUrl, svcKey, row) {
  // Fire-and-forget — audit failures must never break the primary action.
  try {
    await fetch(`${supabaseUrl}/rest/v1/audit_log`, {
      method: 'POST',
      headers: { apikey: svcKey, Authorization: `Bearer ${svcKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(row),
    })
  } catch (e) {
    console.warn('[audit_log] write failed:', e?.message)
  }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS })

  const supabaseUrl = process.env.SUPABASE_URL
  const svcKey      = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !svcKey) return jsonResponse({ error: 'Server not configured.' }, 500)

  const token = (req.headers.get('Authorization') || '').replace('Bearer ', '')
  if (!token) return jsonResponse({ error: 'Unauthorized' }, 401)

  // Validate the caller's session.
  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: svcKey },
  })
  if (!userRes.ok) return jsonResponse({ error: 'Invalid or expired session.' }, 401)
  const requester = await userRes.json()

  if (!(await isAdmin(supabaseUrl, svcKey, requester.id))) {
    return jsonResponse({ error: 'Forbidden — admin access only.' }, 403)
  }

  const svcHeaders = {
    apikey: svcKey,
    Authorization: `Bearer ${svcKey}`,
    'Content-Type': 'application/json',
  }

  // ── GET: list every invite ────────────────────────────────────────────────
  if (req.method === 'GET') {
    const listRes = await fetch(
      `${supabaseUrl}/rest/v1/invites?select=*&order=created_at.desc&limit=200`,
      { headers: svcHeaders },
    )
    if (!listRes.ok) return jsonResponse({ error: `Supabase error: ${await listRes.text()}` }, 500)
    return jsonResponse(await listRes.json())
  }

  // ── POST: issue a new invite ──────────────────────────────────────────────
  if (req.method === 'POST') {
    let body
    try { body = await req.json() } catch { return jsonResponse({ error: 'Invalid JSON body.' }, 400) }
    const email = (body.email || '').trim().toLowerCase()
    const role  = (body.role  || 'viewer').toLowerCase()
    const profileName = body.profileName ? String(body.profileName).trim() : null
    const ttlDays = Math.min(Math.max(parseInt(body.ttlDays) || 14, 1), 90)
    if (!email || !email.includes('@')) return jsonResponse({ error: 'A valid email is required.' }, 400)
    if (!ALLOWED_ROLES.has(role)) return jsonResponse({ error: `Invalid role: ${role}` }, 400)
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString()

    const insertRes = await fetch(`${supabaseUrl}/rest/v1/invites`, {
      method: 'POST',
      headers: { ...svcHeaders, Prefer: 'return=representation' },
      body: JSON.stringify({
        email,
        role,
        profile_name: profileName,
        created_by: requester.id,
        expires_at: expiresAt,
      }),
    })
    if (!insertRes.ok) {
      return jsonResponse({ error: `Failed to create invite: ${await insertRes.text()}` }, 500)
    }
    const rows = await insertRes.json()
    const invite = Array.isArray(rows) ? rows[0] : rows
    const origin = process.env.PUBLIC_APP_URL || req.headers.get('Origin') || ''
    const signupUrl = origin ? `${origin.replace(/\/$/, '')}/?invite=${invite.token}` : null

    await writeAudit(supabaseUrl, svcKey, {
      actor_user_id: requester.id,
      action: 'invite.create',
      target_type: 'invite',
      target_id: invite.token,
      payload: { email, role, profile_name: profileName, expires_at: expiresAt },
    })

    return jsonResponse({ ...invite, signupUrl })
  }

  // ── DELETE: revoke an unconsumed invite ───────────────────────────────────
  if (req.method === 'DELETE') {
    let body
    try { body = await req.json() } catch { return jsonResponse({ error: 'Invalid JSON body.' }, 400) }
    const inviteToken = body.token
    if (!inviteToken) return jsonResponse({ error: 'token is required.' }, 400)

    // Refuse to revoke a consumed invite — the row is the audit trail.
    const checkRes = await fetch(
      `${supabaseUrl}/rest/v1/invites?token=eq.${inviteToken}&select=token,email,role,consumed_at&limit=1`,
      { headers: svcHeaders },
    )
    const rows = checkRes.ok ? await checkRes.json() : []
    const existing = rows[0]
    if (!existing) return jsonResponse({ error: 'Invite not found.' }, 404)
    if (existing.consumed_at) return jsonResponse({ error: 'Cannot revoke a consumed invite.' }, 409)

    const delRes = await fetch(
      `${supabaseUrl}/rest/v1/invites?token=eq.${inviteToken}`,
      { method: 'DELETE', headers: svcHeaders },
    )
    if (!delRes.ok) return jsonResponse({ error: `Failed to revoke: ${await delRes.text()}` }, 500)

    await writeAudit(supabaseUrl, svcKey, {
      actor_user_id: requester.id,
      action: 'invite.revoke',
      target_type: 'invite',
      target_id: inviteToken,
      payload: { email: existing.email, role: existing.role },
    })

    return jsonResponse({ ok: true })
  }

  return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS })
}
