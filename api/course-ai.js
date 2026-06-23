// Vercel Node Function — server-side proxy for course-related Claude API calls.
// Runs on Node (not Edge) so large yardage-book PDF parses can exceed the
// 25s edge wall-clock. The handler entry adapts Node IncomingMessage/
// ServerResponse to the Web Request/Response API the rest of this file uses.
// Required env vars: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { validateAuth, isAdminUser } from './_lib/admin.js'
import { parseJsonFromText } from './_lib/extractJson.js'

export const config = { maxDuration: 300 }

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  process.env.ALLOWED_ORIGIN || '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const MODEL = 'claude-sonnet-4-6'
// PDF / image vision extraction uses Haiku — ~5–10× faster than Sonnet for
// structured JSON extraction off a document, well within the quality bar for
// scorecard fields. Keep Sonnet for web-search and hole-design reasoning.
const MODEL_FAST = 'claude-haiku-4-5-20251001'

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

async function callClaude(messages, maxTokens, useWebSearch, extraTools, modelOverride) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured on server.')

  const body = {
    model: modelOverride || MODEL,
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

// Confirm a URL actually serves a PDF. Many "official" yardage-book links
// have rotted and 302-redirect to an HTML homepage; handing those to
// Anthropic's document fetcher produces an opaque base64/format error.
async function urlServesPdf(url) {
  try {
    // Range-GET the first few bytes — HEAD lies on a lot of CDNs (returns
    // 200 + text/html for the redirect target instead of the asset).
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { Range: 'bytes=0-7' },
    })
    if (!res.ok && res.status !== 206) return false
    const ct = (res.headers.get('content-type') || '').toLowerCase()
    if (ct.includes('application/pdf')) return true
    if (ct.includes('text/html')) return false
    // Content-type missing/ambiguous — sniff the magic bytes.
    const buf = new Uint8Array(await res.arrayBuffer())
    return buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46 // %PDF
  } catch {
    return false
  }
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

