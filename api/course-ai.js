// Vercel Edge Function — server-side proxy for course-related Claude API calls.
// Replaces client-side calls that used anthropic-dangerous-direct-browser-access.
// Supports six actions: geocode, scorecard-search, hole-design-search, yardage-book, hazard-extract, parse-yardage-book-pdf.
// Required env vars: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

export const config = { runtime: 'nodejs', maxDuration: 60 }

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

async function isAdminUser(userId) {
  if (userId === 'dev-user') return true
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseServiceKey) return false
  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/admins?user_id=eq.${userId}&select=user_id&limit=1`,
      { headers: { apikey: supabaseServiceKey, Authorization: `Bearer ${supabaseServiceKey}` } }
    )
    if (!res.ok) return false
    const rows = await res.json()
    return Array.isArray(rows) && rows.length > 0
  } catch {
    return false
  }
}

async function callClaude(messages, maxTokens, useWebSearch, extraTools) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured on server.')

  const body = {
    model: MODEL,
    max_tokens: maxTokens,
    messages,
  }
  const tools = []
  if (useWebSearch) tools.push({ type: 'web_search_20250305', name: 'web_search' })
  if (Array.isArray(extraTools) && extraTools.length) tools.push(...extraTools)
  if (tools.length) body.tools = tools

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

function buildPdfDiscoveryMessages(courseName, location) {
  return [{
    role: 'user',
    content: `Find the most authoritative PDF link for "${courseName}"${location ? ` in ${location}` : ''}.

Use web_search to locate ONE of (in priority order):
1. The course's official yardage book PDF.
2. The course's official scorecard PDF.
3. A PGA / USGA / state-association tournament packet PDF that covers this course.
4. A reputable third-party PDF scorecard (greenskeeper.org, ncrdb, swingu) — only if nothing official exists.

CRITICAL:
- Return a DIRECT URL to a .pdf file. Do NOT return a regular webpage.
- If the only available scorecard is an HTML page (not a PDF), say so by returning the HTML URL and setting "kind": "html".
- If nothing usable exists, return {"error": "..."}.

Return ONLY this JSON (no markdown):
{"url": "https://…/course.pdf", "kind": "pdf|html", "title": "short description of the source"}`,
  }]
}

function buildHazardExtractMessages(holeNumber, imageRef) {
  const imageBlock = imageRef.kind === 'url'
    ? { type: 'image', source: { type: 'url', url: imageRef.value } }
    : { type: 'image', source: { type: 'base64', media_type: imageRef.media_type || 'image/png', data: imageRef.value } }
  return [{
    role: 'user',
    content: [
      imageBlock,
      { type: 'text', text: `This is a yardage-book diagram for hole ${holeNumber}. Extract hazards and design features as structured JSON.

Identify every hazard visible on the diagram. For each hazard set:
- "type": one of "bunker" | "water" | "creek" | "native" | "OB" | "trees"
- "side": "L" | "R" | "C" | "front" | "back" (where C = centerline, in play)
- "carry_yards": carry distance from the back tee if labeled on the diagram, otherwise null
- "notes": short label or position note (e.g. "fairway 240-260", "greenside")

Also identify:
- "dogleg": "left" | "right" | "straight"
- "green_notes": tier/slope/shape notes if visible
- "recommended_line": short caddie-style advice if a clear ideal line is implied

Return ONLY this JSON:
{
  "hole": ${holeNumber},
  "dogleg": "left|right|straight",
  "hazards": [{"type":"bunker","side":"R","carry_yards":235,"notes":"fairway"}],
  "green_notes": "",
  "recommended_line": ""
}` },
    ],
  }]
}

function buildPdfParseMessages(pdfUrl, courseName, location) {
  return [{
    role: 'user',
    content: [
      { type: 'document', source: { type: 'url', url: pdfUrl } },
      { type: 'text', text: `This PDF is the official yardage book / scorecard for "${courseName}"${location ? ` in ${location}` : ''}.

Extract TWO things and return them in ONE JSON payload:

(1) The standard scorecard for the longest tees available (Championship / Tournament / Black / Tips). Capture all 18 holes plus rating, slope, total yards, par total.

(2) Per-hole hazards and design features from the diagrams. For each hole 1-18, look at the hole illustration and pull every visible hazard, dogleg, and green note.

Each hazard:
- "type": "bunker" | "water" | "creek" | "native" | "OB" | "trees"
- "side": "L" | "R" | "C" | "front" | "back"
- "carry_yards": carry distance from back tee if labeled, else null
- "notes": short positional label ("fairway 240-260", "greenside", etc.)

CRITICAL: never guess. If a number isn't in the PDF, leave null and lower confidence. Confidence rubric: "high" only when every hole was matched against the document; "medium" when most were; "low" when partial.

Return ONLY this JSON (no markdown):
{
  "name": "Full course name",
  "location": "City, State",
  "yardage": <int total>,
  "rating": <float>,
  "slope": <int>,
  "par": <int total>,
  "selectedTee": "Championship",
  "source": "PDF (uploaded yardage book)",
  "_confidence": "high|medium|low",
  "holes": [{"par":4,"yardage":379,"handicap":7}, ...all 18],
  "hazardsByHole": [
    {"hole":1,"dogleg":"left|right|straight","hazards":[{"type":"bunker","side":"R","carry_yards":235,"notes":"fairway"}],"green_notes":"","recommended_line":""},
    ...all 18
  ]
}

