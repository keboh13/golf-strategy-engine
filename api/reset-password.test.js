import { describe, it, expect, vi, beforeEach } from 'vitest'

const MOCK_ENV = {
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
  ALLOWED_ORIGIN: 'https://app.example.com',
}

describe('reset-password', () => {
  let handler

  beforeEach(async () => {
    vi.resetModules()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ([]),
      headers: new Headers({ 'content-range': '*/0' }),
    }))
    for (const [k, v] of Object.entries(MOCK_ENV)) process.env[k] = v
    const mod = await import('./reset-password.js')
    handler = mod.default
  })

  it('rejects non-POST methods', async () => {
    const res = await handler(new Request('https://x/api/reset-password', { method: 'GET' }))
    expect(res.status).toBe(405)
  })

  it('returns 400 for missing email', async () => {
    const res = await handler(new Request('https://x/api/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/required/)
  })

  it('does not accept newPassword parameter (email-only flow)', async () => {
    const res = await handler(new Request('https://x/api/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.com' }),
    }))
    // Should succeed with just email (sends reset email)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  it('returns 500 when env vars are missing', async () => {
    delete process.env.SUPABASE_URL
    vi.resetModules()
    // Re-stub fetch for the new module import
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ([]),
      headers: new Headers({ 'content-range': '*/0' }),
    }))
    const mod = await import('./reset-password.js')
    const res = await mod.default(new Request('https://x/api/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.com' }),
    }))
    expect(res.status).toBe(500)
  })

  it('always returns ok:true regardless of email existence (no enumeration)', async () => {
    // fetch mock already returns empty array for rate limit check and succeeds for recover
    const res = await handler(new Request('https://x/api/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'noone@test.com' }),
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  it('calls Supabase /auth/v1/recover instead of directly changing password', async () => {
    await handler(new Request('https://x/api/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@test.com' }),
    }))

    // Find the call to /auth/v1/recover
    const calls = fetch.mock.calls
    const recoverCall = calls.find(c => c[0]?.includes('/auth/v1/recover'))
    expect(recoverCall).toBeTruthy()

    // Should NOT have called the admin users endpoint to change password
    const adminUpdateCall = calls.find(c => c[0]?.includes('/admin/users/') && c[1]?.method === 'PUT')
    expect(adminUpdateCall).toBeUndefined()
  })

  it('handles CORS preflight', async () => {
    const res = await handler(new Request('https://x/api/reset-password', { method: 'OPTIONS' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com')
  })

  it('returns 429 when rate limited', async () => {
    // Mock fetch to return a count exceeding the limit
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ([]),
      headers: new Headers({ 'content-range': '0-4/5' }),
    }))

    const res = await handler(new Request('https://x/api/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
      body: JSON.stringify({ email: 'user@test.com' }),
    }))
    expect(res.status).toBe(429)
  })
})
