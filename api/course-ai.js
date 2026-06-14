// Vercel Edge Function — server-side proxy for course-related Claude API calls.
// Replaces client-side calls that used anthropic-dangerous-direct-browser-access.
// Supports three actions: geocode, scorecard-search, hole-design-search.
// Required env vars: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

export const config = { runtime: 'edge' }

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  process.env.ALLOWED_ORIGIN || '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const MODEL = 'claude-sonnet-4-6'

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

async function validateAuth(req) {
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

async function callClaude(messages, maxTokens, useWebSearch) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured on server.')

  const body = {
    model: MODEL,
    max_tokens: maxTokens,
    messages,
  }
  if (useWebSearch) {
    body.tools = [{ type: 'web_search_20250305', name: 'web_search' }]
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error(`Anthropic ${res.status}: ${err}`)
  }

  const data = await res.json()
  let text = ''
  for (const block of (data.content || [])) {
    if (block.type === 'text') text += block.text
  }
  return text
}

function buildGeocodeMessages(courseName, location) {
  return [{
    role: 'user',
    content: `What are the GPS coordinates of ${courseName} golf course${location ? ' in ' + location : ''}? Return ONLY JSON: {"lat": 36.043, "lng": -115.289}`,
  }]
}

function buildScorecardMessages(courseName, location) {
  return [{
    role: 'user',
    content: `Search greenskeeper.org and the course website for the verified scorecard of "${courseName}"${location ? ` in ${location}` : ''}.

Find REAL hole-by-hole yardages, pars, and handicap indexes. Do NOT guess.

Return ONLY this JSON (no markdown):
{
  "name": "Full course name",
  "location": "City, State",
  "yardage": <integer>,
  "rating": <float>,
  "slope": <integer>,
  "par": <integer>,
  "source": "greenskeeper.org or course website URL",
  "holes": [{"par":4,"yardage":379,"handicap":7}, ...all 18]
}

If not found: {"error": "No verified scorecard found"}`,
  }]
}

function buildHoleDesignMessages(courseName, location) {
  return [{
    role: 'user',
    content: `Search for hole-by-hole design details for "${courseName}"${location ? ` in ${location}` : ''}.

Look for course guides, flyover descriptions, or hole-by-hole breakdowns on the course website, greenskeeper.org, or golf review sites.

For EACH hole (1-18), find ONLY information you can verify from search results:
- Dogleg direction (left, right, or straight)
- Water hazards and their position relative to the fairway/green (left, right, front, etc.)
- Key bunker positions near the green (greenside left, greenside right, front, etc.)
- Whether there is OB and which side
- Any notable green features mentioned (severely sloped, multi-tier, island green, etc.)

CRITICAL: Only include information you found in search results. If you cannot find design details for a hole, set its entry to null. Do NOT guess or fabricate — accuracy is more important than completeness.

Return ONLY this JSON (no markdown):
{
  "course": "Full course name",
  "source": "URL where you found the most detail",
  "holes": [
    {"hole":1,"dogleg":"left|right|straight|null","water":"description or null","bunkers":"description or null","ob":"left|right|both|null","green_notes":"description or null"},
    ...all 18 holes, use null for any hole you cannot find info about
  ]
}

If you cannot find any hole design info: {"error": "No hole design data found"}`,
  }]
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS })

  const userId = await validateAuth(req)
  if (!userId) return jsonResponse({ error: 'Unauthorized — sign in required.' }, 401)

  let body
  try { body = await req.json() } catch { return jsonResponse({ error: 'Invalid JSON.' }, 400) }

  const { action, courseName, location } = body
  if (!action || !courseName) return jsonResponse({ error: 'Missing action or courseName.' }, 400)

  const ACTIONS = {
    'geocode': { build: buildGeocodeMessages, maxTokens: 200 },
    'scorecard-search': { build: buildScorecardMessages, maxTokens: 2500 },
    'hole-design-search': { build: buildHoleDesignMessages, maxTokens: 4000 },
  }

  const spec = ACTIONS[action]
  if (!spec) return jsonResponse({ error: `Unknown action: ${action}` }, 400)

  try {
    const messages = spec.build(courseName, location || '')
    const text = await callClaude(messages, spec.maxTokens, true)

    const clean = text.replace(/```json|```/g, '').trim()
    const m = clean.match(/\{[\s\S]*\}/)
    if (!m) return jsonResponse({ error: 'No JSON in AI response.' }, 502)

    const parsed = JSON.parse(m[0])
    if (parsed.error) return jsonResponse({ error: parsed.error }, 422)

    return jsonResponse({ result: parsed }, 200)
  } catch (e) {
    return jsonResponse({ error: e.message }, 502)
  }
}
