// Node-environment tests for the AI import client helper.
// No jsdom, no real network — fetch is stubbed for parseImportWithAI tests.
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  targetDimensions,
  buildRequestBody,
  validateNormalizedSession,
  parseImportWithAI,
  MAX_TEXT_BYTES,
  MAX_IMAGE_BASE64_BYTES,
  MAX_IMAGE_EDGE,
  SUPPORTED_IMAGE_TYPES,
} from './aiImport.js'

describe('targetDimensions', () => {
  it('keeps small images unchanged (no upscale)', () => {
    expect(targetDimensions(800, 600)).toEqual({ width: 800, height: 600 })
  })

  it('keeps images exactly at the max edge unchanged', () => {
    expect(targetDimensions(MAX_IMAGE_EDGE, 900)).toEqual({ width: MAX_IMAGE_EDGE, height: 900 })
    expect(targetDimensions(700, MAX_IMAGE_EDGE)).toEqual({ width: 700, height: MAX_IMAGE_EDGE })
  })

  it('downscales landscape images so the width hits the max edge', () => {
    const { width, height } = targetDimensions(3000, 2000)
    expect(width).toBe(MAX_IMAGE_EDGE)
    expect(height).toBe(Math.round(2000 * (MAX_IMAGE_EDGE / 3000))) // 1045
  })

  it('downscales portrait images so the height hits the max edge', () => {
    const { width, height } = targetDimensions(1080, 2340)
    expect(height).toBe(MAX_IMAGE_EDGE)
    expect(width).toBe(Math.round(1080 * (MAX_IMAGE_EDGE / 2340))) // 724
  })

  it('downscales square images to maxEdge on both sides', () => {
    expect(targetDimensions(4000, 4000)).toEqual({ width: MAX_IMAGE_EDGE, height: MAX_IMAGE_EDGE })
  })

  it('preserves aspect ratio within rounding error', () => {
    const { width, height } = targetDimensions(5120, 1440)
    expect(width / height).toBeCloseTo(5120 / 1440, 1)
  })

  it('honors a custom maxEdge', () => {
    expect(targetDimensions(2000, 1000, 500)).toEqual({ width: 500, height: 250 })
    expect(targetDimensions(400, 300, 500)).toEqual({ width: 400, height: 300 }) // still no upscale
  })

  it('never returns dimensions below 1', () => {
    const { width, height } = targetDimensions(10000, 2)
    expect(width).toBe(MAX_IMAGE_EDGE)
    expect(height).toBe(1)
  })

  it('rounds fractional input dimensions when no scaling is needed', () => {
    expect(targetDimensions(800.4, 600.6)).toEqual({ width: 800, height: 601 })
  })

  it('throws on non-positive or non-finite dimensions', () => {
    expect(() => targetDimensions(0, 100)).toThrow()
    expect(() => targetDimensions(100, -5)).toThrow()
    expect(() => targetDimensions(NaN, 100)).toThrow()
    expect(() => targetDimensions(Infinity, 100)).toThrow()
  })
})

describe('buildRequestBody — text', () => {
  it('builds a text body', () => {
    expect(buildRequestBody({ text: '7i 165 yds carry' }))
      .toEqual({ kind: 'text', text: '7i 165 yds carry' })
  })

  it('passes the text through unmodified (no trimming)', () => {
    expect(buildRequestBody({ text: '  Driver 250  ' }).text).toBe('  Driver 250  ')
  })

  it('rejects empty or whitespace-only text', () => {
    expect(() => buildRequestBody({ text: '' })).toThrow(/text/)
    expect(() => buildRequestBody({ text: '   \n ' })).toThrow(/text/)
  })

  it('rejects non-string text', () => {
    expect(() => buildRequestBody({ text: 42 })).toThrow(/text/)
  })

  it('accepts text up to the size limit and rejects above it', () => {
    expect(buildRequestBody({ text: 'a'.repeat(MAX_TEXT_BYTES) }).kind).toBe('text')
    expect(() => buildRequestBody({ text: 'a'.repeat(MAX_TEXT_BYTES + 1) })).toThrow(/too large/)
  })

  it('measures the size limit in bytes, not characters', () => {
    // '€' is 3 bytes in UTF-8 — char count is under the limit, byte count is over
    const text = '€'.repeat(Math.floor(MAX_TEXT_BYTES / 3) + 1)
    expect(text.length).toBeLessThan(MAX_TEXT_BYTES)
    expect(() => buildRequestBody({ text })).toThrow(/too large/)
  })
})

