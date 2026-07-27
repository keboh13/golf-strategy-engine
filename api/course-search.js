// Vercel Edge Function — server-side proxy for GolfCourseAPI.
// Moves the paid API key server-side so it's never exposed in the browser.
// Required env var: GOLF_COURSE_API_KEY

import { CORS_HEADERS, jsonResponse } from './_lib/middleware.js'

export const config = { runtime: 'edge' }

async function validateAuth(req) {
  const authHeader = req.headers.get('Authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return null

  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseServiceKey) {
    // Only allow the no-Supabase dev shortcut outside production. In prod
    // a missing env var must fail closed — otherwise any non-empty Bearer
    // token bypasses auth and bills the paid GolfCourseAPI proxy.
    if (process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production') return null
    return 'dev-user'
  }

  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: supabaseServiceKey },
    })
    return res.ok ? (await res.json()).id : null
  } catch {
    return null
  }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS })

  const userId = await validateAuth(req)
  if (!userId) return jsonResponse({ error: 'Unauthorized — sign in required.' }, 401)

  const apiKey = process.env.GOLF_COURSE_API_KEY
  if (!apiKey) return jsonResponse({ error: 'GolfCourseAPI key not configured on server.' }, 500)

  let body
  try { body = await req.json() } catch { return jsonResponse({ error: 'Invalid JSON.' }, 400) }

  const { query } = body
  if (!query || typeof query !== 'string') return jsonResponse({ error: 'Missing search query.' }, 400)

  try {
    // #151: 10s timeout for the upstream GolfCourseAPI fetch
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    let res
    try {
      res = await fetch(
        `https://api.golfcourseapi.com/v1/search?search_query=${encodeURIComponent(query)}`,
        { headers: { Authorization: `Key ${apiKey}` }, signal: controller.signal }
      )
    } catch (e) {
      clearTimeout(timer)
      if (e.name === 'AbortError') throw new Error('GolfCourseAPI request timed out after 10s')
      throw e
    }
    clearTimeout(timer)
    if (!res.ok) throw new Error(`GolfCourseAPI error: ${res.status}`)
    const data = await res.json()
    return jsonResponse({ courses: data.courses || [] }, 200)
  } catch (e) {
    return jsonResponse({ error: e.message }, 502)
  }
}
