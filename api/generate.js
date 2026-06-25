// Vercel Edge Function — proxies Claude API requests server-side
// Set these in Vercel project environment variables (not in .env):
//   ANTHROPIC_API_KEY        — your Anthropic key
//   SUPABASE_URL             — from Supabase project settings
//   SUPABASE_SERVICE_ROLE_KEY — from Supabase project settings (secret, never expose to browser)
//   RATE_LIMIT_PER_DAY       — optional, defaults to 20

import { findPhaseMarkers, recordPhaseDurations } from '../src/lib/generationPhases.js'

export const config = { runtime: 'edge' }

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  process.env.ALLOWED_ORIGIN || '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const DAILY_LIMIT = parseInt(process.env.RATE_LIMIT_PER_DAY || '20', 10)

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

// ── Rate limiting via Supabase REST API ───────────────────────────────────────
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

  // Count recent requests
  const countRes = await fetch(
    `${base}/api_usage?user_id=eq.${userId}&endpoint=eq.generate&used_at=gte.${encodeURIComponent(windowStart)}&select=id`,
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
    body: JSON.stringify({ user_id: userId, endpoint: 'generate', used_at: new Date().toISOString() }),
  })
  let recordId = null
  if (insertRes.ok) {
    const rows = await insertRes.json()
    recordId = Array.isArray(rows) ? (rows[0]?.id ?? null) : null
  }

  return { allowed: true, used: count + 1, recordId }
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
    return new Response(JSON.stringify({ error: 'Unauthorized — sign in required.' }), {
      status: 401,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
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
        return new Response(JSON.stringify({ error: 'Invalid or expired session. Please sign in again.' }), {
          status: 401,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
      const user = await userRes.json()
      userId = user.id
      // 2FA is optional — valid session (aal1 or aal2) is sufficient.
      // Rate limiting (RATE_LIMIT_PER_DAY) covers abuse; admin panel shows usage per account.
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Auth validation failed.' }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }
  } else {
    // No Supabase configured — extract user from JWT payload (dev mode)
    const payload = parseJwt(token)
    userId = payload?.sub || 'dev-user'
    console.warn('[generate] Supabase not configured — skipping JWT validation (dev mode)')
  }

  // ── 2. Rate limit ─────────────────────────────────────────────────────────
  const { allowed, used, recordId } = await checkAndRecordUsage(userId)
  if (!allowed) {
    return new Response(JSON.stringify({
      error: `Daily limit reached (${DAILY_LIMIT} AI plans/day). Try again tomorrow.`,
      used,
      limit: DAILY_LIMIT,
    }), {
      status: 429,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'X-RateLimit-Limit': String(DAILY_LIMIT), 'X-RateLimit-Remaining': '0' },
    })
  }

  // ── 3. Proxy to Anthropic ─────────────────────────────────────────────────
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured on server.' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  try {
    const body = await req.json()

    // ── 3.5. Capture the prompt for audit logging (rec_log) ─────────────────
    let promptText = ''
    try {
      for (const m of (Array.isArray(body.messages) ? body.messages : [])) {
        if (m.role !== 'user') continue
        if (typeof m.content === 'string') promptText += m.content
        else if (Array.isArray(m.content)) {
          for (const b of m.content) if (b?.type === 'text' && typeof b.text === 'string') promptText += b.text
        }
      }
    } catch { /* non-fatal */ }
    const courseKey = typeof body.course_key === 'string' ? body.course_key : null
    // sha256 of prompt — used for dedupe/replays. Use Web Crypto (edge supports it).
    let promptHash = ''
    try {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(promptText))
      promptHash = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
    } catch { /* non-fatal */ }

    const ALLOWED_MODELS = ['claude-sonnet-4-6', 'claude-sonnet-4-5-20250514', 'claude-haiku-4-5-20251001']
    const sanitized = {
      model: ALLOWED_MODELS.includes(body.model) ? body.model : ALLOWED_MODELS[0],
      max_tokens: Math.min(Math.max(parseInt(body.max_tokens) || 8000, 100), 32000),
      stream: body.stream === true,
      messages: Array.isArray(body.messages) ? body.messages.map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: typeof m.content === 'string' ? m.content
          : Array.isArray(m.content) ? m.content.filter(b => b.type === 'text').map(b => ({
              type: 'text',
              text: typeof b.text === 'string' ? b.text : '',
              ...(b.cache_control ? { cache_control: { type: 'ephemeral' } } : {}),
            }))
          : '',
      })) : [],
    }
    if (body.tools && Array.isArray(body.tools)) {
      sanitized.tools = body.tools.filter(t =>
        t.type === 'web_search_20250305' && t.name === 'web_search'
      )
      if (!sanitized.tools.length) delete sanitized.tools
    }

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31',
      },
      body: JSON.stringify(sanitized),
    })

    if (!upstream.ok) {
      return new Response(upstream.body, {
        status: upstream.status,
        headers: { ...CORS_HEADERS, 'Content-Type': upstream.headers.get('Content-Type') || 'application/json' },
      })
    }

    // Stream the response to the client while intercepting SSE events to capture token usage.
    // We write all chunks through first, then PATCH the usage record before closing the stream.
    const { readable, writable } = new TransformStream()
    const writer = writable.getWriter()
    const decoder = new TextDecoder()
    const supabaseUrl        = process.env.SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    ;(async () => {
      let buf = ''
      let responseText = ''
      let inputTokens = 0, outputTokens = 0, cacheReadTokens = 0, cacheCreationTokens = 0
      // Phase tracker (Part 0.2 + 0.4 of the optimization plan). We watch the
      // assembled responseText for `[[PHASE: id]]` markers and stamp first-
      // appearance wall-clock for each; phase_durations lands on rec_log.
      const streamStartedAt = Date.now()
      const seenMarkers = new Set()
      const markerTimestamps = []
      const reader = upstream.body.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          await writer.write(value)
          buf += decoder.decode(value, { stream: true })
          const lines = buf.split('\n')
          buf = lines.pop()
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            try {
              const j = JSON.parse(line.slice(6))
              if (j.type === 'message_start' && j.message?.usage) {
                inputTokens        = j.message.usage.input_tokens                   || 0
                cacheReadTokens    = j.message.usage.cache_read_input_tokens         || 0
                cacheCreationTokens = j.message.usage.cache_creation_input_tokens    || 0
              }
              if (j.type === 'content_block_delta' && j.delta?.text) {
                responseText += j.delta.text
                // Cheap incremental check — only inspect the marker ids we've
                // accumulated so far; the per-marker Set dedupes.
                for (const id of findPhaseMarkers(responseText)) {
                  if (seenMarkers.has(id)) continue
                  seenMarkers.add(id)
                  markerTimestamps.push({ id, ts: Date.now() })
                }
              }
              if (j.type === 'message_delta' && j.usage) {
                outputTokens = j.usage.output_tokens || 0
              }
            } catch { /* non-JSON SSE line */ }
          }
        }
      } finally {
        // Roll up per-phase wall-clock now that the stream has closed (or
        // errored). Both api_usage and rec_log receive the same object so the
        // admin Usage tab can pivot on either table later.
        const phaseDurations = recordPhaseDurations({
          startedAt: streamStartedAt,
          endedAt: Date.now(),
          markers: markerTimestamps,
        })
        // Persist token counts before closing so the admin panel can surface them
        if (recordId && supabaseUrl && supabaseServiceKey) {
          await fetch(`${supabaseUrl}/rest/v1/api_usage?id=eq.${recordId}`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'apikey': supabaseServiceKey,
              'Authorization': `Bearer ${supabaseServiceKey}`,
            },
            body: JSON.stringify({
              input_tokens: inputTokens,
              output_tokens: outputTokens,
              cache_read_tokens: cacheReadTokens,
              cache_creation_tokens: cacheCreationTokens,
              phase_durations: phaseDurations,
            }),
          }).catch(() => { /* non-fatal */ })
        }
        // ── Log full prompt + response to rec_log for replay/audit ────────
        if (supabaseUrl && supabaseServiceKey && promptText) {
          await fetch(`${supabaseUrl}/rest/v1/rec_log`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': supabaseServiceKey,
              'Authorization': `Bearer ${supabaseServiceKey}`,
            },
            body: JSON.stringify({
              user_id: userId === 'dev-user' ? null : userId,
              course_key: courseKey,
              model: sanitized.model,
              prompt: promptText,
              prompt_hash: promptHash,
              response: responseText,
              input_tokens: inputTokens,
              output_tokens: outputTokens,
              phase_durations: phaseDurations,
            }),
          }).catch((e) => { console.warn('[rec_log] insert failed:', e?.message) })
        }
        writer.close()
      }
    })()

    return new Response(readable, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': upstream.headers.get('Content-Type') || 'text/event-stream',
        'X-RateLimit-Limit':     String(DAILY_LIMIT),
        'X-RateLimit-Remaining': String(Math.max(0, DAILY_LIMIT - used)),
      },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }
}
