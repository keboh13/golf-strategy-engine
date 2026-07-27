import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { validateAuth, isAdminUser } from './admin.js'

describe('validateAuth', () => {
  const origUrl = process.env.SUPABASE_URL
  const origKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  beforeEach(() => {
    process.env.SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key'
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (origUrl === undefined) delete process.env.SUPABASE_URL
    else process.env.SUPABASE_URL = origUrl
    if (origKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY
    else process.env.SUPABASE_SERVICE_ROLE_KEY = origKey
  })

  it('returns null when no Authorization header', async () => {
    const req = { headers: new Headers() }
    expect(await validateAuth(req)).toBeNull()
  })

  it('returns null for non-Bearer auth', async () => {
    const req = { headers: new Headers({ Authorization: 'Basic abc' }) }
    expect(await validateAuth(req)).toBeNull()
  })

  it('returns null when supabase env vars are missing (no dev-user fallback)', async () => {
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    const req = { headers: new Headers({ Authorization: 'Bearer some-token' }) }
    expect(await validateAuth(req)).toBeNull()
  })

  it('returns user id on successful auth', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'user-123' }),
    }))
    const req = { headers: new Headers({ Authorization: 'Bearer valid-token' }) }
    expect(await validateAuth(req)).toBe('user-123')
  })

  it('returns null when supabase returns non-ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    const req = { headers: new Headers({ Authorization: 'Bearer bad-token' }) }
    expect(await validateAuth(req)).toBeNull()
  })

  it('returns null when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')))
    const req = { headers: new Headers({ Authorization: 'Bearer any' }) }
    expect(await validateAuth(req)).toBeNull()
  })
})

describe('isAdminUser', () => {
  const origUrl = process.env.SUPABASE_URL
  const origKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  beforeEach(() => {
    process.env.SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key'
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (origUrl === undefined) delete process.env.SUPABASE_URL
    else process.env.SUPABASE_URL = origUrl
    if (origKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY
    else process.env.SUPABASE_SERVICE_ROLE_KEY = origKey
  })

  it('returns false for falsy userId', async () => {
    expect(await isAdminUser(null)).toBe(false)
    expect(await isAdminUser('')).toBe(false)
    expect(await isAdminUser(undefined)).toBe(false)
  })

  it('returns false for dev-user (no special treatment)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    }))
    expect(await isAdminUser('dev-user')).toBe(false)
  })

  it('returns false when supabase env vars are missing', async () => {
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    expect(await isAdminUser('real-user')).toBe(false)
  })

  it('returns true when user is in admins table', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url) => {
      if (url.includes('/admins?')) return Promise.resolve({ ok: true, json: () => Promise.resolve([{ user_id: 'u1' }]) })
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
    }))
    expect(await isAdminUser('u1')).toBe(true)
  })

  it('returns true when user has admin role in user_roles table', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url) => {
      if (url.includes('/user_roles?')) return Promise.resolve({ ok: true, json: () => Promise.resolve([{ user_id: 'u2' }]) })
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
    }))
    expect(await isAdminUser('u2')).toBe(true)
  })

  it('returns true when user is in both tables', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([{ user_id: 'u3' }]),
    }))
    expect(await isAdminUser('u3')).toBe(true)
  })

  it('returns false when user is in neither table', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    }))
    expect(await isAdminUser('nobody')).toBe(false)
  })

  it('returns false when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')))
    expect(await isAdminUser('u1')).toBe(false)
  })

  it('handles non-ok responses gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.reject(new Error('should not be called')),
    }))
    expect(await isAdminUser('u1')).toBe(false)
  })
})
