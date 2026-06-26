// Vercel Edge Function — admin-only audit log reader.
//
//   GET /api/admin-audit?action=invite.create&limit=100 → audit_log rows
//
// Rows include resolved actor emails so the client can render without a
// second round-trip. Read-only (every audit_log write happens from within
// another admin endpoint).
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
  const action      = url.searchParams.get('action')      // e.g. 'invite.create'
  const targetType  = url.searchParams.get('target_type') // e.g. 'invite' | 'user'
  const limit       = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '100', 10), 1), 500)

  const filters = [`select=*`, `order=created_at.desc`, `limit=${limit}`]
  if (action)     filters.push(`action=eq.${encodeURIComponent(action)}`)
  if (targetType) filters.push(`target_type=eq.${encodeURIComponent(targetType)}`)

  const svcHeaders = { apikey: svcKey, Authorization: `Bearer ${svcKey}` }
  const listRes = await fetch(`${supabaseUrl}/rest/v1/audit_log?${filters.join('&')}`, { headers: svcHeaders })
  if (!listRes.ok) return jsonResponse({ error: `audit_log read failed: ${await listRes.text()}` }, 500)
  const rows = await listRes.json()

  // Resolve actor emails so the table can render without a second round-trip.
  const actorIds = [...new Set(rows.map(r => r.actor_user_id).filter(Boolean))]
  let emailById = new Map()
  if (actorIds.length > 0) {
    const usersRes = await fetch(`${supabaseUrl}/auth/v1/admin/users?per_page=500`, { headers: { ...svcHeaders, 'Content-Type': 'application/json' } })
    if (usersRes.ok) {
      const { users } = await usersRes.json()
      emailById = new Map((users || []).map(u => [u.id, u.email]))
    }
  }

  return jsonResponse(rows.map(r => ({
    ...r,
    actor_email: r.actor_user_id ? emailById.get(r.actor_user_id) || null : null,
  })))
}
