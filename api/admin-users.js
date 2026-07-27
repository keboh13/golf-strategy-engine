// Vercel Edge Function — admin-only user management.
// GET    /api/admin-users              → list all users with usage stats
// POST   /api/admin-users { grantId } → grant admin to a user by ID
// PATCH  /api/admin-users { userId, action: 'soft_delete'|'restore' } → soft delete / restore
// DELETE /api/admin-users { userId }  → permanently delete a user and their data
//
// Soft delete adds a row to user_soft_deletes. Hard delete is permanent and
// requires no active soft-delete entry (to prevent accidental cascade).
// All mutations write to audit_log.
//
// Required Vercel env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

export const config = { runtime: 'edge' }

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  process.env.ALLOWED_ORIGIN || '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
}

import { validateAuth, isAdminUser } from './_lib/admin.js'

async function writeAudit(supabaseUrl, svcKey, actorId, action, targetType, targetId, payload) {
  await fetch(`${supabaseUrl}/rest/v1/audit_log`, {
    method: 'POST',
    headers: { apikey: svcKey, Authorization: `Bearer ${svcKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ actor_user_id: actorId, action, target_type: targetType, target_id: targetId, payload }),
  }).catch(() => {})
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

  // Auth — validate via shared admin helper
  const requesterId = await validateAuth(req)
  if (!requesterId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }
  if (!(await isAdminUser(requesterId))) {
    return new Response(JSON.stringify({ error: 'Forbidden — admin access only.' }), {
      status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }
  const requester = { id: requesterId }

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

    // Pull usage stats from api_usage table (counts + token sums)
    const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const [todayRes, totalRes, adminsRes, softDelRes] = await Promise.all([
      fetch(`${supabaseUrl}/rest/v1/api_usage?used_at=gte.${encodeURIComponent(windowStart)}&select=user_id,input_tokens,output_tokens`, { headers: svcHeaders }),
      fetch(`${supabaseUrl}/rest/v1/api_usage?select=user_id,input_tokens,output_tokens`, { headers: svcHeaders }),
      fetch(`${supabaseUrl}/rest/v1/admins?select=user_id`, { headers: svcHeaders }),
      fetch(`${supabaseUrl}/rest/v1/user_soft_deletes?select=user_id,deleted_at,restore_before`, { headers: svcHeaders }),
    ])

    let todayByUser  = {}
    let totalByUser  = {}
    let tokensTodayByUser = {}
    let tokensTotalByUser = {}

    if (todayRes.ok) {
      const todayRows = await todayRes.json()
      for (const r of todayRows) {
        todayByUser[r.user_id] = (todayByUser[r.user_id] || 0) + 1
        const t = (r.input_tokens || 0) + (r.output_tokens || 0)
        tokensTodayByUser[r.user_id] = (tokensTodayByUser[r.user_id] || 0) + t
      }
    }
    if (totalRes.ok) {
      const totalRows = await totalRes.json()
      for (const r of totalRows) {
        totalByUser[r.user_id] = (totalByUser[r.user_id] || 0) + 1
        const t = (r.input_tokens || 0) + (r.output_tokens || 0)
        tokensTotalByUser[r.user_id] = (tokensTotalByUser[r.user_id] || 0) + t
      }
    }

    const adminRows   = adminsRes.ok   ? await adminsRes.json()   : []
    const softDelRows = softDelRes.ok  ? await softDelRes.json()  : []
    const adminIds    = new Set((adminRows   || []).map(r => r.user_id))
    const softDelMap  = Object.fromEntries((softDelRows || []).map(r => [r.user_id, r]))

    const enriched = (users || []).map(u => ({
      id:              u.id,
      email:           u.email,
      created_at:      u.created_at,
      last_sign_in_at: u.last_sign_in_at,
      usage_today:     todayByUser[u.id]       || 0,
      usage_total:     totalByUser[u.id]       || 0,
      tokens_today:    tokensTodayByUser[u.id] || 0,
      tokens_total:    tokensTotalByUser[u.id] || 0,
      isAdmin:         adminIds.has(u.id),
      softDeleted:     softDelMap[u.id] || null,
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

  // ── PATCH: soft-delete or restore a user ────────────────────────────────
  if (req.method === 'PATCH') {
    let body
    try { body = await req.json() } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body.' }), {
        status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }
    const { userId, action } = body
    if (!userId || !action) {
      return new Response(JSON.stringify({ error: 'userId and action are required.' }), {
        status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }
    if (userId === requester.id) {
      return new Response(JSON.stringify({ error: 'Cannot soft-delete or restore yourself.' }), {
        status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    const base = `${supabaseUrl}/rest/v1`

    if (action === 'soft_delete') {
      // 30-day grace period: restore_before = now + 30 days
      const restoreBefore = new Date(Date.now() + 30 * 86400000).toISOString()
      const sdRes = await fetch(`${base}/user_soft_deletes`, {
        method: 'POST',
        headers: { ...svcHeaders, Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({ user_id: userId, deleted_by: requester.id, restore_before: restoreBefore }),
      })
      if (!sdRes.ok) {
        const err = await sdRes.text()
        return new Response(JSON.stringify({ error: `Soft delete failed: ${err}` }), {
          status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
      await writeAudit(supabaseUrl, supabaseServiceKey, requester.id, 'user.soft_delete', 'user', userId, {
        restore_before: restoreBefore, actor_email: requester.email,
      })
      return new Response(JSON.stringify({ ok: true, restoreBefore }), {
        status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'restore') {
      await fetch(`${base}/user_soft_deletes?user_id=eq.${userId}`, {
        method: 'DELETE', headers: svcHeaders,
      })
      await writeAudit(supabaseUrl, supabaseServiceKey, requester.id, 'user.restore', 'user', userId, {
        actor_email: requester.email,
      })
      return new Response(JSON.stringify({ ok: true }), {
        status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
      status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  // ── DELETE: permanently remove a user ───────────────────────────────────
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
    if (userId === requester.id) {
      return new Response(JSON.stringify({ error: 'Cannot delete yourself.' }), {
        status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    const base = `${supabaseUrl}/rest/v1`

    // Capture email before deleting for the audit record
    const targetRes = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, { headers: svcHeaders })
    const targetEmail = targetRes.ok ? (await targetRes.json()).email : 'unknown'

    // Delete all app data for this user
    await Promise.allSettled([
      fetch(`${base}/user_profiles?user_id=eq.${userId}`,      { method: 'DELETE', headers: svcHeaders }),
      fetch(`${base}/scoring_history?user_id=eq.${userId}`,    { method: 'DELETE', headers: svcHeaders }),
      fetch(`${base}/user_settings?user_id=eq.${userId}`,      { method: 'DELETE', headers: svcHeaders }),
      fetch(`${base}/api_usage?user_id=eq.${userId}`,          { method: 'DELETE', headers: svcHeaders }),
      fetch(`${base}/user_soft_deletes?user_id=eq.${userId}`,  { method: 'DELETE', headers: svcHeaders }),
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

    await writeAudit(supabaseUrl, supabaseServiceKey, requester.id, 'user.delete', 'user', userId, {
      target_email: targetEmail, actor_email: requester.email,
    })

    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS })
}
