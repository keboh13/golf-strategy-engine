// Unauthenticated endpoint — resets a user's password directly if the email
// exists in the database. No email link required.
// Security trade-off: intentionally skips email verification per product decision.

export const config = { runtime: 'edge' }

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  process.env.ALLOWED_ORIGIN || '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const supabaseUrl        = process.env.SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseServiceKey) return json({ error: 'Server not configured' }, 500)

  let email, newPassword
  try {
    ;({ email, newPassword } = await req.json())
  } catch {
    return json({ error: 'Invalid request body' }, 400)
  }

  if (!email || !newPassword) return json({ error: 'Email and new password are required' }, 400)
  if (newPassword.length < 8)  return json({ error: 'Password must be at least 8 characters' }, 400)

  // Look up the user by email via the admin API
  const listRes = await fetch(
    `${supabaseUrl}/auth/v1/admin/users?email=${encodeURIComponent(email)}&page=1&per_page=1`,
    { headers: { apikey: supabaseServiceKey, Authorization: `Bearer ${supabaseServiceKey}` } }
  )
  if (!listRes.ok) return json({ error: 'Could not look up account' }, 500)

  const listData = await listRes.json()
  const users = listData.users ?? listData ?? []
  const user = Array.isArray(users) ? users[0] : null

  // Return the same generic message whether or not the email exists (avoids
  // leaking which emails are registered).
  if (!user) return json({ ok: true })

  // Update the password via the admin API
  const updateRes = await fetch(`${supabaseUrl}/auth/v1/admin/users/${user.id}`, {
    method: 'PUT',
    headers: {
      apikey: supabaseServiceKey,
      Authorization: `Bearer ${supabaseServiceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ password: newPassword }),
  })
  if (!updateRes.ok) {
    const err = await updateRes.json().catch(() => ({}))
    return json({ error: err.message || 'Could not update password' }, 500)
  }

  return json({ ok: true })
}
