// Action handler: parse-yardage-book-pdf
// Parses a directly-provided PDF URL (admin-only).
// Reuses the same parsePdfAndPersist pipeline from yardageBook.js
// but takes the PDF URL directly rather than discovering it via web search.

import { jsonResponse } from '../middleware.js'
import { parseJsonFromText } from '../extractJson.js'
import { buildScorecardTeesMessages, buildHazardDesignMessages } from '../pdfParseMessages.js'
import { validateScorecardJson } from '../courseValidation.js'
import { computeHazardCoverage, validateHazardDesignBatch, validateHazardPlausibility, buildHazardRows } from '../hazardCoverage.js'
import { upsertCourseCache, upsertHazardRows, readCourseCache } from '../coursePersist.js'
import { isAdminUser } from '../admin.js'
import { MODEL } from '../claude.js'

const MODEL_FAST = 'claude-haiku-4-5-20251001'

// Scorecard extraction — mirrors the parseAndPersistScorecard in yardageBook.js.
// Kept as a local function to avoid circular imports.
async function parseAndPersistScorecard(pdfUrl, body, ctx) {
  const { courseName, location, persist } = body
  const messages = buildScorecardTeesMessages(pdfUrl, courseName, location || '')
  const text = await ctx.callClaude(messages, 6000, false, undefined, MODEL_FAST)
  const r = parseJsonFromText(text)
  if (!r.ok) throw new Error(`No JSON in PDF scorecard response (${r.error}).`)
  const parsed = r.value
  if (parsed.error) throw new Error(parsed.error)

  const issues = validateScorecardJson(parsed)
  parsed._validationIssues = issues
  if (issues.length > 1) parsed._confidence = 'low'
  else if (issues.length === 1 && parsed._confidence === 'high') parsed._confidence = 'medium'

  const holeCount = Array.isArray(parsed.holes) ? parsed.holes.length : 0
  const tooBroken = holeCount !== 18 || issues.length > 2
  if (tooBroken) parsed._persistSkipped = `quality gate: hole_count=${holeCount}, issues=${issues.length}`

  if (persist !== false && !tooBroken && ctx.courseKey && ctx.supabaseRest) {
    const scorecardOnly = { ...parsed }
    scorecardOnly._source = 'yardage_book'
    scorecardOnly._sourcePdf = pdfUrl

    const upsertRes = await upsertCourseCache(ctx.supabaseRest, ctx.courseKey, scorecardOnly, {
      userId: ctx.userId,
      source: 'yardage_book',
    })
    if (!upsertRes.ok) {
      const detail = upsertRes._err || (await upsertRes.text?.().catch(() => '')) || ''
      console.error(`[course_cache] persist failed (${upsertRes.status}): ${detail}`)
      parsed._cachePersistError = `course_cache persist failed (${upsertRes.status}). ${detail}`
    }
  }

  parsed._sourcePdf = pdfUrl
  return parsed
}

async function parseAndPersistHazards(pdfUrl, scorecardConfidence, body, ctx) {
  const { courseName, location, persist } = body
  const emptyCoverage = computeHazardCoverage([])
  try {
    const messages = buildHazardDesignMessages(pdfUrl, courseName, location || '')
    const text = await ctx.callClaude(messages, 8000, false, undefined, MODEL)
    const r = parseJsonFromText(text)
    if (!r.ok) throw new Error(`No JSON in PDF hazard response (${r.error}).`)
    const parsed = r.value
    if (parsed.error) throw new Error(parsed.error)

    const hazardsByHole = Array.isArray(parsed.hazardsByHole) ? parsed.hazardsByHole : []
    const hazardIssues = validateHazardDesignBatch(hazardsByHole)
    const coverage = computeHazardCoverage(hazardsByHole)

    if (persist !== false && ctx.courseKey && ctx.supabaseRest) {
      const rows = buildHazardRows(hazardsByHole, { courseKey: ctx.courseKey, pdfUrl, coverage, baseConfidence: scorecardConfidence })
      if (rows.length) {
        const hzRes = await upsertHazardRows(ctx.supabaseRest, rows)
        if (!hzRes.ok) {
          const detail = hzRes._err || (await hzRes.text?.().catch(() => '')) || ''
          console.error(`[course_hole_hazards] persist failed (${hzRes.status}): ${detail}`)
          return { coverage, validationIssues: hazardIssues, persistError: `course_hole_hazards persist failed (${hzRes.status}). ${detail}` }
        }
      }
    }

    return { coverage, hazardsByHole, validationIssues: hazardIssues, persistError: null }
  } catch (e) {
    console.error(`[hazard-design] extraction failed: ${e.message}`)
    return { coverage: emptyCoverage, hazardsByHole: [], validationIssues: [], extractError: e.message }
  }
}

