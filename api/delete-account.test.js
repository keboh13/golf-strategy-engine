import { describe, it, expect, vi, beforeEach } from 'vitest'

const MOCK_ENV = {
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
  ALLOWED_ORIGIN: 'https://app.example.com',
}

describe('delete-account', () => {
  let handler

  beforeEach(async () => {
    vi.resetModules()
    vi.stubGlobal('fetch', vi.fn())
    for (const [k, v] of Object.entries(MOCK_ENV)) process.env[k] = v
    const mod = await import('./delete-account.js')
    handler = mod.default
  })

  it('rejects non-DELETE methods', async () => {
    const res = await handler(new Request('https://x/api/delete-account', { method: 'POST' }))
    expect(res.status).toBe(405)
  })

  it('returns 401 when no Authorization header', async () => {
    const res = await handler(new Request('https://x/api/delete-account', { method: 'DELETE' }))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toMatch(/Unauthorized/)
  })

  it('returns 401 when JWT is invalid', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 401 })

    const res = await handler(new Request('https://x/api/delete-account', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer bad-token' },
    }))
    expect(res.status).toBe(401)
  })

  it('returns 500 when env vars are missing', async () => {
    delete process.env.SUPABASE_URL
    vi.resetModules()
    const mod = await import('./delete-account.js')
    const res = await mod.default(new Request('https://x/api/delete-account', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer some-token' },
    }))
    expect(res.status).toBe(500)
  })

  it('deletes user data and auth account on valid token', async () => {
    const mockUserId = 'user-123'

    // /auth/v1/user — validate JWT
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: mockUserId }),
    })

    // 4x data table deletes (Promise.allSettled)
    fetch.mockResolvedValue({ ok: true })

    const res = await handler(new Request('https://x/api/delete-account', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer valid-token' },
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)

    // Should have called fetch: 1 (auth) + 4 (data) + 1 (admin delete) = 6
    expect(fetch.mock.calls.length).toBe(6)
    const deleteCall = fetch.mock.calls[5]
    expect(deleteCall[0]).toContain(`/auth/v1/admin/users/${mockUserId}`)
    expect(deleteCall[1].method).toBe('DELETE')
  })

  it('handles CORS preflight', async () => {
    const res = await handler(new Request('https://x/api/delete-account', { method: 'OPTIONS' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('DELETE')
  })
})