function buildPdfDiscoveryMessages(courseName, location, exclude = []) {
  const excludeBlock = exclude.length
    ? `\nDO NOT return any of these URLs — they were already tried and failed:\n${exclude.map(u => `- ${u}`).join('\n')}\n`
    : ''
  return [{
    role: 'user',
    content: `Find the most authoritative PDF link for "${courseName}"${location ? ` in ${location}` : ''}.

Use web_search to locate ONE of (in priority order):
1. The course's official yardage book PDF (often hosted on the course's own site or on a CDN like cdn.sanity.io, cloudfront, contentful).
2. The course's official scorecard PDF.
3. A PGA / USGA / state-association tournament packet PDF that covers this course.
4. A reputable third-party scorecard — prefer course.bluegolf.com (very reliable, structured per-tee scorecards), then greenskeeper.org, ncrdb, swingu.

CRITICAL:
- Prefer a DIRECT URL to a .pdf file. Verify the link actually serves a PDF (CDN-hosted PDFs on cdn.sanity.io, *.cloudfront.net, contentful, etc. are usually reliable; older pages on course websites have often been moved or deleted).
- If the only available scorecard is an HTML page (not a PDF), return the HTML URL and set "kind": "html". course.bluegolf.com detailedscorecard.htm pages are excellent HTML sources.
- If nothing usable exists, return {"error": "..."}.
${excludeBlock}
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

Extract THREE things and return them in ONE JSON payload:

(1) The standard scorecard for the longest tees available (Championship / Tournament / Black / Tips). Capture all 18 holes plus rating, slope, total yards, par total.

(2) Per-hole hazards and design features from the diagrams. For each hole 1-18, look at the hole illustration and pull every visible hazard, dogleg, and green note.

(3) **Per-hole written content from the PDF text.** For each hole 1-18, also capture:
   - "holeName": the caddie/marketing nickname for the hole if one is printed near the hole number (e.g. "Mind the Gap", "All of Texas", "Cascades"). Use null if no nickname exists.
   - "description": the full prose paragraph that describes the hole's strategy / design / approach. Capture it VERBATIM from the PDF — do not paraphrase or shorten. This is the caddie-style write-up usually printed under the hole title. Use null if absent.
   - "greenDepth": the printed green depth in yards (often shown as "DEPTH = 31"). Integer. Use null if absent.

(4) **Visual analysis of the hole diagram (the picture).** For each hole 1-18, study the actual hole illustration / overhead diagram and extract observations a caddie would make from looking at the image — things not necessarily in the prose. Capture as:
   - "visualNotes": 2-4 concise observations as a single string, semicolon-separated. Focus on (a) distance numbers visible on the diagram that aren't covered by hazards/carry_yards — sprinkler-to-landmark yardages, distances to bunker centers, distance to forced carries; (b) fairway shape — pinches, widening, doglegs visible from the overhead; (c) green shape and orientation (kidney, round, peanut, angled L-R, etc.); (d) elevation / cross-slope cues if drawn (downhill arrows, shading). Example: "FW pinches to 25y wide at 240y carry; cross-bunker 35y short of green; green angled left-to-right, ~38y deep; sprinkler at 150 reads as 156 to back pin." Use null if the diagram has no visible markers worth noting.
   - "distanceMarkers": array of {label, yards} for sprinkler/landmark distances clearly readable on the diagram (e.g. {"label":"sprinkler to back of green","yards":85}). Empty array if none readable.

Each hazard (in hazards[]):
- "type": "bunker" | "water" | "creek" | "native" | "OB" | "trees"
- "side": "L" | "R" | "C" | "front" | "back"
- "carry_yards": carry distance from back tee if labeled, else null
- "notes": short positional label ("fairway 240-260", "greenside", etc.)

CRITICAL: never guess. If a number isn't in the PDF, leave null and lower confidence. Capture the description paragraph EXACTLY as printed — do not summarize. Confidence rubric: "high" only when every hole was matched against the document; "medium" when most were; "low" when partial.

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
    {"hole":1,"holeName":"Outward Right","description":"This medium-length, dogleg right plays along…","greenDepth":31,"visualNotes":"FW narrows to ~28y at 240; cross-bunker carved into inside corner; green angled left-to-right with hollow short-left","distanceMarkers":[{"label":"sprinkler to front green","yards":62},{"label":"sprinkler to back","yards":108}],"dogleg":"left|right|straight","hazards":[{"type":"bunker","side":"R","carry_yards":235,"notes":"fairway"}],"green_notes":"","recommended_line":""},
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
  const holes = Array.isArray(parsed.holes) ? parsed.holes : []
  if (holes.length !== 18) issues.push(`hole_count:${holes.length}`)

  const parTotal = holes.reduce((s, h) => s + (parseInt(h?.par) || 0), 0)
  if (parTotal && (parTotal < 68 || parTotal > 74)) issues.push(`par_total_out_of_range:${parTotal}`)

  const yardTotal = holes.reduce((s, h) => s + (parseInt(h?.yardage) || 0), 0)
  if (yardTotal && (yardTotal < 4500 || yardTotal > 8200)) issues.push(`yardage_total_out_of_range:${yardTotal}`)

  // Per-hole: par ∈ {3,4,5}, yardage ∈ [80,700]
  let badYardage = 0, badPar = 0
  for (const h of holes) {
    const y = parseInt(h?.yardage) || 0
    if (y && (y < 80 || y > 700)) badYardage++
    const p = parseInt(h?.par) || 0
    if (p && (p < 3 || p > 6)) badPar++
  }
  if (badYardage) issues.push(`hole_yardage_out_of_range:${badYardage}`)
  if (badPar) issues.push(`hole_par_out_of_range:${badPar}`)

  // Handicap set 1..18
  const hcps = holes.map(h => parseInt(h?.handicap)).filter(n => Number.isFinite(n))
  if (hcps.length === 18) {
    const set = new Set(hcps)
    if (set.size !== 18) issues.push('handicap_duplicates')
    for (let i = 1; i <= 18; i++) if (!set.has(i)) { issues.push('handicap_set_incomplete'); break }
  }

  // Hazard array structure if present
  const hazardsByHole = Array.isArray(parsed.hazardsByHole) ? parsed.hazardsByHole : []
  for (const hz of hazardsByHole) {
    if (!hz || !Number.isFinite(parseInt(hz.hole))) continue
    if (hz.greenDepth != null && (hz.greenDepth < 15 || hz.greenDepth > 50)) {
      issues.push('green_depth_out_of_range'); break
    }
    if (Array.isArray(hz.hazards)) {
      for (const z of hz.hazards) {
        if (!z || typeof z !== 'object') continue
        if (z.type && !/^(bunker|water|creek|native|OB|trees)$/i.test(z.type)) {
          issues.push('hazard_bad_type'); break
        }
        if (z.side && !/^(L|R|C|front|back)$/i.test(z.side)) {
          issues.push('hazard_bad_side'); break
        }
        const cy = Number(z.carry_yards)
        const holeY = parseInt(holes[parseInt(hz.hole) - 1]?.yardage) || 0
        if (Number.isFinite(cy) && holeY && cy > holeY) {
          issues.push('hazard_carry_past_hole'); break
        }
      }
    }
  }

  return issues
}

// Vercel's Node runtime hands us (req: IncomingMessage, res: ServerResponse).
// The rest of this file is written against the Web `Request`/`Response` API,
// so we adapt at the boundary instead of rewriting every jsonResponse return.
export default async function nodeHandler(nodeReq, nodeRes) {
  try {
    const url = `http://localhost${nodeReq.url || '/'}`
    const headers = new Headers()
    for (const [k, v] of Object.entries(nodeReq.headers || {})) {
      if (v == null) continue
      headers.set(k, Array.isArray(v) ? v.join(',') : String(v))
    }
    let bodyBuf
    if (nodeReq.method !== 'GET' && nodeReq.method !== 'HEAD') {
      bodyBuf = await new Promise((resolve, reject) => {
        const chunks = []
        nodeReq.on('data', c => chunks.push(c))
        nodeReq.on('end', () => resolve(Buffer.concat(chunks)))
        nodeReq.on('error', reject)
      })
    }
    const webReq = new Request(url, {
      method: nodeReq.method,
      headers,
      body: bodyBuf && bodyBuf.length ? bodyBuf : undefined,
    })
    const webRes = await handleRequest(webReq)
    nodeRes.statusCode = webRes.status
    webRes.headers.forEach((value, key) => nodeRes.setHeader(key, value))
    const buf = Buffer.from(await webRes.arrayBuffer())
    nodeRes.end(buf)
  } catch (e) {
    nodeRes.statusCode = 500
    nodeRes.setHeader('Content-Type', 'application/json')
    nodeRes.end(JSON.stringify({ error: `Handler crashed: ${e.message}` }))
  }
}

async function handleRequest(req) {
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
    // 10000 tokens budget: scorecard (~1.5k) + 18 verbatim descriptions (~3–5k) +
    // hazards + per-hole visual analysis from the diagrams (~2k).
    const text = await callClaude(messages, 10000, false, undefined, MODEL_FAST)
    const r = parseJsonFromText(text)
    if (!r.ok) throw new Error(`No JSON in PDF parse response (${r.error}).`)
    const parsed = r.value
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

      // Read current edit_version so we can bump it (clients use this to
      // lazily refresh stale localStorage entries after admin-driven changes).
      let nextVersion = 1
      try {
        const cur = await supabaseRest(
          `course_cache?cache_key=eq.${encodeURIComponent(course_key)}&select=edit_version`,
          { method: 'GET' }
        )
        if (cur.ok) {
          const rows = await cur.json()
          if (Array.isArray(rows) && rows[0]?.edit_version != null) {
            nextVersion = Number(rows[0].edit_version) + 1
          }
        }
      } catch {}

      await supabaseRest('course_cache?on_conflict=cache_key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({
          cache_key: course_key,
          course_data: scorecardOnly,
          source: 'yardage_book',
          cached_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          updated_by: userId === 'dev-user' ? null : userId,
          edit_version: nextVersion,
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
        const hzRes = await supabaseRest('course_hole_hazards?on_conflict=course_key,hole_ref', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
          body: JSON.stringify(rows),
        }).catch(e => ({ ok: false, status: 0, _err: e?.message }))
        if (!hzRes.ok) {
          const detail = hzRes._err || (await hzRes.text?.().catch(() => '')) || ''
          console.error(`[course_hole_hazards] persist failed (${hzRes.status}): ${detail}`)
          parsed._hazardPersistError = `course_hole_hazards persist failed (${hzRes.status}). ${detail}`
        }
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

      // Step 1: web-search for the official PDF URL. Retry up to twice if the
      // returned URL turns out to be dead (HTML masquerading as a PDF), so the
      // model can try a different source instead of failing the whole request.
      const tried = []
      let discovery = null
      let confirmedPdf = false
      for (let attempt = 0; attempt < 3; attempt++) {
        const discoverText = await callClaude(
          buildPdfDiscoveryMessages(courseName, location || '', tried),
          800,
          true,
        )
        const dRes = parseJsonFromText(discoverText)
        if (!dRes.ok) return jsonResponse({ error: `PDF discovery returned no JSON (${dRes.error}).` }, 502)
        const d = dRes.value
        if (d.error || !d.url) {
          if (!discovery) return jsonResponse({ error: d.error || 'No PDF URL found via web search.' }, 422)
          break
        }
        discovery = d
        const looksPdf = d.kind === 'pdf' || /\.pdf(\?|$)/i.test(d.url)
        if (!looksPdf) break // HTML hit — let the HTML fallback handle it
        confirmedPdf = await urlServesPdf(d.url)
        if (confirmedPdf) break
        tried.push(d.url)
      }

      // Step 2: if the discovered link is a confirmed PDF, feed it to the
      // document-block parser. Otherwise fall through to the HTML fallback.
      if (confirmedPdf) {
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
      const hRes = parseJsonFromText(htmlText)
      if (!hRes.ok) return jsonResponse({ error: `No JSON in HTML scorecard response (${hRes.error}).` }, 502)
      const htmlParsed = hRes.value
      if (htmlParsed.error) return jsonResponse({ error: htmlParsed.error }, 422)

      const issues = validateScorecardJson(htmlParsed)
      htmlParsed._validationIssues = issues
      htmlParsed._sourceHtml = discovery.url
      htmlParsed._discoveredVia = 'web_search'
      if (issues.length > 1) htmlParsed._confidence = 'low'

      if (persist !== false && course_key && supabaseUrl && supabaseServiceKey) {
        const scorecardOnly = { ...htmlParsed, _source: 'yardage_book' }
        let nextVersion = 1
        try {
          const cur = await supabaseRest(
            `course_cache?cache_key=eq.${encodeURIComponent(course_key)}&select=edit_version`,
            { method: 'GET' }
          )
          if (cur.ok) {
            const rows = await cur.json()
            if (Array.isArray(rows) && rows[0]?.edit_version != null) {
              nextVersion = Number(rows[0].edit_version) + 1
            }
          }
        } catch {}
        await supabaseRest('course_cache?on_conflict=cache_key', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
          body: JSON.stringify({
            cache_key: course_key,
            course_data: scorecardOnly,
            source: 'yardage_book',
            cached_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            updated_by: userId === 'dev-user' ? null : userId,
            edit_version: nextVersion,
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
      const text = await callClaude(messages, 2000, false, undefined, MODEL_FAST)
      const vRes = parseJsonFromText(text)
      if (!vRes.ok) return jsonResponse({ error: `No JSON in vision response (${vRes.error}).` }, 502)
      const parsed = vRes.value
      if (parsed.error) return jsonResponse({ error: parsed.error }, 422)

      if (persist && course_key && supabaseUrl && supabaseServiceKey) {
        const hzRes = await supabaseRest('course_hole_hazards?on_conflict=course_key,hole_ref', {
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
        }).catch(e => ({ ok: false, status: 0, _err: e?.message }))
        if (!hzRes.ok) {
          const detail = hzRes._err || (await hzRes.text?.().catch(() => '')) || ''
          console.error(`[course_hole_hazards] persist failed (${hzRes.status}): ${detail}`)
          parsed._hazardPersistError = `course_hole_hazards persist failed (${hzRes.status}). ${detail}`
        }
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

    const aRes = parseJsonFromText(text)
    if (!aRes.ok) return jsonResponse({ error: `No JSON in AI response (${aRes.error}).` }, 502)
    const parsed = aRes.value
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
