import { describe, it, expect, vi, beforeEach } from 'vitest'

const MOCK_ENV = {
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
  ALLOWED_ORIGIN: 'https://app.example.com',
}

describe('consume-invite', () => {
  let handler

  beforeEach(async () => {
    vi.resetModules()
    vi.stubGlobal('fetch', vi.fn())
    for (const [k, v] of Object.entries(MOCK_ENV)) process.env[k] = v
    const mod = await import('./consume-invite.js')
    handler = mod.default
  })

  it('GET returns 400 without token param', async () => {
    const res = await handler(new Request('https://x/api/consume-invite', { method: 'GET' }))
    expect(res.status).toBe(400)
  })

  it('GET returns 404 when invite not found', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    })
    const res = await handler(new Request('https://x/api/consume-invite?token=abc', { method: 'GET' }))
    expect(res.status).toBe(404)
  })

  it('GET returns 410 for consumed invite', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ email: 'a@b.com', role: 'viewer', profile_name: 'A', consumed_at: '2024-01-01' }],
    })
    const res = await handler(new Request('https://x/api/consume-invite?token=abc', { method: 'GET' }))
    expect(res.status).toBe(410)
  })

  it('GET returns invite details for valid token', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ email: 'a@b.com', role: 'editor', profile_name: 'Alice', consumed_at: null, expires_at: null }],
    })
    const res = await handler(new Request('https://x/api/consume-invite?token=abc', { method: 'GET' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.email).toBe('a@b.com')
    expect(body.role).toBe('editor')
  })

  it('POST returns 401 without Authorization header', async () => {
    const res = await handler(new Request('https://x/api/consume-invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'abc' }),
    }))
    expect(res.status).toBe(401)
  })

  it('POST returns 401 with invalid JWT', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 401 })

    const res = await handler(new Request('https://x/api/consume-invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer bad' },
      body: JSON.stringify({ token: 'abc' }),
    }))
    expect(res.status).toBe(401)
  })

  it('rejects unsupported methods', async () => {
    const res = await handler(new Request('https://x/api/consume-invite', { method: 'PUT' }))
    expect(res.status).toBe(405)
  })

  it('handles CORS preflight', async () => {
    const res = await handler(new Request('https://x/api/consume-invite', { method: 'OPTIONS' }))
    expect(res.status).toBe(200)
  })
})
