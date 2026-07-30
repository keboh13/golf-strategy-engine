// Action handler: yardage-book
// Discovers and parses a yardage-book PDF (or HTML fallback) for a course.
// Contains parsePdfAndPersist, parseAndPersistScorecard, parseAndPersistHazards.

import { jsonResponse } from '../middleware.js'
import { parseJsonFromText } from '../extractJson.js'
import { buildScorecardTeesMessages, buildHazardDesignMessages } from '../pdfParseMessages.js'
import { buildPdfDiscoveryMessages } from '../coursePrompts.js'
import { validateScorecardJson } from '../courseValidation.js'
import { computeHazardCoverage, validateHazardDesignBatch, validateHazardPlausibility, buildHazardRows } from '../hazardCoverage.js'
import { upsertCourseCache, upsertHazardRows, readCourseCache } from '../coursePersist.js'
import { urlServesPdf } from '../pdfUtils.js'
import { MODEL } from '../claude.js'

const MODEL_FAST = 'claude-haiku-4-5-20251001'

// Call 1 — scorecard + tees. Mechanical extraction, fast model, existing
// validation gate. This is the part that's been reliable; kept unchanged
// in behavior, just scoped to a smaller prompt.
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

  // Quality gate — refuse to persist obviously broken parses to the shared
  // cache (hole_count != 18 or too many validation issues). Otherwise a
  // single low-confidence parse poisons the row for every user.
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

// Call 2 — hazards, dogleg, descriptions, and visual-diagram analysis.
// Vision-heavy: reads 18 separate hole illustrations, so it gets the full
// model and its own token budget instead of sharing one call with the
// scorecard. Always persists whatever holes come back (partial is fine —
// course_hole_hazards is keyed per-hole); never blocks on completeness,
// but reports a coverage count so incompleteness is visible rather than
// silent. Independent of Call 1: a failure here never blocks the
// scorecard from persisting.
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
  // Run scorecard and hazard extraction concurrently. If scorecard fails,
  // hazards still run (and vice versa). This decouples the two pipelines so
  // a bad scorecard (common with unusual PDF layouts) doesn't block the
  // more reliable hazard extraction.
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
  const { courseName, location, persist } = body
  if (!courseName) return jsonResponse({ error: 'Missing courseName.' }, 400)

  // Step 1: web-search for the official PDF URL. Retry up to twice if the
  // returned URL turns out to be dead (HTML masquerading as a PDF), so the
  // model can try a different source instead of failing the whole request.
  const tried = []
  let discovery = null
  let confirmedPdf = false
  for (let attempt = 0; attempt < 3; attempt++) {
    const discoverText = await ctx.callClaude(
      buildPdfDiscoveryMessages(courseName, location || '', tried),
      800,
      true,
    )
    const dRes = parseJsonFromText(discoverText)
    if (!dRes.ok) return jsonResponse({ error: `PDF discovery returned no JSON (${dRes.error}).` }, 502)
    const d = dRes.value
    if (d.error || !d.url) {
      if (!discovery) return jsonResponse({ error: d.error || 'No PDF URL found via web search.' }, 422)
      break
    }
    discovery = d
    const looksPdf = d.kind === 'pdf' || /\.pdf(\?|$)/i.test(d.url)
    if (!looksPdf) break // HTML hit — let the HTML fallback handle it
    confirmedPdf = await urlServesPdf(d.url)
    if (confirmedPdf) break
    tried.push(d.url)
  }

  // Step 2: if the discovered link is a confirmed PDF, feed it to the
  // document-block parser. Otherwise fall through to the HTML fallback.
  if (confirmedPdf) {
    try {
      const parsed = await parsePdfAndPersist(discovery.url, body, ctx)
      parsed._discoveredVia = 'web_search'
      parsed._discoveryTitle = discovery.title || null
      return jsonResponse({ result: parsed }, 200)
    } catch (e) {
      return jsonResponse({ error: `PDF discovered (${discovery.url}) but parse failed: ${e.message}` }, 502)
    }
  }

  // Step 2b: HTML fallback — extract scorecard from the page via web search.
  const htmlText = await ctx.callClaude([{
    role: 'user',
    content: `Use web_search to open ${discovery.url} and extract the verified scorecard for "${courseName}"${location ? ` in ${location}` : ''}.

Return ONLY this JSON (no markdown):
{
  "name": "Full course name",
  "location": "City, State",
  "yardage": <int>,
  "rating": <float>,
  "slope": <int>,
  "par": <int>,
  "selectedTee": "Championship",
  "source": "${discovery.url}",
  "_confidence": "high|medium|low",
  "holes": [{"par":4,"yardage":379,"handicap":7}, ...all 18]
}

If you cannot extract a verifiable scorecard: {"error":"…"}`,
  }], 3500, true)
  const hRes = parseJsonFromText(htmlText)
  if (!hRes.ok) return jsonResponse({ error: `No JSON in HTML scorecard response (${hRes.error}).` }, 502)
  const htmlParsed = hRes.value
  if (htmlParsed.error) return jsonResponse({ error: htmlParsed.error }, 422)

  const issues = validateScorecardJson(htmlParsed)
  htmlParsed._validationIssues = issues
  htmlParsed._sourceHtml = discovery.url
  htmlParsed._discoveredVia = 'web_search'
  if (issues.length > 1) htmlParsed._confidence = 'low'

  // HTML scrape is the lowest-quality source. Refuse to persist when
  // (a) too many validation issues, or (b) an existing row was derived
  // from a confirmed PDF / higher-confidence source — otherwise a single
  // bad HTML fallback can overwrite a known-good yardage-book parse.
  const htmlTooBroken = issues.length > 2 || (Array.isArray(htmlParsed.holes) ? htmlParsed.holes.length : 0) !== 18
  let blockedByExisting = false
  if (persist !== false && !htmlTooBroken && ctx.courseKey && ctx.supabaseRest) {
    const scorecardOnly = { ...htmlParsed, _source: 'yardage_book' }
    let existingConfidence = null
    let existingSourcePdf = null
    try {
      const existing = await readCourseCache(ctx.supabaseRest, ctx.courseKey)
      if (existing) {
        existingConfidence = existing.course_data?._confidence || null
        existingSourcePdf = existing.course_data?._sourcePdf || null
      }
    } catch {}
    // Block if existing row came from a confirmed PDF, or has higher
    // confidence than this scrape.
    const incomingConf = htmlParsed._confidence || 'low'
    const rank = { high: 3, medium: 2, low: 1 }
    if (existingSourcePdf || (rank[existingConfidence] || 0) > (rank[incomingConf] || 0)) {
      blockedByExisting = true
      htmlParsed._persistSkipped = `existing row has higher-confidence source (${existingSourcePdf ? 'pdf' : existingConfidence})`
    }
    if (!blockedByExisting) {
      const upsertRes = await upsertCourseCache(ctx.supabaseRest, ctx.courseKey, scorecardOnly, {
        userId: ctx.userId,
        source: 'yardage_book',
      })
      if (!upsertRes.ok) {
        const detail = upsertRes._err || (await upsertRes.text?.().catch(() => '')) || ''
        console.error(`[course_cache] HTML fallback persist failed (${upsertRes.status}): ${detail}`)
        htmlParsed._cachePersistError = `course_cache persist failed (${upsertRes.status}). ${detail}`
      }
    }
  } else if (htmlTooBroken) {
    htmlParsed._persistSkipped = `quality gate: issues=${issues.length}`
  }

  return jsonResponse({ result: htmlParsed }, 200)
}
