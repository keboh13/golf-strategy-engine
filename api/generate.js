// Vercel Edge Function — proxies Claude API requests server-side
// Set these in Vercel project environment variables (not in .env):
//   ANTHROPIC_API_KEY        — your Anthropic key
//   SUPABASE_URL             — from Supabase project settings
//   SUPABASE_SERVICE_ROLE_KEY — from Supabase project settings (secret, never expose to browser)
//   RATE_LIMIT_PER_DAY       — optional, defaults to 20

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
    // Rate limiting not configured — allow request but warn
    console.warn('[rate-limit] Supabase env vars missing, skipping rate limit check')
    return { allowed: true, used: 0 }
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
    `${base}/api_usage?user_id=eq.${userId}&used_at=gte.${encodeURIComponent(windowStart)}&select=id`,
    { headers: { ...headers, 'Prefer': 'count=exact' } }
  )
  const count = parseInt(countRes.headers.get('Content-Range')?.split('/')[1] || '0', 10)

  if (count >= DAILY_LIMIT) {
    return { allowed: false, used: count }
  }

  // Record this request
  await fetch(`${base}/api_usage`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ user_id: userId, endpoint: 'generate', used_at: new Date().toISOString() }),
  })

  return { allowed: true, used: count + 1 }
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
      // Verify session is at AAL2 (TOTP verified) by reading the aal claim
      // from the JWT itself — Supabase sets aal:'aal2' in the token payload
      // after mfa.verify() completes. Checking user.factors is wrong because
      // it only tells you factors exist, not that they were used this session.
      const jwtPayload = parseJwt(token)
      const sessionAal = jwtPayload?.aal || 'aal1'
      if (sessionAal !== 'aal2') {
        return new Response(JSON.stringify({ error: 'Two-factor authentication required. Please complete MFA to generate a plan.' }), {
          status: 403,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
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
  const { allowed, used } = await checkAndRecordUsage(userId)
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
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31',
      },
      body: JSON.stringify(body),
    })

    return new Response(upstream.body, {
      status: upstream.status,
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