describe('buildRequestBody — image', () => {
  const b64 = 'aGVsbG8gd29ybGQ='

  it('builds an image body for each supported media type', () => {
    for (const mediaType of SUPPORTED_IMAGE_TYPES) {
      expect(buildRequestBody({ imageBase64: b64, mediaType }))
        .toEqual({ kind: 'image', imageBase64: b64, mediaType })
    }
  })

  it('rejects unsupported media types', () => {
    expect(() => buildRequestBody({ imageBase64: b64, mediaType: 'image/gif' })).toThrow(/mediaType/)
    expect(() => buildRequestBody({ imageBase64: b64, mediaType: undefined })).toThrow(/mediaType/)
  })

  it('rejects empty or non-string base64 payloads', () => {
    expect(() => buildRequestBody({ imageBase64: '', mediaType: 'image/jpeg' })).toThrow()
    expect(() => buildRequestBody({ imageBase64: 1234, mediaType: 'image/jpeg' })).toThrow()
  })

  it('rejects data: URLs — payload must be raw base64', () => {
    expect(() => buildRequestBody({ imageBase64: `data:image/jpeg;base64,${b64}`, mediaType: 'image/jpeg' }))
      .toThrow(/data:/)
  })

  it('rejects base64 payloads above the size limit', () => {
    expect(() => buildRequestBody({ imageBase64: 'A'.repeat(MAX_IMAGE_BASE64_BYTES + 1), mediaType: 'image/jpeg' }))
      .toThrow(/too large/)
  })

  it('prefers the image branch when both image and text are present', () => {
    expect(buildRequestBody({ imageBase64: b64, mediaType: 'image/png', text: 'ignored' }).kind).toBe('image')
  })
})

describe('buildRequestBody — invalid input', () => {
  it('rejects missing or non-object input', () => {
    expect(() => buildRequestBody()).toThrow()
    expect(() => buildRequestBody(null)).toThrow()
    expect(() => buildRequestBody('7i 165')).toThrow()
  })

  it('rejects an object with neither text nor image', () => {
    expect(() => buildRequestBody({})).toThrow(/either text or imageBase64/)
  })
})

// ── validateNormalizedSession ─────────────────────────────────────────────────

function makeShot(overrides = {}) {
  return {
    clubKey: '7i',
    clubLabel: '7 Iron',
    carryYds: 165.3,
    totalYds: 172.1,
    offlineYds: -4.2,
    ballSpeedMph: 118.5,
    clubSpeedMph: 84.1,
    launchDeg: 17.8,
    spinRpm: 6400,
    apexFt: 92.4,
    timestamp: '2026-06-01T14:32:00Z',
    ...overrides,
  }
}

function makeSession(overrides = {}) {
  return {
    source: 'ai-import',
    sessionDate: '2026-06-01',
    unitsDetected: 'yards',
    shots: [makeShot()],
    warnings: [],
    ...overrides,
  }
}

