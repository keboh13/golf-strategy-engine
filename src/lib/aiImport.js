// Client helper for the AI universal importer (api/parse-import.js).
//
// The PURE parts (dimension math, request-body building/validation) are
// exported separately and are node-testable without jsdom. Canvas/FileReader
// usage lives in thin browser-only wrappers at the bottom.

// Keep in sync with api/parse-import.js
export const MAX_TEXT_BYTES         = 200 * 1024          // 200KB of pasted text
export const MAX_IMAGE_BASE64_BYTES = 3 * 1024 * 1024     // 3MB base64 payload
export const SUPPORTED_IMAGE_TYPES  = ['image/jpeg', 'image/png', 'image/webp']

export const MAX_IMAGE_EDGE = 1568
export const JPEG_QUALITY   = 0.85

// ── Pure: dimension math ──────────────────────────────────────────────────────

/**
 * Scale (width, height) so the longest edge is at most maxEdge.
 * Never upscales; preserves aspect ratio; returns integer dimensions >= 1.
 */
export function targetDimensions(width, height, maxEdge = MAX_IMAGE_EDGE) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('targetDimensions: width and height must be positive numbers')
  }
  const longest = Math.max(width, height)
  if (longest <= maxEdge) {
    return { width: Math.round(width), height: Math.round(height) }
  }
  const scale = maxEdge / longest
  return {
    width:  Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

// ── Pure: request-body building / validation ──────────────────────────────────

/**
 * Build the JSON body for POST /api/parse-import.
 * Pass either { text } or { imageBase64, mediaType }. Throws on invalid input
 * so callers fail fast before any network round trip.
 */
export function buildRequestBody(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('buildRequestBody: expected an input object')
  }

  if (input.imageBase64 != null) {
    const { imageBase64, mediaType } = input
    if (typeof imageBase64 !== 'string' || imageBase64 === '') {
      throw new Error('buildRequestBody: imageBase64 must be a non-empty string')
    }
    if (imageBase64.startsWith('data:')) {
      throw new Error('buildRequestBody: imageBase64 must be raw base64, not a data: URL')
    }
    if (!SUPPORTED_IMAGE_TYPES.includes(mediaType)) {
      throw new Error(`buildRequestBody: mediaType must be one of ${SUPPORTED_IMAGE_TYPES.join(', ')}`)
    }
    if (imageBase64.length > MAX_IMAGE_BASE64_BYTES) {
      throw new Error('buildRequestBody: image too large — please use a smaller screenshot')
    }
    return { kind: 'image', imageBase64, mediaType }
  }

  if (input.text != null) {
    const { text } = input
    if (typeof text !== 'string' || text.trim() === '') {
      throw new Error('buildRequestBody: text must be a non-empty string')
    }
    if (new TextEncoder().encode(text).length > MAX_TEXT_BYTES) {
      throw new Error('buildRequestBody: text too large — maximum is 200KB')
    }
    return { kind: 'text', text }
  }

  throw new Error('buildRequestBody: provide either text or imageBase64 + mediaType')
}

// ── Pure: NormalizedSession schema validation ─────────────────────────────────
// Keep in sync with SESSION_SCHEMA in api/parse-import.js. The LLM response is
// never trusted blindly: the server validates before responding, and the client
// validates again before handing the session to the rest of the app.

const SHOT_NUMBER_FIELDS = [
  'carryYds', 'totalYds', 'offlineYds', 'ballSpeedMph',
  'clubSpeedMph', 'launchDeg', 'spinRpm', 'apexFt',
]
const UNITS = ['yards', 'meters', 'unknown']

// Semantic ranges — what's physically plausible for a human golfer. A shot
// whose values fall outside enough of these is rejected (saves the
// recommendation engine from garbage like 1500-yard carries).
const SHOT_RANGES = {
  carryYds:     [40, 400],
  totalYds:     [40, 450],
  offlineYds:   [-150, 150],
  ballSpeedMph: [60, 200],
  clubSpeedMph: [40, 150],
  launchDeg:    [-5, 50],
  spinRpm:      [500, 12000],
  apexFt:       [5, 200],
}

// How many out-of-range fields trigger shot rejection. We keep this loose
// because some entry fields (apex, spin, launch) may legitimately be missing
// on cheap launch monitors.
const MAX_OUT_OF_RANGE = 2

export function shotOutOfRangeFields(shot) {
  const bad = []
  for (const [field, [lo, hi]] of Object.entries(SHOT_RANGES)) {
    const v = shot?.[field]
    if (v == null) continue
    if (!Number.isFinite(v) || v < lo || v > hi) bad.push(field)
  }
  return bad
}

function timestampParses(ts) {
  if (ts == null) return true
  if (typeof ts !== 'string') return false
  const t = Date.parse(ts)
  return Number.isFinite(t)
}

function isNullableFiniteNumber(v) {
  return v === null || (typeof v === 'number' && Number.isFinite(v))
}

function isNullableString(v) {
  return v === null || typeof v === 'string'
}

/**
 * Validate an untrusted NormalizedSession (e.g. an LLM structured output).
 * Returns { ok: true, session } with a sanitized copy containing ONLY schema
 * fields (extras are stripped), or { ok: false, error } describing the first
 * violation found.
 */
