// Shared rate-limiting helper for Edge Function endpoints.
// Uses the Supabase `api_usage` table to track attempts per identifier+endpoint
// within a sliding window. Edge functions have no persistent in-memory state
// across invocations, so DB-backed counting is the only reliable approach.

/**
 * Check whether the caller has exceeded the rate limit for a given endpoint.
 *
 * @param {string} supabaseUrl   - SUPABASE_URL env var
 * @param {string} serviceKey    - SUPABASE_SERVICE_ROLE_KEY env var
 * @param {object} opts
 * @param {string} opts.identifier   - IP address, user ID, or email
 * @param {string} opts.endpoint     - logical endpoint name (e.g. 'reset-password')
 * @param {number} opts.maxAttempts  - max requests allowed in the window
 * @param {number} opts.windowMinutes - sliding window size in minutes
 * @returns {Promise<{ limited: boolean, remaining: number }>}
 */
export async function checkRateLimit(supabaseUrl, serviceKey, { identifier, endpoint, maxAttempts, windowMinutes }) {
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  }
  const base = `${supabaseUrl}/rest/v1`
  const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString()

  // Count recent rows for this identifier + endpoint
  try {
    const countRes = await fetch(
      `${base}/api_usage?identifier=eq.${encodeURIComponent(identifier)}&endpoint=eq.${encodeURIComponent(endpoint)}&created_at=gte.${encodeURIComponent(windowStart)}&select=id`,
      { headers: { ...headers, Prefer: 'count=exact' } }
    )
    // Supabase returns the count in the content-range header
    const contentRange = countRes.headers.get('content-range')
    let count = 0
    if (contentRange) {
      // Format: "0-N/total" or "*/total"
      const match = contentRange.match(/\/(\d+)$/)
      if (match) count = parseInt(match[1], 10)
    } else if (countRes.ok) {
      const rows = await countRes.json()
      count = Array.isArray(rows) ? rows.length : 0
    }

    if (count >= maxAttempts) {
      return { limited: true, remaining: 0 }
    }

    // Record this attempt
    await fetch(`${base}/api_usage`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        identifier,
        endpoint,
        created_at: new Date().toISOString(),
      }),
    })

    return { limited: false, remaining: maxAttempts - count - 1 }
  } catch {
    // If rate-limit check fails, allow the request (fail-open for availability)
    // but log the error. In production, monitoring should catch this.
    return { limited: false, remaining: maxAttempts }
  }
}

/**
 * Extract the caller's IP from Edge request headers.
 * Falls back to 'unknown' if no forwarding headers are present.
 */
export function getClientIP(req) {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  )
}