async function parsePdfAndPersist(pdfUrl, body, ctx) {
  const { courseName, location } = body
  const [scorecardResult, hazardResult] = await Promise.allSettled([
    parseAndPersistScorecard(pdfUrl, body, ctx),
    parseAndPersistHazards(pdfUrl, 'medium', body, ctx),
  ])

  let parsed
  if (scorecardResult.status === 'fulfilled') {
    parsed = scorecardResult.value
  } else {
    console.error(`[scorecard] parse failed: ${scorecardResult.reason?.message}`)
    parsed = {
      name: courseName,
      location: location || null,
      _confidence: 'low',
      _scorecardError: scorecardResult.reason?.message || 'Scorecard parse failed',
      _sourcePdf: pdfUrl,
    }
  }

  if (hazardResult.status === 'fulfilled') {
    const hr = hazardResult.value
    parsed.hazardCoverage = hr.coverage
    parsed.hazardsByHole = hr.hazardsByHole || []
    if (hr.validationIssues?.length) parsed._hazardValidationIssues = hr.validationIssues
    if (hr.persistError) parsed._hazardPersistError = hr.persistError
    if (hr.extractError) parsed._hazardExtractError = hr.extractError
  } else {
    console.error(`[hazard-design] parse failed: ${hazardResult.reason?.message}`)
    parsed.hazardCoverage = computeHazardCoverage([])
    parsed.hazardsByHole = []
    parsed._hazardExtractError = hazardResult.reason?.message || 'Hazard extraction failed'
  }

  const scorecardHoles = Array.isArray(parsed.holes) ? parsed.holes : []
  const hazardsByHole = parsed.hazardsByHole || []
  if (scorecardHoles.length && hazardsByHole.length) {
    const plausibilityIssues = validateHazardPlausibility(hazardsByHole, scorecardHoles)
    if (plausibilityIssues.length) {
      parsed._hazardPlausibilityIssues = plausibilityIssues
      if (plausibilityIssues.length > 3 && parsed._confidence !== 'low') {
        parsed._confidence = 'low'
      }
    }
  }

  return parsed
}

export async function handle(body, ctx) {
  const { pdf_url, courseName } = body
  if (!pdf_url || !courseName) return jsonResponse({ error: 'parse-yardage-book-pdf needs `pdf_url` and `courseName`.' }, 400)
  const admin = await isAdminUser(ctx.userId)
  if (!admin) return jsonResponse({ error: 'Admin access required to upload a yardage book PDF.' }, 403)

  // Cache precheck — same (course_key, pdf_url) -> return cached parse
  // rather than re-billing the 10k-token Haiku vision call.
  if (ctx.courseKey && ctx.supabaseRest) {
    try {
      const existing = await readCourseCache(ctx.supabaseRest, ctx.courseKey)
      if (existing && existing.course_data?._sourcePdf === pdf_url && existing.source === 'yardage_book') {
        existing.course_data._cacheHit = true
        return jsonResponse({ result: existing.course_data }, 200)
      }
    } catch {}
  }

  const parsed = await parsePdfAndPersist(pdf_url, body, ctx)
  return jsonResponse({ result: parsed }, 200)
}
