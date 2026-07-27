// Org membership management. Caller must be an org admin or owner.
//
//   GET    ?orgId=X              → list members with email + role
//   POST   { orgId, email, role }→ add member by email (must already have an account)
//   PATCH  { orgId, userId, role }→ change member role (cannot change owner's role)
//   DELETE { orgId, userId }     → remove member (cannot remove owner)

export const config = { runtime: 'edge' }

const CORS = {
  'Access-Control-Allow-Origin':  process.env.ALLOWED_ORIGIN || '',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const supabaseUrl = process.env.SUPABASE_URL
  const svcKey      = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !svcKey) return json({ error: 'Server not configured.' }, 500)

  const token = (req.headers.get('Authorization') || '').replace('Bearer ', '')
  if (!token) return json({ error: 'Unauthorized' }, 401)

  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: svcKey },
  })
  if (!userRes.ok) return json({ error: 'Invalid or expired session.' }, 401)
  const caller = await userRes.json()

  const svcH = { apikey: svcKey, Authorization: `Bearer ${svcKey}`, 'Content-Type': 'application/json' }
  const base  = `${supabaseUrl}/rest/v1`

  async function callerRoleInOrg(orgId) {
    const res = await fetch(`${base}/org_members?org_id=eq.${orgId}&user_id=eq.${caller.id}&select=role&limit=1`, { headers: svcH })
    const rows = res.ok ? await res.json() : []
    return rows[0]?.role || null
  }

  // ── GET: list members ────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const orgId = new URL(req.url).searchParams.get('orgId')
    if (!orgId) return json({ error: 'orgId is required.' }, 400)

    const role = await callerRoleInOrg(orgId)
    if (!role) return json({ error: 'Not a member of this org.' }, 403)

    const membersRes = await fetch(
      `${base}/org_members?org_id=eq.${orgId}&select=user_id,role,joined_at&order=joined_at.asc`,
      { headers: svcH }
    )
    const members = membersRes.ok ? await membersRes.json() : []

    // Fetch emails for all members
    const authListRes = await fetch(`${supabaseUrl}/auth/v1/admin/users?per_page=500`, { headers: svcH })
    const authList    = authListRes.ok ? (await authListRes.json()).users || [] : []
    const emailById   = new Map(authList.map(u => [u.id, u.email]))

    return json(members.map(m => ({
      userId: m.user_id,
      role:   m.role,
      joinedAt: m.joined_at,
      email: emailById.get(m.user_id) || null,
    })))
  }

  // ── POST: add member by email ────────────────────────────────────────────────
  if (req.method === 'POST') {
    let body
    try { body = await req.json() } catch { return json({ error: 'Invalid JSON.' }, 400) }
    const { orgId, email, role = 'viewer' } = body
    if (!orgId || !email) return json({ error: 'orgId and email are required.' }, 400)
    if (!['viewer','editor','admin'].includes(role)) return json({ error: 'role must be viewer, editor, or admin.' }, 400)

    const callerRole = await callerRoleInOrg(orgId)
    if (!callerRole || !['admin','owner'].includes(callerRole)) return json({ error: 'Admin or owner access required.' }, 403)

    // Look up the target user by email
    const authListRes = await fetch(`${supabaseUrl}/auth/v1/admin/users?per_page=500`, { headers: svcH })
    const authList    = authListRes.ok ? (await authListRes.json()).users || [] : []
    const target      = authList.find(u => u.email?.toLowerCase() === email.toLowerCase())
    if (!target) return json({ error: `No account found for ${email}. They must sign up first.` }, 404)

    // Check not already a member
    const existRes = await fetch(`${base}/org_members?org_id=eq.${orgId}&user_id=eq.${target.id}&select=role&limit=1`, { headers: svcH })
    const existing = existRes.ok ? await existRes.json() : []
    if (existing.length) return json({ error: `${email} is already a member.` }, 409)

    const insertRes = await fetch(`${base}/org_members`, {
      method: 'POST',
      headers: { ...svcH, Prefer: 'return=representation' },
      body: JSON.stringify({ org_id: orgId, user_id: target.id, role, invited_by: caller.id }),
    })
    if (!insertRes.ok) return json({ error: `Failed to add member: ${await insertRes.text()}` }, 500)

    return json({ ok: true, userId: target.id, email, role }, 201)
  }

  // ── PATCH: change member role ────────────────────────────────────────────────
  if (req.method === 'PATCH') {
    let body
    try { body = await req.json() } catch { return json({ error: 'Invalid JSON.' }, 400) }
    const { orgId, userId, role } = body
    if (!orgId || !userId || !role) return json({ error: 'orgId, userId, and role are required.' }, 400)
    if (!['viewer','editor','admin'].includes(role)) return json({ error: 'role must be viewer, editor, or admin.' }, 400)

    const callerRole = await callerRoleInOrg(orgId)
    if (!callerRole || !['admin','owner'].includes(callerRole)) return json({ error: 'Admin or owner access required.' }, 403)

    // Cannot change org owner's role via this endpoint (use transfer-ownership)
    const orgRes  = await fetch(`${base}/orgs?id=eq.${orgId}&select=owner_id&limit=1`, { headers: svcH })
    const orgRows = orgRes.ok ? await orgRes.json() : []
    if (orgRows[0]?.owner_id === userId) return json({ error: "Cannot change the owner's role. Transfer ownership first." }, 409)

    const patchRes = await fetch(`${base}/org_members?org_id=eq.${orgId}&user_id=eq.${userId}`, {
      method: 'PATCH',
      headers: svcH,
      body: JSON.stringify({ role }),
    })
    if (!patchRes.ok) return json({ error: `Role update failed: ${await patchRes.text()}` }, 500)
    return json({ ok: true })
  }

  // ── DELETE: remove member ────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    let body
    try { body = await req.json() } catch { return json({ error: 'Invalid JSON.' }, 400) }
    const { orgId, userId } = body
    if (!orgId || !userId) return json({ error: 'orgId and userId are required.' }, 400)

    const callerRole = await callerRoleInOrg(orgId)
    const isSelf     = caller.id === userId

    // Members can remove themselves; admins/owners can remove others
    if (!isSelf && (!callerRole || !['admin','owner'].includes(callerRole))) {
      return json({ error: 'Admin or owner access required to remove other members.' }, 403)
    }

    // Cannot remove the owner
    const orgRes  = await fetch(`${base}/orgs?id=eq.${orgId}&select=owner_id&limit=1`, { headers: svcH })
    const orgRows = orgRes.ok ? await orgRes.json() : []
    if (orgRows[0]?.owner_id === userId) return json({ error: 'Cannot remove the owner. Transfer ownership first.' }, 409)

    await fetch(`${base}/org_members?org_id=eq.${orgId}&user_id=eq.${userId}`, { method: 'DELETE', headers: svcH })
    return json({ ok: true })
  }

  return new Response('Method not allowed', { status: 405, headers: CORS })
}
