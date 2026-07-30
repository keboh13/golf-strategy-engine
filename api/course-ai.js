// Vercel Node Function — server-side proxy for course-related Claude API calls.
// Runs on Node (not Edge) so large yardage-book PDF parses can exceed the
// 25s edge wall-clock. The handler entry adapts Node IncomingMessage/
// ServerResponse to the Web Request/Response API the rest of this file uses.
// Required env vars: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { validateAuth } from './_lib/admin.js'
import { CORS_HEADERS, jsonResponse } from './_lib/middleware.js'
import { callClaude } from './_lib/claude.js'
import { createSupabaseRest } from './_lib/coursePersist.js'

// Action handlers
import { handle as handleGeocode } from './_lib/actions/geocode.js'
import { handle as handleScorecardSearch } from './_lib/actions/scorecardSearch.js'
import { handle as handleHoleDesignSearch } from './_lib/actions/holeDesignSearch.js'
import { handle as handleYardageBook } from './_lib/actions/yardageBook.js'
import { handle as handleParsePdf } from './_lib/actions/parsePdf.js'
import { handle as handleHazardExtract } from './_lib/actions/hazardExtract.js'
import { handle as handleAutoDiscoverHazards } from './_lib/actions/autoDiscoverHazards.js'

export const config = { maxDuration: 300 }

function makeCacheKey(name, location) {
  return `${(name || '').toLowerCase().trim()}|${(location || '').toLowerCase().trim()}`
}

const ACTION_MAP = {
  'geocode': handleGeocode,
  'scorecard-search': handleScorecardSearch,
  'hole-design-search': handleHoleDesignSearch,
  'yardage-book': handleYardageBook,
  'parse-yardage-book-pdf': handleParsePdf,
  'hazard-extract': handleHazardExtract,
  'auto-discover-hazards': handleAutoDiscoverHazards,
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

  const { action, courseName, location } = body
  if (!action) return jsonResponse({ error: 'Missing action.' }, 400)

  // Always derive course_key server-side from courseName + location. The
  // client previously passed it through, which let any authed user clobber
  // another course's row in the shared course_cache / course_hole_hazards
  // tables.
  const courseKey = courseName ? makeCacheKey(courseName, location || '') : null

  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseRest = (supabaseUrl && supabaseServiceKey)
    ? createSupabaseRest(supabaseUrl, supabaseServiceKey)
    : null

  // Build the context object passed to every action handler.
  const ctx = {
    userId,
    courseKey,
    callClaude,
    supabaseRest,
  }

  const handler = ACTION_MAP[action]
  if (!handler) return jsonResponse({ error: `Unknown action: ${action}` }, 400)

  try {
    return await handler(body, ctx)
  } catch (e) {
    return jsonResponse({ error: e.message }, 502)
  }
}