export function validateNormalizedSession(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'session must be an object' }
  }
  if (raw.source !== 'ai-import') {
    return { ok: false, error: "source must be 'ai-import'" }
  }
  if (!isNullableString(raw.sessionDate)) {
    return { ok: false, error: 'sessionDate must be a string or null' }
  }
  if (raw.sessionDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(raw.sessionDate)) {
    return { ok: false, error: 'sessionDate must be YYYY-MM-DD or null' }
  }
  if (!UNITS.includes(raw.unitsDetected)) {
    return { ok: false, error: `unitsDetected must be one of: ${UNITS.join(', ')}` }
  }
  if (!Array.isArray(raw.warnings) || raw.warnings.some((w) => typeof w !== 'string')) {
    return { ok: false, error: 'warnings must be an array of strings' }
  }
  if (!Array.isArray(raw.shots)) {
    return { ok: false, error: 'shots must be an array' }
  }

  const shots = []
  const rejected = []
  const semanticWarnings = []
  for (let i = 0; i < raw.shots.length; i++) {
    const s = raw.shots[i]
    if (!s || typeof s !== 'object' || Array.isArray(s)) {
      return { ok: false, error: `shots[${i}] must be an object` }
    }
    if (typeof s.clubKey !== 'string' || s.clubKey.trim() === '') {
      return { ok: false, error: `shots[${i}].clubKey must be a non-empty string` }
    }
    if (typeof s.clubLabel !== 'string' || s.clubLabel.trim() === '') {
      return { ok: false, error: `shots[${i}].clubLabel must be a non-empty string` }
    }
    const timestamp = s.timestamp ?? null
    if (!isNullableString(timestamp)) {
      return { ok: false, error: `shots[${i}].timestamp must be a string or null` }
    }
    if (!timestampParses(timestamp)) {
      return { ok: false, error: `shots[${i}].timestamp must parse as a date string` }
    }
    const shot = { clubKey: s.clubKey, clubLabel: s.clubLabel, timestamp }
    for (const field of SHOT_NUMBER_FIELDS) {
      const v = s[field] ?? null
      if (!isNullableFiniteNumber(v)) {
        return { ok: false, error: `shots[${i}].${field} must be a finite number or null` }
      }
      shot[field] = v
    }
    const bad = shotOutOfRangeFields(shot)
    if (bad.length >= MAX_OUT_OF_RANGE) {
      rejected.push({ index: i, club: shot.clubKey, badFields: bad })
      continue
    }
    if (bad.length) {
      semanticWarnings.push(`shots[${i}] (${shot.clubKey}) values out of range: ${bad.join(', ')}`)
    }
    shots.push(shot)
  }

  // Reject the whole session if too many shots failed semantic checks — that's
  // a signal the LLM hallucinated or the source was misinterpreted.
  if (rejected.length > 0 && rejected.length / raw.shots.length > 0.25) {
    return { ok: false, error: `session has too many out-of-range shots (${rejected.length}/${raw.shots.length}) — re-import` }
  }

  return {
    ok: true,
    session: {
      source: 'ai-import',
      sessionDate: raw.sessionDate,
      unitsDetected: raw.unitsDetected,
      shots,
      warnings: raw.warnings.slice().concat(semanticWarnings)
        .concat(rejected.length ? [`Rejected ${rejected.length} shot(s) with values out of plausible range`] : []),
    },
  }
}

// ── Browser-only: image downscaling (canvas) ──────────────────────────────────

async function loadImageSource(file) {
  // Prefer createImageBitmap (fast, no DOM <img> needed)
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file)
    } catch {
      /* fall through to <img> path (e.g. unsupported format edge cases) */
    }
  }
  return await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image file')) }
    img.src = url
  })
}

/**
 * Browser-only. Downscale an image File/Blob to max edge MAX_IMAGE_EDGE px,
 * re-encode as JPEG (quality 0.85), and return { imageBase64, mediaType }.
 */
export async function fileToImagePayload(file) {
  const source = await loadImageSource(file)
  const srcW = source.naturalWidth  || source.width
  const srcH = source.naturalHeight || source.height
  const { width, height } = targetDimensions(srcW, srcH)

  const canvas = document.createElement('canvas')
  canvas.width  = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  // JPEG has no alpha — flatten transparent PNGs/WebPs onto white
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(source, 0, 0, width, height)
  if (typeof source.close === 'function') source.close()

  const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY)
  return {
    imageBase64: dataUrl.slice(dataUrl.indexOf(',') + 1),
    mediaType:   'image/jpeg',
  }
}

// ── Browser-only: main entry point ────────────────────────────────────────────

/**
 * Send pasted text OR an image file to /api/parse-import and return the
 * NormalizedSession. Pass exactly one of { text, file } plus the Supabase
 * accessToken.
 */
export async function parseImportWithAI({ text, file, accessToken }) {
  if (!accessToken) {
    throw new Error('Sign in required to use AI import.')
  }

  const body = file
    ? buildRequestBody(await fileToImagePayload(file))
    : buildRequestBody({ text })

  const res = await fetch('/api/parse-import', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })

  let data = null
  try {
    data = await res.json()
  } catch {
    /* non-JSON response — handled below */
  }

  if (!res.ok) {
    throw new Error(data?.error || `AI import failed (HTTP ${res.status}).`)
  }
  if (!data?.session) {
    throw new Error('AI import failed: malformed server response.')
  }
  const validated = validateNormalizedSession(data.session)
  if (!validated.ok) {
    throw new Error(`AI import failed: malformed server response (${validated.error}).`)
  }
  return validated.session
}
