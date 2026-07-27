// Vercel Edge Function — AI universal importer.
// Accepts pasted text or a screenshot (base64 image) from golf apps without
// CSV export (Arccos, Shot Scope, 18Birdies, ...) and asks Claude to extract
// normalized shot data. NOT a general proxy: the Anthropic request is built
// entirely server-side with a pinned system prompt + structured output schema.
//
// Set these in Vercel project environment variables (not in .env):
//   ANTHROPIC_API_KEY          — your Anthropic key
//   SUPABASE_URL               — from Supabase project settings
//   SUPABASE_SERVICE_ROLE_KEY  — from Supabase project settings (secret, never expose to browser)
//   RATE_LIMIT_IMPORT_PER_DAY  — optional, defaults to 10 (separate pool from generate)
//   PARSE_IMPORT_MODEL         — optional, defaults to claude-haiku-4-5 (cheap, vision-capable)

import { validateNormalizedSession } from '../src/lib/aiImport.js'

export const config = { runtime: 'edge' }

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  process.env.ALLOWED_ORIGIN || '',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const DAILY_LIMIT = parseInt(process.env.RATE_LIMIT_IMPORT_PER_DAY || '10', 10)
const MODEL       = process.env.PARSE_IMPORT_MODEL || 'claude-haiku-4-5'

// Size limits (413 on violation)
const MAX_TEXT_BYTES         = 200 * 1024            // 200KB of pasted text
const MAX_IMAGE_BASE64_BYTES = 3 * 1024 * 1024       // 3MB base64 payload (~2.25MB image)
const SUPPORTED_IMAGE_TYPES  = ['image/jpeg', 'image/png', 'image/webp']

// ── Pinned system prompt ──────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a golf shot-data extraction engine. The user provides raw text or a screenshot from a golf app (Arccos, Shot Scope, 18Birdies, Trackman, Garmin, etc.). Extract every shot or per-club entry into the NormalizedSession JSON schema.

Rules:
1. Missing or unknown values are null — never 0, never a guess.
2. Round every numeric value to 1 decimal place.
3. Unit conversions (output is ALWAYS yards / mph / feet):
   - meters to yards: multiply by 1.09361
   - m/s to mph: multiply by 2.23694
   - Set unitsDetected to the distance unit of the SOURCE data: 'yards', 'meters', or 'unknown'.