If the PDF doesn't contain a usable scorecard: {"error":"PDF did not contain a parseable scorecard"}` },
    ],
  }]
}

function validateScorecardJson(parsed) {
  const issues = []
  if (!parsed || typeof parsed !== 'object') { issues.push('not_object'); return issues }
  if (!Array.isArray(parsed.holes) || parsed.holes.length !== 18) issues.push('hole_count')
  const parTotal = (parsed.holes || []).reduce((s, h) => s + (parseInt(h?.par) || 0), 0)
  if (parTotal < 68 || parTotal > 74) issues.push('par_total_out_of_range')
  const yardTotal = (parsed.holes || []).reduce((s, h) => s + (parseInt(h?.yardage) || 0), 0)
  if (yardTotal < 4500 || yardTotal > 8200) issues.push('yardage_total_out_of_range')
  for (const h of (parsed.holes || [])) {
    const y = parseInt(h?.yardage) || 0
    if (y && (y < 80 || y > 700)) { issues.push('hole_yardage_out_of_range'); break }
  }
  return issues
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS })

  const userId = await validateAuth(req)
  if (!userId) return jsonResponse({ error: 'Unauthorized — sign in required.' }, 401)

  let body
  try { body = await req.json() } catch { return jsonResponse({ error: 'Invalid JSON.' }, 400) }

  const { action, courseName, location, hole, image_url, image_base64, image_media_type, course_key, persist, pdf_url } = body
  if (!action) return jsonResponse({ error: 'Missing action.' }, 400)

  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseRest = async (path, init) => fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      apikey: supabaseServiceKey,
      Authorization: `Bearer ${supabaseServiceKey}`,
    },
  })

  async function parsePdfAndPersist(pdfUrl) {
    const messages = buildPdfParseMessages(pdfUrl, courseName, location || '')
    const text = await callClaude(messages, 6000, false)
    const clean = text.replace(/```json|```/g, '').trim()
    const m = clean.match(/\{[\s\S]*\}/)
    if (!m) throw new Error('No JSON in PDF parse response.')
    const parsed = JSON.parse(m[0])
    if (parsed.error) throw new Error(parsed.error)

    const issues = validateScorecardJson(parsed)
    parsed._validationIssues = issues
    if (issues.length > 1) parsed._confidence = 'low'
    else if (issues.length === 1 && parsed._confidence === 'high') parsed._confidence = 'medium'

    if (persist !== false && course_key && supabaseUrl && supabaseServiceKey) {
      const scorecardOnly = { ...parsed }
      delete scorecardOnly.hazardsByHole
      scorecardOnly._source = 'yardage_book'
      scorecardOnly._sourcePdf = pdfUrl
      await supabaseRest('course_cache?on_conflict=cache_key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({
          cache_key: course_key,
          course_data: scorecardOnly,
          source: 'yardage_book',
          cached_at: new Date().toISOString(),
        }),
      }).catch(() => {})

      const rows = (parsed.hazardsByHole || [])
        .filter(h => h && h.hole)
        .map(h => ({
          course_key,
          hole_ref: Number(h.hole),
          hazards: h,
          source: 'pdf_vision',
          image_path: pdfUrl,
          confidence: parsed._confidence || 'medium',
          updated_at: new Date().toISOString(),
        }))
      if (rows.length) {
        await supabaseRest('course_hole_hazards?on_conflict=course_key,hole_ref', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
          body: JSON.stringify(rows),
        }).catch(() => {})
      }
    }

    parsed._sourcePdf = pdfUrl
    return parsed
  }

  try {
    if (action === 'parse-yardage-book-pdf') {
      if (!pdf_url || !courseName) return jsonResponse({ error: 'parse-yardage-book-pdf needs `pdf_url` and `courseName`.' }, 400)
      const admin = await isAdminUser(userId)
      if (!admin) return jsonResponse({ error: 'Admin access required to upload a yardage book PDF.' }, 403)
      const parsed = await parsePdfAndPersist(pdf_url)
      return jsonResponse({ result: parsed }, 200)
    }

    if (action === 'yardage-book') {
      if (!courseName) return jsonResponse({ error: 'Missing courseName.' }, 400)

      // Step 1: web-search for the official PDF URL.
      const discoverText = await callClaude(buildPdfDiscoveryMessages(courseName, location || ''), 800, true)
      const dm = discoverText.replace(/```json|```/g, '').trim().match(/\{[\s\S]*?\}/)
      if (!dm) return jsonResponse({ error: 'PDF discovery returned no JSON.' }, 502)
      const discovery = JSON.parse(dm[0])
      if (discovery.error || !discovery.url) {
        return jsonResponse({ error: discovery.error || 'No PDF URL found via web search.' }, 422)
      }

      // Step 2: if the discovered link is a PDF, feed it to the document-block parser.
      const isPdf = discovery.kind === 'pdf' || /\.pdf(\?|$)/i.test(discovery.url)
      if (isPdf) {
        try {
          const parsed = await parsePdfAndPersist(discovery.url)
          parsed._discoveredVia = 'web_search'
          parsed._discoveryTitle = discovery.title || null
          return jsonResponse({ result: parsed }, 200)
        } catch (e) {
          return jsonResponse({ error: `PDF discovered (${discovery.url}) but parse failed: ${e.message}` }, 502)
        }
      }

      // Step 2b: HTML fallback — extract scorecard from the page via web search.
      const htmlText = await callClaude([{
        role: 'user',
        content: `Use web_search to open ${discovery.url} and extract the verified scorecard for "${courseName}"${location ? ` in ${location}` : ''}.

Return ONLY this JSON (no markdown):
{
  "name": "Full course name",
  "location": "City, State",
  "yardage": <int>,
  "rating": <float>,
  "slope": <int>,
  "par": <int>,
  "selectedTee": "Championship",
  "source": "${discovery.url}",
  "_confidence": "high|medium|low",
  "holes": [{"par":4,"yardage":379,"handicap":7}, ...all 18]
}

If you cannot extract a verifiable scorecard: {"error":"…"}`,
      }], 3500, true)
      const hm = htmlText.replace(/```json|```/g, '').trim().match(/\{[\s\S]*\}/)
      if (!hm) return jsonResponse({ error: 'No JSON in HTML scorecard response.' }, 502)
      const htmlParsed = JSON.parse(hm[0])
      if (htmlParsed.error) return jsonResponse({ error: htmlParsed.error }, 422)

      const issues = validateScorecardJson(htmlParsed)
      htmlParsed._validationIssues = issues
      htmlParsed._sourceHtml = discovery.url
      htmlParsed._discoveredVia = 'web_search'
      if (issues.length > 1) htmlParsed._confidence = 'low'

      if (persist !== false && course_key && supabaseUrl && supabaseServiceKey) {
        const scorecardOnly = { ...htmlParsed, _source: 'yardage_book' }
        await supabaseRest('course_cache?on_conflict=cache_key', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
          body: JSON.stringify({
            cache_key: course_key,
            course_data: scorecardOnly,
            source: 'yardage_book',
            cached_at: new Date().toISOString(),
          }),
        }).catch(() => {})
      }

      return jsonResponse({ result: htmlParsed }, 200)
    }

    if (action === 'hazard-extract') {
      if (!hole || (!image_url && !image_base64)) {
        return jsonResponse({ error: 'hazard-extract needs `hole` and `image_url` or `image_base64`.' }, 400)
      }
      const imageRef = image_url
        ? { kind: 'url', value: image_url }
        : { kind: 'base64', value: image_base64, media_type: image_media_type }
      const messages = buildHazardExtractMessages(hole, imageRef)
      const text = await callClaude(messages, 2000, false)
      const m = text.replace(/```json|```/g, '').trim().match(/\{[\s\S]*\}/)
      if (!m) return jsonResponse({ error: 'No JSON in vision response.' }, 502)
      const parsed = JSON.parse(m[0])
      if (parsed.error) return jsonResponse({ error: parsed.error }, 422)

      if (persist && course_key && supabaseUrl && supabaseServiceKey) {
        await supabaseRest('course_hole_hazards?on_conflict=course_key,hole_ref', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
          body: JSON.stringify({
            course_key,
            hole_ref: Number(hole),
            hazards: parsed,
            source: 'vision',
            image_path: image_url || null,
            updated_at: new Date().toISOString(),
          }),
        }).catch(() => {})
      }
      return jsonResponse({ result: parsed }, 200)
    }

    if (!courseName) return jsonResponse({ error: 'Missing courseName.' }, 400)

    const ACTIONS = {
      'geocode': { build: buildGeocodeMessages, maxTokens: 200 },
      'scorecard-search': { build: buildScorecardMessages, maxTokens: 2500 },
      'hole-design-search': { build: buildHoleDesignMessages, maxTokens: 4000 },
    }

    const spec = ACTIONS[action]
    if (!spec) return jsonResponse({ error: `Unknown action: ${action}` }, 400)

    const messages = spec.build(courseName, location || '')
    const text = await callClaude(messages, spec.maxTokens, true)

    const clean = text.replace(/```json|```/g, '').trim()
    const m = clean.match(/\{[\s\S]*\}/)
    if (!m) return jsonResponse({ error: 'No JSON in AI response.' }, 502)

    const parsed = JSON.parse(m[0])
    if (parsed.error) return jsonResponse({ error: parsed.error }, 422)

    if (spec.validate) {
      const issues = validateScorecardJson(parsed)
      parsed._validationIssues = issues
      if (issues.length > 1) parsed._confidence = 'low'
      else if (issues.length === 1) parsed._confidence = parsed._confidence === 'high' ? 'medium' : (parsed._confidence || 'low')
    }

    return jsonResponse({ result: parsed }, 200)
  } catch (e) {
    return jsonResponse({ error: e.message }, 502)
  }
}
