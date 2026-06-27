// Bulk PDF reparse queue.
//
// GET    /api/admin-reparse-queue              → list all queue items
// POST   /api/admin-reparse-queue              → enqueue { courseKey, pdfUrl, courseName, location }
// PATCH  /api/admin-reparse-queue              → { id, action: 'run'|'approve'|'reject' }
//   run:     calls /api/admin-course to re-parse the PDF, stores the diff
//   approve: patches the diff result into course_cache, marks done
//   reject:  marks item as rejected without updating course_cache
// DELETE /api/admin-reparse-queue { id }       → remove item from queue
//
// Backed by course_reparse_queue table (see schema). Admin-gated.

export const config = { runtime: 'edge' }

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  process.env.ALLOWED_ORIGIN || '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
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

  // ── GET: list queue items ────────────────────────────────────────────────
  if (req.method === 'GET') {
    const res = await fetch(
      `${base}/course_reparse_queue?select=*&order=submitted_at.desc&limit=100`,
      { headers: svcH }
    )
    if (!res.ok) return json({ error: `Supabase error: ${await res.text()}` }, 500)
    return json(await res.json())
  }

  // ── POST: enqueue a PDF ──────────────────────────────────────────────────
  if (req.method === 'POST') {
    let body
    try { body = await req.json() } catch { return json({ error: 'Invalid JSON.' }, 400) }
    const { courseKey, pdfUrl, courseName, location } = body
    if (!courseKey || !pdfUrl) return json({ error: 'courseKey and pdfUrl required.' }, 400)

    const insertRes = await fetch(`${base}/course_reparse_queue`, {
      method: 'POST',
      headers: { ...svcH, Prefer: 'return=representation' },
      body: JSON.stringify({
        course_key:   courseKey,
        pdf_url:      pdfUrl,
        course_name:  courseName || courseKey,
        location:     location   || '',
        status:       'pending',
        submitted_by: requester.id,
      }),
    })
    if (!insertRes.ok) return json({ error: `Enqueue failed: ${await insertRes.text()}` }, 500)
    const rows = await insertRes.json()
    return json(Array.isArray(rows) ? rows[0] : rows, 201)
  }

  // ── PATCH: run / approve / reject ────────────────────────────────────────
  if (req.method === 'PATCH') {
    let body
    try { body = await req.json() } catch { return json({ error: 'Invalid JSON.' }, 400) }
    const { id, action } = body
    if (!id || !action) return json({ error: 'id and action required.' }, 400)

    // Fetch the queue item
    const itemRes = await fetch(`${base}/course_reparse_queue?id=eq.${id}&select=*&limit=1`, { headers: svcH })
    if (!itemRes.ok) return json({ error: 'Queue item not found.' }, 404)
    const items = await itemRes.json()
    if (!items.length) return json({ error: 'Queue item not found.' }, 404)
    const item = items[0]

    const patch = (updates) => fetch(`${base}/course_reparse_queue?id=eq.${id}`, {
      method: 'PATCH',
      headers: { ...svcH, Prefer: 'return=representation' },
      body: JSON.stringify(updates),
    })

    if (action === 'run') {
      // Mark as running
      await patch({ status: 'running', started_at: new Date().toISOString() })

      // Call the existing admin-course PDF parse endpoint
      try {
        const parseRes = await fetch(`${new URL(req.url).origin}/api/admin-course`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'parsePdf',
            courseName: item.course_name,
            location:   item.location,
            pdfUrl:     item.pdf_url,
          }),
        })
        if (!parseRes.ok) {
          const err = await parseRes.text()
          await patch({ status: 'error', error_msg: err.slice(0, 500), finished_at: new Date().toISOString() })
          return json({ error: `Parse failed: ${err}` }, 500)
        }
        const result = await parseRes.json()
        await patch({
          status:      'pending_approval',
          result_data: result,
          finished_at: new Date().toISOString(),
        })
        return json({ ok: true, result })
      } catch (e) {
        await patch({ status: 'error', error_msg: e.message, finished_at: new Date().toISOString() })
        return json({ error: e.message }, 500)
      }
    }

    if (action === 'approve') {
      if (!item.result_data) return json({ error: 'No result to approve — run the parse first.' }, 400)
      // The result_data is the updated course_data from parsePdf; write it to course_cache
      const cacheRes = await fetch(`${base}/course_cache?cache_key=eq.${encodeURIComponent(item.course_key)}`, {
        method: 'PATCH',
        headers: svcH,
        body: JSON.stringify({ course_data: item.result_data, source: 'yardage_book' }),
      })
      if (!cacheRes.ok) return json({ error: `Cache update failed: ${await cacheRes.text()}` }, 500)
      await patch({ status: 'approved', approved_by: requester.id, approved_at: new Date().toISOString() })
      return json({ ok: true })
    }

    if (action === 'reject') {
      await patch({ status: 'rejected', approved_by: requester.id, approved_at: new Date().toISOString() })
      return json({ ok: true })
    }

    return json({ error: `Unknown action: ${action}` }, 400)
  }

  // ── DELETE: remove from queue ────────────────────────────────────────────
  if (req.method === 'DELETE') {
    let body
    try { body = await req.json() } catch { return json({ error: 'Invalid JSON.' }, 400) }
    const { id } = body
    if (!id) return json({ error: 'id required.' }, 400)
    await fetch(`${base}/course_reparse_queue?id=eq.${id}`, { method: 'DELETE', headers: svcH })
    return json({ ok: true })
  }

  return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS })
}
