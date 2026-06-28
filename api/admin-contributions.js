// GET    /api/admin-contributions?courseKey=<key>&status=pending|all
//   → list course_hole_contrib rows with optional course filter
// PATCH  /api/admin-contributions { courseKey, holeRef, action: 'approve'|'reject' }
//   approve: upserts the contribution into course_geo (tee+pin as a LineString)
//   reject:  deletes the contrib row
// Admin-gated.

export const config = { runtime: 'edge' }

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  process.env.ALLOWED_ORIGIN || '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
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

async function writeAudit(supabaseUrl, svcKey, actorId, action, targetId, payload) {
  await fetch(`${supabaseUrl}/rest/v1/audit_log`, {
    method: 'POST',
    headers: { apikey: svcKey, Authorization: `Bearer ${svcKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ actor_user_id: actorId, action, target_type: 'contribution', target_id: targetId, payload }),
  }).catch(() => {})
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS })

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

  const svcH = { apikey: svcKey, Authorization: `Bearer ${svcKey}`, 'Content-Type': 'application/json' }
  const base  = `${supabaseUrl}/rest/v1`

  // ── GET: list contributions ──────────────────────────────────────────────
  if (req.method === 'GET') {
    const url       = new URL(req.url)
    const courseKey = url.searchParams.get('courseKey')
    let endpoint    = `${base}/course_hole_contrib?select=course_key,hole_ref,tee_lng,tee_lat,pin_lng,pin_lat,source,contributor,updated_at&order=updated_at.desc&limit=500`
    if (courseKey) endpoint += `&course_key=eq.${encodeURIComponent(courseKey)}`

    const res = await fetch(endpoint, { headers: svcH })
    if (!res.ok) return json({ error: `Supabase error: ${await res.text()}` }, 500)
    return json(await res.json())
  }

  // ── PATCH: approve or reject ─────────────────────────────────────────────
  if (req.method === 'PATCH') {
    let body
    try { body = await req.json() } catch { return json({ error: 'Invalid JSON.' }, 400) }
    const { courseKey, holeRef, action } = body
    if (!courseKey || !holeRef || !action) return json({ error: 'courseKey, holeRef, action required.' }, 400)

    const targetId = `${courseKey}|${holeRef}`

    if (action === 'reject') {
      await fetch(`${base}/course_hole_contrib?course_key=eq.${encodeURIComponent(courseKey)}&hole_ref=eq.${holeRef}`,
        { method: 'DELETE', headers: svcH })
      await writeAudit(supabaseUrl, svcKey, requester.id, 'contribution.reject', targetId, { courseKey, holeRef })
      return json({ ok: true })
    }

    if (action === 'approve') {
      // Read the contrib row to get coordinates
      const contribRes = await fetch(
        `${base}/course_hole_contrib?course_key=eq.${encodeURIComponent(courseKey)}&hole_ref=eq.${holeRef}&select=*&limit=1`,
        { headers: svcH }
      )
      if (!contribRes.ok) return json({ error: 'Contribution not found.' }, 404)
      const rows = await contribRes.json()
      if (!rows.length) return json({ error: 'Contribution not found.' }, 404)
      const c = rows[0]

      // Build a GeoJSON LineString from tee → pin
      const holeGeo = {
        type: 'Feature',
        properties: { holeRef: c.hole_ref, source: 'admin_approved' },
        geometry: {
          type: 'LineString',
          coordinates: [
            [c.tee_lng, c.tee_lat],
            [c.pin_lng, c.pin_lat],
          ],
        },
      }

      // Read existing course_geo row and merge
      const geoRes = await fetch(`${base}/course_geo?course_key=eq.${encodeURIComponent(courseKey)}&select=geojson&limit=1`, { headers: svcH })
      const geoRows = geoRes.ok ? await geoRes.json() : []
      let existing = geoRows[0]?.geojson || { type: 'FeatureCollection', features: [] }

      // Replace existing feature for this hole (if any), then append
      existing.features = existing.features.filter(f => f.properties?.holeRef !== c.hole_ref)
      existing.features.push(holeGeo)

      // Upsert course_geo
      const upsertRes = await fetch(`${base}/course_geo`, {
        method: 'POST',
        headers: { ...svcH, Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({ course_key: courseKey, geojson: existing, updated_at: new Date().toISOString() }),
      })
      if (!upsertRes.ok) return json({ error: `Failed to write course_geo: ${await upsertRes.text()}` }, 500)

      // Delete the contrib row (it's now in course_geo)
      await fetch(`${base}/course_hole_contrib?course_key=eq.${encodeURIComponent(courseKey)}&hole_ref=eq.${holeRef}`,
        { method: 'DELETE', headers: svcH })

      await writeAudit(supabaseUrl, svcKey, requester.id, 'contribution.approve', targetId, { courseKey, holeRef })
      return json({ ok: true })
    }

    return json({ error: `Unknown action: ${action}` }, 400)
  }

  return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS })
}
