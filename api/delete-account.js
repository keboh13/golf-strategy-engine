// Vercel Edge Function — lets an authenticated user permanently delete their own account.
// Uses SUPABASE_SERVICE_ROLE_KEY to call the admin delete API, so it never goes to the browser.
// Required Vercel env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

export const config = { runtime: 'edge' }

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  process.env.ALLOWED_ORIGIN || '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'DELETE, OPTIONS',
}

function parseJwt(token) {
  try {
    const [, payload] = token.split('.')
    const padded = payload + '==='.slice((payload.length + 3) % 4)
    return JSON.parse(atob(padded.replace(/-/g, '+').replace(/_/g, '/')))
  } catch { return null }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS })
  if (req.method !== 'DELETE') {
    return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS })
  }

  const token = (req.headers.get('Authorization') || '').replace('Bearer ', '')
  if (!token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  const supabaseUrl        = process.env.SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    return new Response(JSON.stringify({ error: 'Server not configured.' }), {
      status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  // Validate JWT and get the user's own ID — only allows deleting yourself
  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: supabaseServiceKey },
  })
  if (!userRes.ok) {
    return new Response(JSON.stringify({ error: 'Invalid or expired session.' }), {
      status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }
  const user = await userRes.json()
  const userId = user.id

  // Delete user data from all app tables (RLS bypass via service role)
  const base    = `${supabaseUrl}/rest/v1`
  const headers = { apikey: supabaseServiceKey, Authorization: `Bearer ${supabaseServiceKey}`, 'Content-Type': 'application/json' }

  await Promise.allSettled([
    fetch(`${base}/user_profiles?user_id=eq.${userId}`,   { method: 'DELETE', headers }),
    fetch(`${base}/scoring_history?user_id=eq.${userId}`, { method: 'DELETE', headers }),
    fetch(`${base}/user_settings?user_id=eq.${userId}`,   { method: 'DELETE', headers }),
    fetch(`${base}/api_usage?user_id=eq.${userId}`,       { method: 'DELETE', headers }),
  ])

  // Delete the auth account
  const delRes = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: { apikey: supabaseServiceKey, Authorization: `Bearer ${supabaseServiceKey}` },
  })
  if (!delRes.ok) {
    const body = await delRes.text()
    return new Response(JSON.stringify({ error: `Failed to delete account: ${body}` }), {
      status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}
