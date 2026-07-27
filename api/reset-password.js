// Password-reset endpoint — sends a reset email via Supabase Auth.
// Does NOT directly change the password. The user clicks the link in the email
// to set a new password through the standard Supabase recovery flow.

export const config = { runtime: 'edge' }

import { checkRateLimit, getClientIP } from './_lib/rateLimit.js'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  process.env.ALLOWED_ORIGIN || '',
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

  let email
  try {
    ;({ email } = await req.json())
  } catch {
    return json({ error: 'Invalid request body' }, 400)
  }

  if (!email) return json({ error: 'Email is required' }, 400)

  // Rate limit: 5 attempts per 15 minutes per IP
  const clientIP = getClientIP(req)
  const { limited } = await checkRateLimit(supabaseUrl, supabaseServiceKey, {
    identifier: clientIP,
    endpoint: 'reset-password',
    maxAttempts: 5,
    windowMinutes: 15,
  })
  if (limited) return json({ error: 'Too many requests. Please try again later.' }, 429)

  // Send password reset email via Supabase Auth admin API.
  // This sends a link the user must click — it never directly changes the password.
  // We use the admin endpoint so the response is always the same whether or not
  // the email exists (prevents enumeration).
  try {
    await fetch(`${supabaseUrl}/auth/v1/recover`, {
      method: 'POST',
      headers: {
        apikey: supabaseServiceKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email }),
    })
  } catch {
    // Swallow errors — always return the same response
  }

  // Always return success to prevent email enumeration
  return json({ ok: true })
}