4. offlineYds sign convention: negative = LEFT of target, positive = RIGHT of target.
5. sessionDate: 'YYYY-MM-DD' if the source shows a session date, else null. Per-shot timestamp: ISO 8601 string if available, else null.
6. clubKey canon (clubLabel keeps the source's original label text):
   - 'driver' for any driver
   - fairway woods: '2w' through '9w'
   - hybrids: '1h' through '5h'
   - irons: '1i' through '9i'
   - wedges: 'pw' (pitching), 'gw' (gap/approach), 'sw' (sand), 'lw' (lob)
   - wedges identified only by loft: the bare loft number '44' through '64' (e.g. '52')
   - anything that does not match: slugify the label (lowercase, trimmed, runs of non-alphanumeric characters replaced by a single hyphen)
7. Per-club AVERAGES (e.g. an Arccos/Shot Scope club-distances screen) are valid input: emit one shot per club carrying the average values, and add the warning 'Source provided per-club averages, not individual shots'.
8. Add a warning string for anything ambiguous, unreadable, or assumed.
9. source is always 'ai-import'. If you truly cannot extract any shot data, emit an empty shots array and explain why in warnings.`

// ── Structured output schema (NormalizedSession) ──────────────────────────────
const NULLABLE_NUMBER = { anyOf: [{ type: 'number' }, { type: 'null' }] }
const NULLABLE_STRING = { anyOf: [{ type: 'string' }, { type: 'null' }] }

const SHOT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['clubKey', 'clubLabel', 'carryYds', 'totalYds', 'offlineYds',
              'ballSpeedMph', 'clubSpeedMph', 'launchDeg', 'spinRpm', 'apexFt', 'timestamp'],
  properties: {
    clubKey:      { type: 'string' },
    clubLabel:    { type: 'string' },
    carryYds:     NULLABLE_NUMBER,
    totalYds:     NULLABLE_NUMBER,
    offlineYds:   NULLABLE_NUMBER,
    ballSpeedMph: NULLABLE_NUMBER,
    clubSpeedMph: NULLABLE_NUMBER,
    launchDeg:    NULLABLE_NUMBER,
    spinRpm:      NULLABLE_NUMBER,
    apexFt:       NULLABLE_NUMBER,
    timestamp:    NULLABLE_STRING,
  },
}

const SESSION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['source', 'sessionDate', 'unitsDetected', 'shots', 'warnings'],
  properties: {
    source:        { const: 'ai-import' },
    sessionDate:   NULLABLE_STRING,
    unitsDetected: { type: 'string', enum: ['yards', 'meters', 'unknown'] },
    shots:         { type: 'array', items: SHOT_SCHEMA },
    warnings:      { type: 'array', items: { type: 'string' } },
  },
}

// ── JWT decode (no crypto verification needed — we validate via Supabase API) ─
function parseJwt(token) {
  try {
    const [, payload] = token.split('.')
    const padded = payload + '==='.slice((payload.length + 3) % 4)
    const json = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
    return JSON.parse(json)
  } catch {
    return null
  }
}

// ── Rate limiting via Supabase REST API (separate pool: endpoint=parse-import) ─
async function checkAndRecordUsage(userId) {
  const supabaseUrl        = process.env.SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    console.warn('[rate-limit] Supabase env vars missing, skipping rate limit check')
    return { allowed: true, used: 0, recordId: null }
  }

  const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const base = `${supabaseUrl}/rest/v1`
  const headers = {
    'Content-Type': 'application/json',
    'apikey':       supabaseServiceKey,
    'Authorization': `Bearer ${supabaseServiceKey}`,
    'Prefer': 'return=representation',
  }

  // Count recent requests for THIS endpoint only
  const countRes = await fetch(
    `${base}/api_usage?user_id=eq.${userId}&endpoint=eq.parse-import&used_at=gte.${encodeURIComponent(windowStart)}&select=id`,
    { headers: { ...headers, 'Prefer': 'count=exact' } }
  )
  const count = parseInt(countRes.headers.get('Content-Range')?.split('/')[1] || '0', 10)

  if (count >= DAILY_LIMIT) {
    return { allowed: false, used: count, recordId: null }
  }

  // Record this request — return=representation gives back the inserted row (including id)
  const insertRes = await fetch(`${base}/api_usage`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ user_id: userId, endpoint: 'parse-import', used_at: new Date().toISOString() }),
  })
  let recordId = null
  if (insertRes.ok) {
    const rows = await insertRes.json()
    recordId = Array.isArray(rows) ? (rows[0]?.id ?? null) : null
  }

  return { allowed: true, used: count + 1, recordId }
}

function jsonResponse(body, status, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', ...extraHeaders },
  })
}

// ── Request body validation → Anthropic user-message content ──────────────────
// Returns { error, status } or { content } (Messages API content blocks).
function validateAndBuildContent(body) {
  if (!body || typeof body !== 'object') {
    return { error: 'Invalid request body — expected JSON object.', status: 400 }
  }

  if (body.kind === 'text') {
    if (typeof body.text !== 'string' || body.text.trim() === '') {
      return { error: "For kind 'text', a non-empty 'text' string is required.", status: 400 }
    }
    if (new TextEncoder().encode(body.text).length > MAX_TEXT_BYTES) {
      return { error: `Text too large — maximum is ${Math.floor(MAX_TEXT_BYTES / 1024)}KB.`, status: 413 }
    }
    return {
      content: [
        { type: 'text', text: `Extract the golf shot/club data from the following pasted text:\n\n${body.text}` },
      ],
    }
  }

  if (body.kind === 'image') {
    if (typeof body.imageBase64 !== 'string' || body.imageBase64 === '') {
      return { error: "For kind 'image', a non-empty 'imageBase64' string is required.", status: 400 }
    }
    if (body.imageBase64.startsWith('data:')) {
      return { error: "'imageBase64' must be raw base64 data, not a data: URL.", status: 400 }
    }
    if (!SUPPORTED_IMAGE_TYPES.includes(body.mediaType)) {
      return { error: `'mediaType' must be one of: ${SUPPORTED_IMAGE_TYPES.join(', ')}.`, status: 400 }
    }
    if (body.imageBase64.length > MAX_IMAGE_BASE64_BYTES) {
      return { error: `Image too large — maximum base64 payload is ${Math.floor(MAX_IMAGE_BASE64_BYTES / (1024 * 1024))}MB.`, status: 413 }
    }
    return {
      content: [
        { type: 'image', source: { type: 'base64', media_type: body.mediaType, data: body.imageBase64 } },
        { type: 'text', text: 'Extract the golf shot/club data from this screenshot.' },
      ],
    }
  }

  return { error: "Invalid 'kind' — expected 'text' or 'image'.", status: 400 }
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS })
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS })
  }

  // ── 1. Authenticate the request ───────────────────────────────────────────
  const authHeader = req.headers.get('Authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (!token) {
    return jsonResponse({ error: 'Unauthorized — sign in required.' }, 401)
  }

  // Validate JWT with Supabase (cheap GET to /auth/v1/user)
  let userId = null
  const supabaseUrl        = process.env.SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (supabaseUrl && supabaseServiceKey) {
    try {
      const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'apikey': supabaseServiceKey,
        },
      })
      if (!userRes.ok) {
        return jsonResponse({ error: 'Invalid or expired session. Please sign in again.' }, 401)
      }
      const user = await userRes.json()
      userId = user.id
      // Verify session is at AAL2 (TOTP verified) by reading the aal claim
      // from the JWT itself — Supabase sets aal:'aal2' in the token payload
      // after mfa.verify() completes. Checking user.factors is wrong because
      // it only tells you factors exist, not that they were used this session.
      const jwtPayload = parseJwt(token)
      const sessionAal = jwtPayload?.aal || 'aal1'
      if (sessionAal !== 'aal2') {
        return jsonResponse({ error: 'Two-factor authentication required. Please complete MFA to import data.' }, 403)
      }
    } catch (e) {
      return jsonResponse({ error: 'Auth validation failed.' }, 500)
    }
  } else {
    // No Supabase configured — extract user from JWT payload (dev mode)
    const payload = parseJwt(token)
    userId = payload?.sub || 'dev-user'
    console.warn('[parse-import] Supabase not configured — skipping JWT validation (dev mode)')
  }

  // ── 2. Validate the request body (before consuming rate-limit budget) ─────
  let body
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body.' }, 400)
  }

  const built = validateAndBuildContent(body)
  if (built.error) {
    return jsonResponse({ error: built.error }, built.status)
  }

  // ── 3. Rate limit (separate pool from generate) ───────────────────────────
  const { allowed, used, recordId } = await checkAndRecordUsage(userId)
  if (!allowed) {
    return jsonResponse({
      error: `Daily limit reached (${DAILY_LIMIT} AI imports/day). Try again tomorrow.`,
      used,
      limit: DAILY_LIMIT,
    }, 429, { 'X-RateLimit-Limit': String(DAILY_LIMIT), 'X-RateLimit-Remaining': '0' })
  }

  // ── 4. Call Anthropic (request built server-side, structured output) ──────
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return jsonResponse({ error: 'ANTHROPIC_API_KEY not configured on server.' }, 500)
  }

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: built.content }],
        // Structured outputs: response text is guaranteed to be valid JSON
        // matching SESSION_SCHEMA.
        output_config: { format: { type: 'json_schema', schema: SESSION_SCHEMA } },
      }),
    })

    if (!upstream.ok) {
      let detail = ''
      try {
        const errJson = await upstream.json()
        detail = errJson?.error?.message || ''
      } catch { /* non-JSON upstream error */ }
      console.error(`[parse-import] Anthropic error ${upstream.status}: ${detail}`)
      return jsonResponse({ error: `AI extraction failed (upstream ${upstream.status}).${detail ? ` ${detail}` : ''}` }, 502)
    }

    const message = await upstream.json()

    if (message.stop_reason === 'refusal') {
      return jsonResponse({ error: 'The AI declined to process this input.' }, 422)
    }
    if (message.stop_reason === 'max_tokens') {
      return jsonResponse({ error: 'Input produced too much data to extract in one pass — try a smaller excerpt.' }, 422)
    }

    const textBlock = (message.content || []).find((b) => b.type === 'text')
    let parsed
    try {
      parsed = JSON.parse(textBlock?.text ?? '')
    } catch {
      return jsonResponse({ error: 'AI returned malformed data. Please try again.' }, 502)
    }

    // Schema-check the structured output — never trust the LLM response blindly.
    // validateNormalizedSession also strips any fields outside the schema.
    const validated = validateNormalizedSession(parsed)
    if (!validated.ok) {
      console.error(`[parse-import] schema validation failed: ${validated.error}`)
      return jsonResponse({ error: 'AI returned malformed data. Please try again.' }, 502)
    }
    const session = validated.session

    if (session.shots.length === 0) {
      const why = Array.isArray(session.warnings) && session.warnings.length > 0
        ? ` ${session.warnings.join(' ')}`
        : ''
      return jsonResponse({ error: `No shot data could be extracted from the input.${why}` }, 422)
    }

    // Persist token counts for the admin usage dashboard
    if (recordId && message.usage) {
      const supabaseUrl        = process.env.SUPABASE_URL
      const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
      if (supabaseUrl && supabaseServiceKey) {
        fetch(`${supabaseUrl}/rest/v1/api_usage?id=eq.${recordId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'apikey': supabaseServiceKey,
            'Authorization': `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            input_tokens:          message.usage.input_tokens                    ?? null,
            output_tokens:         message.usage.output_tokens                   ?? null,
            cache_read_tokens:     message.usage.cache_read_input_tokens          ?? null,
            cache_creation_tokens: message.usage.cache_creation_input_tokens      ?? null,
          }),
        }).catch(() => { /* non-fatal */ })
      }
    }

    return jsonResponse({ session }, 200, {
      'X-RateLimit-Limit':     String(DAILY_LIMIT),
      'X-RateLimit-Remaining': String(Math.max(0, DAILY_LIMIT - used)),
    })
  } catch (e) {
    return jsonResponse({ error: e.message }, 500)
  }
}
