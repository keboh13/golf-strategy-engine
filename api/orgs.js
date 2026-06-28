// Org CRUD — authenticated users only (no admin gate; anyone can own an org).
//
//   GET    /api/orgs              → list orgs the caller belongs to (owned + member)
//   POST   /api/orgs  { name }    → create org (caller becomes owner + first org_member)
//   PATCH  /api/orgs  { orgId, name?, plan? }  → update (owner only)
//   DELETE /api/orgs  { orgId }   → delete (owner only; cascades members + private courses)

export const config = { runtime: 'edge' }

const CORS = {
  'Access-Control-Allow-Origin':  process.env.ALLOWED_ORIGIN || '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)
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

  // ── GET: list orgs the caller belongs to ────────────────────────────────────
  if (req.method === 'GET') {
    // Orgs the caller owns
    const [ownedRes, memberRes] = await Promise.all([
      fetch(`${base}/orgs?owner_id=eq.${caller.id}&select=id,name,slug,plan,created_at&order=created_at.asc`, { headers: svcH }),
      fetch(`${base}/org_members?user_id=eq.${caller.id}&select=role,joined_at,org:org_id(id,name,slug,plan,created_at)`, { headers: svcH }),
    ])

    const owned  = ownedRes.ok  ? await ownedRes.json()  : []
    const member = memberRes.ok ? await memberRes.json() : []

    // Merge + annotate; dedupe by id
    const map = new Map()
    for (const o of owned)  map.set(o.id, { ...o, myRole: 'owner' })
    for (const m of member) {
      const o = m.org
      if (!o) continue
      if (!map.has(o.id)) map.set(o.id, { ...o, myRole: m.role })
    }

    // Enrich each org with member count
    const orgs = [...map.values()]
    const counts = await Promise.all(orgs.map(o =>
      fetch(`${base}/org_members?org_id=eq.${o.id}&select=user_id`, { headers: svcH })
        .then(r => r.ok ? r.json() : [])
        .then(rows => ({ id: o.id, count: rows.length }))
    ))
    const countById = Object.fromEntries(counts.map(c => [c.id, c.count]))

    return json(orgs.map(o => ({ ...o, memberCount: countById[o.id] ?? 1 })))
  }

  // ── POST: create org ─────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    let body
    try { body = await req.json() } catch { return json({ error: 'Invalid JSON.' }, 400) }
    const { name } = body
    if (!name?.trim()) return json({ error: 'name is required.' }, 400)

    const slug = slugify(name.trim())
    if (!slug) return json({ error: 'Name must contain at least one alphanumeric character.' }, 400)

    // Ensure slug is unique (append random suffix if taken)
    const existsRes = await fetch(`${base}/orgs?slug=eq.${slug}&select=id&limit=1`, { headers: svcH })
    const existing  = existsRes.ok ? await existsRes.json() : []
    const finalSlug = existing.length
      ? `${slug}-${Math.random().toString(36).slice(2, 6)}`
      : slug

    const orgRes = await fetch(`${base}/orgs`, {
      method: 'POST',
      headers: { ...svcH, Prefer: 'return=representation' },
      body: JSON.stringify({ name: name.trim(), slug: finalSlug, owner_id: caller.id }),
    })
    if (!orgRes.ok) return json({ error: `Failed to create org: ${await orgRes.text()}` }, 500)
    const org = (await orgRes.json())[0]

    // Auto-add owner as first member
    await fetch(`${base}/org_members`, {
      method: 'POST',
      headers: { ...svcH, Prefer: 'return=minimal' },
      body: JSON.stringify({ org_id: org.id, user_id: caller.id, role: 'owner' }),
    })

    return json({ ...org, myRole: 'owner', memberCount: 1 }, 201)
  }

  // ── PATCH: update org (owner only) ──────────────────────────────────────────
  if (req.method === 'PATCH') {
    let body
    try { body = await req.json() } catch { return json({ error: 'Invalid JSON.' }, 400) }
    const { orgId, name, plan } = body
    if (!orgId) return json({ error: 'orgId is required.' }, 400)

    const orgRes = await fetch(`${base}/orgs?id=eq.${orgId}&select=owner_id&limit=1`, { headers: svcH })
    const orgs   = orgRes.ok ? await orgRes.json() : []
    if (!orgs.length) return json({ error: 'Org not found.' }, 404)
    if (orgs[0].owner_id !== caller.id) return json({ error: 'Only the owner can update org settings.' }, 403)

    const patch = {}
    if (name?.trim()) patch.name = name.trim()
    if (plan && ['free','pro','team'].includes(plan)) patch.plan = plan

    if (!Object.keys(patch).length) return json({ error: 'Nothing to update.' }, 400)

    const patchRes = await fetch(`${base}/orgs?id=eq.${orgId}`, {
      method: 'PATCH',
      headers: { ...svcH, Prefer: 'return=representation' },
      body: JSON.stringify(patch),
    })
    if (!patchRes.ok) return json({ error: `Update failed: ${await patchRes.text()}` }, 500)
    const updated = await patchRes.json()
    return json(updated[0] ?? { ok: true })
  }

  // ── DELETE: delete org (owner only) ─────────────────────────────────────────
  if (req.method === 'DELETE') {
    let body
    try { body = await req.json() } catch { return json({ error: 'Invalid JSON.' }, 400) }
    const { orgId } = body
    if (!orgId) return json({ error: 'orgId is required.' }, 400)

    const orgRes = await fetch(`${base}/orgs?id=eq.${orgId}&select=owner_id&limit=1`, { headers: svcH })
    const orgs   = orgRes.ok ? await orgRes.json() : []
    if (!orgs.length) return json({ error: 'Org not found.' }, 404)
    if (orgs[0].owner_id !== caller.id) return json({ error: 'Only the owner can delete an org.' }, 403)

    await fetch(`${base}/orgs?id=eq.${orgId}`, { method: 'DELETE', headers: svcH })
    return json({ ok: true })
  }

  return new Response('Method not allowed', { status: 405, headers: CORS })
}