describe('validateNormalizedSession', () => {
  it('accepts a fully populated valid session', () => {
    const result = validateNormalizedSession(makeSession())
    expect(result.ok).toBe(true)
    expect(result.session).toEqual(makeSession())
  })

  it('accepts null sessionDate, null metrics, null timestamp, and empty shots', () => {
    const session = makeSession({
      sessionDate: null,
      unitsDetected: 'unknown',
      shots: [makeShot({ carryYds: null, spinRpm: null, timestamp: null })],
      warnings: ['Could not read spin'],
    })
    const result = validateNormalizedSession(session)
    expect(result.ok).toBe(true)
    expect(result.session.shots[0].carryYds).toBeNull()
    expect(result.session.shots[0].timestamp).toBeNull()
  })

  it('treats missing nullable shot fields as null', () => {
    const shot = { clubKey: 'driver', clubLabel: 'Driver', carryYds: 250 }
    const result = validateNormalizedSession(makeSession({ shots: [shot] }))
    expect(result.ok).toBe(true)
    expect(result.session.shots[0]).toEqual({
      clubKey: 'driver', clubLabel: 'Driver', carryYds: 250,
      totalYds: null, offlineYds: null, ballSpeedMph: null, clubSpeedMph: null,
      launchDeg: null, spinRpm: null, apexFt: null, timestamp: null,
    })
  })

  it('strips fields outside the schema from the session and from shots', () => {
    const session = makeSession({ injected: 'evil' })
    session.shots[0].__proto__pollution = 'evil'
    const result = validateNormalizedSession(session)
    expect(result.ok).toBe(true)
    expect(result.session).not.toHaveProperty('injected')
    expect(result.session.shots[0]).not.toHaveProperty('__proto__pollution')
  })

  it('rejects non-object input', () => {
    for (const bad of [null, undefined, 'x', 42, []]) {
      expect(validateNormalizedSession(bad).ok).toBe(false)
    }
  })

  it("rejects a session whose source is not 'ai-import'", () => {
    const result = validateNormalizedSession(makeSession({ source: 'csv' }))
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/source/)
  })

  it('rejects a malformed sessionDate', () => {
    expect(validateNormalizedSession(makeSession({ sessionDate: 'June 1' })).ok).toBe(false)
    expect(validateNormalizedSession(makeSession({ sessionDate: 20260601 })).ok).toBe(false)
  })

  it('rejects an invalid unitsDetected value', () => {
    const result = validateNormalizedSession(makeSession({ unitsDetected: 'feet' }))
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/unitsDetected/)
  })

  it('rejects non-array shots and non-object shot entries', () => {
    expect(validateNormalizedSession(makeSession({ shots: 'none' })).ok).toBe(false)
    expect(validateNormalizedSession(makeSession({ shots: ['7i 165'] })).ok).toBe(false)
  })

  it('rejects shots with missing or empty clubKey/clubLabel', () => {
    expect(validateNormalizedSession(makeSession({ shots: [makeShot({ clubKey: '' })] })).ok).toBe(false)
    expect(validateNormalizedSession(makeSession({ shots: [makeShot({ clubLabel: 7 })] })).ok).toBe(false)
  })

  it('rejects non-finite or non-numeric metric values', () => {
    for (const bad of ['165', NaN, Infinity, {}]) {
      const result = validateNormalizedSession(makeSession({ shots: [makeShot({ carryYds: bad })] }))
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/carryYds/)
    }
  })

  it('rejects malformed warnings', () => {
    expect(validateNormalizedSession(makeSession({ warnings: 'oops' })).ok).toBe(false)
    expect(validateNormalizedSession(makeSession({ warnings: [42] })).ok).toBe(false)
  })

  it('reports the index of the offending shot', () => {
    const result = validateNormalizedSession(makeSession({ shots: [makeShot(), makeShot({ launchDeg: 'high' })] }))
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/shots\[1\]\.launchDeg/)
  })

  it('rejects unparseable timestamps', () => {
    const result = validateNormalizedSession(makeSession({ shots: [makeShot({ timestamp: 'not-a-date' })] }))
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/timestamp/)
  })

  it('drops shots with too many out-of-range fields', () => {
    const insane = makeShot({ carryYds: 1500, ballSpeedMph: 500 })
    const sane = makeShot()
    const result = validateNormalizedSession(makeSession({ shots: [insane, sane, sane, sane, sane] }))
    expect(result.ok).toBe(true)
    expect(result.session.shots.length).toBe(4)        // insane shot dropped
    expect(result.session.warnings.some(w => /Rejected/.test(w))).toBe(true)
  })

  it('warns but keeps a shot with one out-of-range field', () => {
    const result = validateNormalizedSession(makeSession({
      shots: [makeShot({ apexFt: 999 })],            // only apex bad
    }))
    expect(result.ok).toBe(true)
    expect(result.session.shots.length).toBe(1)
    expect(result.session.warnings.some(w => /out of range/.test(w))).toBe(true)
  })

  it('rejects the whole session when >25% of shots fail semantic checks', () => {
    const insane = makeShot({ carryYds: 1500, ballSpeedMph: 500 })
    const sane = makeShot()
    const result = validateNormalizedSession(makeSession({ shots: [insane, insane, sane] }))
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/out-of-range/)
  })
})

// ── parseImportWithAI (network mocked) ────────────────────────────────────────

describe('parseImportWithAI', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubFetch(status, body) {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('POSTs the text body with the bearer token and returns the validated session', async () => {
    const fetchMock = stubFetch(200, { session: makeSession() })
    const session = await parseImportWithAI({ text: '7i 165 yds carry', accessToken: 'tok-123' })

    expect(session).toEqual(makeSession())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/parse-import')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer tok-123')
    expect(JSON.parse(init.body)).toEqual({ kind: 'text', text: '7i 165 yds carry' })
  })

  it('throws without an access token and never hits the network', async () => {
    const fetchMock = stubFetch(200, { session: makeSession() })
    await expect(parseImportWithAI({ text: '7i 165' })).rejects.toThrow(/Sign in required/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces the server error message on non-OK responses', async () => {
    stubFetch(429, { error: 'Daily limit reached (10 AI imports/day). Try again tomorrow.' })
    await expect(parseImportWithAI({ text: '7i 165', accessToken: 't' }))
      .rejects.toThrow(/Daily limit reached/)
  })

  it('falls back to a status-based message when the error body is not JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => { throw new SyntaxError('not json') },
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(parseImportWithAI({ text: '7i 165', accessToken: 't' }))
      .rejects.toThrow(/HTTP 502/)
  })

  it('rejects a 200 response with a missing session', async () => {
    stubFetch(200, {})
    await expect(parseImportWithAI({ text: '7i 165', accessToken: 't' }))
      .rejects.toThrow(/malformed server response/)
  })

  it('rejects a 200 response whose session fails schema validation', async () => {
    stubFetch(200, { session: makeSession({ unitsDetected: 'furlongs' }) })
    await expect(parseImportWithAI({ text: '7i 165', accessToken: 't' }))
      .rejects.toThrow(/unitsDetected/)
  })

  it('strips extra fields the server (or LLM) sneaked into the session', async () => {
    const dirty = makeSession({ extra: 'field' })
    stubFetch(200, { session: dirty })
    const session = await parseImportWithAI({ text: '7i 165', accessToken: 't' })
    expect(session).not.toHaveProperty('extra')
  })
})
