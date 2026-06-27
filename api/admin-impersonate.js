// POST /api/admin-impersonate { targetUserId }
// Generates a Supabase magic-link for the target user so an admin can open
// it in an incognito tab and act as that user. Writes an audit_log row.
// The link is valid for 1 hour and single-use (Supabase OTP semantics).
// Admin-gated; the requesting admin must not be the same as the target.

export const config = { runtime: 'edge' }

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  process.env.ALLOWED_ORIGIN || '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

async function isAdmin(supabaseUrl, svcKey, userId) {
  const [a, r] = await Promise.all([
    fetch(`${supabaseUrl}/rest/v1/admins?user_id=eq.${userId}&select=user_id&limit=1`,
      { headers: { apikey: svcKey, Authorization: `Bearer ${svcKey}` } }),
    fetch(`${supabaseUrl}/rest/v1/user_roles?user_id=eq.${userId}&role=in.(admin,owner)&select=user_id&limit=1`,
      { headers: { apikey: svcKey, Authorization: `Bearer ${svcKey}` } }),
  ])
  const ra = a.ok ? await a.json() : []
  const rr = r.ok ? await r.json() : []
  return (Array.isArray(ra) && ra.length > 0) || (Array.isArray(rr) && rr.length > 0)
}

async function writeAuditLog(supabaseUrl, svcKey, actorId, action, targetType, targetId, payload) {
  await fetch(`${supabaseUrl}/rest/v1/audit_log`, {
    method: 'POST',
    headers: { apikey: svcKey, Authorization: `Bearer ${svcKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ actor_user_id: actorId, action, target_type: targetType, target_id: targetId, payload }),
  }).catch(() => {})
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS })

  const supabaseUrl = process.env.SUPABASE_URL
  const svcKey      = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !svcKey) return json({ error: 'Server not configured.' }, 500)

  const token = (req.headers.get('Authorization') || '').replace('Bearer ', '')
  if (!token) return json({ error: 'Unauthorized' }, 401)

  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: svcKey },
  })
  if (!userRes.ok) return json({ error: 'Invalid or expired session.' }, 401)
  const requester = await userRes.json()
  if (!(await isAdmin(supabaseUrl, svcKey, requester.id))) return json({ error: 'Forbidden — admin access only.' }, 403)

  let body
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON.' }, 400) }
  const { targetUserId } = body
  if (!targetUserId) return json({ error: 'targetUserId required.' }, 400)
  if (targetUserId === requester.id) return json({ error: 'Cannot impersonate yourself.' }, 400)

  // Look up the target user's email (needed for generateLink)
  const targetRes = await fetch(`${supabaseUrl}/auth/v1/admin/users/${targetUserId}`, {
    headers: { apikey: svcKey, Authorization: `Bearer ${svcKey}`, 'Content-Type': 'application/json' },
  })
  if (!targetRes.ok) return json({ error: 'Target user not found.' }, 404)
  const targetUser = await targetRes.json()

  // Generate a magic link for the target user
  const linkRes = await fetch(`${supabaseUrl}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: { apikey: svcKey, Authorization: `Bearer ${svcKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email: targetUser.email }),
  })
  if (!linkRes.ok) {
    const err = await linkRes.text()
    return json({ error: `Failed to generate impersonate link: ${err}` }, 500)
  }
  const linkData = await linkRes.json()
  // Supabase returns action_link at the top level
  const actionLink = linkData.action_link || linkData.properties?.action_link
  if (!actionLink) return json({ error: 'No action_link in Supabase response.' }, 500)

  // Audit log — always write before returning the link
  await writeAuditLog(supabaseUrl, svcKey, requester.id, 'impersonate.start', 'user', targetUserId, {
    target_email: targetUser.email,
    actor_email:  requester.email,
  })

  return json({ actionLink, targetEmail: targetUser.email })
}
