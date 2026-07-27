import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { checkRateLimit, getClientIP } from './rateLimit.js'

describe('getClientIP', () => {
  it('extracts IP from x-forwarded-for header', () => {
    const req = { headers: new Headers({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }) }
    expect(getClientIP(req)).toBe('1.2.3.4')
  })

  it('extracts IP from x-real-ip header', () => {
    const req = { headers: new Headers({ 'x-real-ip': '10.0.0.1' }) }
    expect(getClientIP(req)).toBe('10.0.0.1')
  })

  it('prefers x-forwarded-for over x-real-ip', () => {
    const req = { headers: new Headers({ 'x-forwarded-for': '1.2.3.4', 'x-real-ip': '10.0.0.1' }) }
    expect(getClientIP(req)).toBe('1.2.3.4')
  })

  it('returns "unknown" when no IP headers present', () => {
    const req = { headers: new Headers() }
    expect(getClientIP(req)).toBe('unknown')
  })
})

describe('checkRateLimit', () => {
  const url = 'https://test.supabase.co'
  const key = 'test-service-key'

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns limited:false when under the limit', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => [],
      headers: new Headers({ 'content-range': '*/0' }),
    })

    const result = await checkRateLimit(url, key, {
      identifier: '1.2.3.4',
      endpoint: 'test-endpoint',
      maxAttempts: 5,
      windowMinutes: 15,
    })
    expect(result.limited).toBe(false)
    expect(result.remaining).toBe(4)
  })

  it('returns limited:true when at the limit', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => [],
      headers: new Headers({ 'content-range': '0-4/5' }),
    })

    const result = await checkRateLimit(url, key, {
      identifier: '1.2.3.4',
      endpoint: 'test-endpoint',
      maxAttempts: 5,
      windowMinutes: 15,
    })
    expect(result.limited).toBe(true)
    expect(result.remaining).toBe(0)
  })

  it('records usage attempt by POSTing to api_usage', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => [],
      headers: new Headers({ 'content-range': '*/2' }),
    })

    await checkRateLimit(url, key, {
      identifier: '1.2.3.4',
      endpoint: 'test-endpoint',
      maxAttempts: 5,
      windowMinutes: 15,
    })

    // Second call should be the POST to record the attempt
    const postCall = fetch.mock.calls.find(c => c[1]?.method === 'POST')
    expect(postCall).toBeTruthy()
    const body = JSON.parse(postCall[1].body)
    expect(body.identifier).toBe('1.2.3.4')
    expect(body.endpoint).toBe('test-endpoint')
  })

  it('fails open when fetch throws (allows request)', async () => {
    fetch.mockRejectedValue(new Error('network error'))

    const result = await checkRateLimit(url, key, {
      identifier: '1.2.3.4',
      endpoint: 'test-endpoint',
      maxAttempts: 5,
      windowMinutes: 15,
    })
    expect(result.limited).toBe(false)
  })

  it('falls back to counting JSON rows when content-range header is missing', async () => {
    fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 1 }, { id: 2 }, { id: 3 }],
        headers: new Headers(),
      })
      .mockResolvedValue({ ok: true })

    const result = await checkRateLimit(url, key, {
      identifier: '1.2.3.4',
      endpoint: 'test-endpoint',
      maxAttempts: 5,
      windowMinutes: 15,
    })
    expect(result.limited).toBe(false)
    expect(result.remaining).toBe(1) // 5 - 3 - 1
  })
})
