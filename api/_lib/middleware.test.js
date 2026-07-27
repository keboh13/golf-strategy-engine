import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { corsHeaders, CORS_HEADERS, jsonResponse } from './middleware.js'

describe('corsHeaders', () => {
  it('defaults methods to POST, OPTIONS', () => {
    const h = corsHeaders()
    expect(h['Access-Control-Allow-Methods']).toBe('POST, OPTIONS')
  })

  it('accepts custom methods', () => {
    const h = corsHeaders('GET, POST, PATCH, DELETE, OPTIONS')
    expect(h['Access-Control-Allow-Methods']).toBe('GET, POST, PATCH, DELETE, OPTIONS')
  })

  it('always includes Content-Type and Authorization in allowed headers', () => {
    expect(corsHeaders()['Access-Control-Allow-Headers']).toBe('Content-Type, Authorization')
  })

  describe('origin', () => {
    const origEnv = process.env.ALLOWED_ORIGIN

    afterEach(() => {
      if (origEnv === undefined) delete process.env.ALLOWED_ORIGIN
      else process.env.ALLOWED_ORIGIN = origEnv
    })

    it('defaults origin to empty string when ALLOWED_ORIGIN is unset (fail-closed)', () => {
      delete process.env.ALLOWED_ORIGIN
      expect(corsHeaders()['Access-Control-Allow-Origin']).toBe('')
    })

    it('uses ALLOWED_ORIGIN env var when set', () => {
      process.env.ALLOWED_ORIGIN = 'https://my-app.vercel.app'
      expect(corsHeaders()['Access-Control-Allow-Origin']).toBe('https://my-app.vercel.app')
    })
  })
})

describe('CORS_HEADERS', () => {
  it('is the default corsHeaders() call', () => {
    expect(CORS_HEADERS['Access-Control-Allow-Methods']).toBe('POST, OPTIONS')
  })
})

describe('jsonResponse', () => {
  it('returns a Response with JSON body and correct status', async () => {
    const res = jsonResponse({ ok: true }, 200)
    expect(res).toBeInstanceOf(Response)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true })
  })

  it('sets Content-Type to application/json', () => {
    const res = jsonResponse({}, 200)
    expect(res.headers.get('Content-Type')).toBe('application/json')
  })

  it('includes CORS headers', () => {
    const res = jsonResponse({}, 200)
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS')
  })

  it('merges custom headers, overriding defaults', () => {
    const res = jsonResponse({}, 200, { 'X-Custom': 'test' })
    expect(res.headers.get('X-Custom')).toBe('test')
    expect(res.headers.get('Content-Type')).toBe('application/json')
  })

  it('serialises error bodies with correct status', async () => {
    const res = jsonResponse({ error: 'forbidden' }, 403)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('forbidden')
  })
})
