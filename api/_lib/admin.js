// Shared admin auth helpers for /api endpoints.
// Used by course-ai.js and admin-course.js to avoid duplicating the
// `admins` table query.

export async function validateAuth(req) {
  const authHeader = req.headers.get('Authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return null

  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseServiceKey) return 'dev-user'

  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: supabaseServiceKey },
    })
    if (!res.ok) return null
    const user = await res.json()
    return user.id
  } catch {
    return null
  }
}

export async function isAdminUser(userId) {
  if (!userId) return false
  if (userId === 'dev-user') return true
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseServiceKey) return false
  try {
    const [adminsRes, rolesRes] = await Promise.all([
      fetch(
        `${supabaseUrl}/rest/v1/admins?user_id=eq.${userId}&select=user_id&limit=1`,
        { headers: { apikey: supabaseServiceKey, Authorization: `Bearer ${supabaseServiceKey}` } }
      ),
      fetch(
        `${supabaseUrl}/rest/v1/user_roles?user_id=eq.${userId}&role=in.(admin,owner)&select=user_id&limit=1`,
        { headers: { apikey: supabaseServiceKey, Authorization: `Bearer ${supabaseServiceKey}` } }
      ),
    ])
    const admins = adminsRes.ok ? await adminsRes.json() : []
    const roles = rolesRes.ok ? await rolesRes.json() : []
    return (Array.isArray(admins) && admins.length > 0) || (Array.isArray(roles) && roles.length > 0)
  } catch {
    return false
  }
}
