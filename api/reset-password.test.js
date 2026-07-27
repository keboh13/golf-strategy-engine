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
    vi.stubGlobal('fetch', vi.fn())
    for (const [k, v] of Object.entries(MOCK_ENV)) process.env[k] = v
    const mod = await import('./reset-password.js')
    handler = mod.default
  })

  it('rejects non-POST methods', async () => {
    const res = await handler(new Request('https://x/api/reset-password', { method: 'GET' }))
    expect(res.status).toBe(405)
  })

  it('returns 400 for missing email or password', async () => {
    const res = await handler(new Request('https://x/api/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.com' }),
    }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/required/)
  })

  it('returns 400 for password under 8 chars', async () => {
    const res = await handler(new Request('https://x/api/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.com', newPassword: 'short' }),
    }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/8 characters/)
  })

  it('returns 500 when env vars are missing', async () => {
    delete process.env.SUPABASE_URL
    vi.resetModules()
    const mod = await import('./reset-password.js')
    const res = await mod.default(new Request('https://x/api/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.com', newPassword: 'longpassword' }),
    }))
    expect(res.status).toBe(500)
  })

  it('returns ok:true even when user not found (no email enumeration)', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ users: [] }),
    })

    const res = await handler(new Request('https://x/api/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'noone@test.com', newPassword: 'longpassword' }),
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  it('handles CORS preflight', async () => {
    const res = await handler(new Request('https://x/api/reset-password', { method: 'OPTIONS' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com')
  })
})
