// Vercel Edge Function — returns whether the current user has admin access.
// Checks the `admins` table (seeded by ADMIN_EMAIL, grantable by other admins).
// Returns { isAdmin: true|false } — never exposes who the admins are.

export const config = { runtime: 'edge' }

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  process.env.ALLOWED_ORIGIN || '',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS })

  const supabaseUrl        = process.env.SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    return new Response(JSON.stringify({ isAdmin: false }), {
      status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  const token = (req.headers.get('Authorization') || '').replace('Bearer ', '')
  if (!token) {
    return new Response(JSON.stringify({ isAdmin: false }), {
      status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  // Validate session and get user ID
  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: supabaseServiceKey },
  })
  if (!userRes.ok) {
    return new Response(JSON.stringify({ isAdmin: false }), {
      status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }
  const user = await userRes.json()

  // Check admins table
  const adminRes = await fetch(
    `${supabaseUrl}/rest/v1/admins?user_id=eq.${user.id}&select=user_id&limit=1`,
    { headers: { apikey: supabaseServiceKey, Authorization: `Bearer ${supabaseServiceKey}` } }
  )
  const rows = adminRes.ok ? await adminRes.json() : []
  const isAdmin = Array.isArray(rows) && rows.length > 0

  return new Response(JSON.stringify({ isAdmin }), {
    status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}
