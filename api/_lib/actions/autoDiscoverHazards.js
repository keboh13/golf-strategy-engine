// Action handler: auto-discover-hazards
// Issue #175: Auto-discovery enrichment for courses without admin PDFs.
// Discovers and persists structured hazard data from publicly available
// scorecards and course guides.

import { jsonResponse } from '../middleware.js'
import { parseJsonFromText } from '../extractJson.js'
import { buildPdfDiscoveryMessages, buildHoleDesignMessages } from '../coursePrompts.js'
import { buildHazardDesignMessages } from '../pdfParseMessages.js'
import { computeHazardCoverage, buildHazardRows } from '../hazardCoverage.js'
import { upsertHazardRows } from '../coursePersist.js'
import { urlServesPdf } from '../pdfUtils.js'
import { MODEL } from '../claude.js'

const MODEL_FAST = 'claude-haiku-4-5-20251001'

export async function handle(body, ctx) {
  const { courseName, location } = body
  if (!courseName) return jsonResponse({ error: 'Missing courseName.' }, 400)

  // Rate-limit: skip if we already have hazard data for this course
  if (ctx.courseKey && ctx.supabaseRest) {
    try {
      const existing = await ctx.supabaseRest(
        `course_hole_hazards?course_key=eq.${encodeURIComponent(ctx.courseKey)}&select=hole_ref&limit=1`,
        { method: 'GET' }
      )
      if (existing.ok) {
        const rows = await existing.json()
        if (Array.isArray(rows) && rows.length > 0) {
          return jsonResponse({ result: { skipped: true, reason: 'hazard_data_exists' } }, 200)
        }
      }
    } catch {}
  }

  // Step 1: Discover a PDF or HTML source via web search
  const tried = []
  let discovery = null
  let confirmedPdf = false
  for (let attempt = 0; attempt < 2; attempt++) {
    let discoverText
    try {
      discoverText = await ctx.callClaude(
        buildPdfDiscoveryMessages(courseName, location || '', tried),
        800,
        true,
      )
    } catch (e) {
      console.error(`[auto-discover] discovery call failed: ${e.message}`)
      return jsonResponse({ result: { skipped: true, reason: 'discovery_failed', detail: e.message } }, 200)
    }
    const dRes = parseJsonFromText(discoverText)
    if (!dRes.ok || dRes.value?.error || !dRes.value?.url) break
    discovery = dRes.value
    const looksPdf = discovery.kind === 'pdf' || /\.pdf(\?|$)/i.test(discovery.url)
    if (looksPdf) {
      confirmedPdf = await urlServesPdf(discovery.url)
      if (confirmedPdf) break
      tried.push(discovery.url)
    } else {
      break
    }
  }

  if (!discovery || (!confirmedPdf && discovery.kind === 'pdf')) {
    return jsonResponse({ result: { skipped: true, reason: 'no_source_found' } }, 200)
  }

  // Step 2: Parse and persist with web-discovered confidence
  if (confirmedPdf) {
    try {
      const emptyCoverage = computeHazardCoverage([])
      const messages = buildHazardDesignMessages(discovery.url, courseName, location || '')
      const text = await ctx.callClaude(messages, 8000, false, undefined, MODEL)
      const r = parseJsonFromText(text)
      if (!r.ok) throw new Error(`No JSON in hazard response (${r.error}).`)
      const parsed = r.value
      if (parsed.error) throw new Error(parsed.error)

      const hazardsByHole = Array.isArray(parsed.hazardsByHole) ? parsed.hazardsByHole : []
      const coverage = computeHazardCoverage(hazardsByHole)

      if (ctx.courseKey && ctx.supabaseRest && hazardsByHole.length) {
        const rows = buildHazardRows(hazardsByHole, {
          courseKey: ctx.courseKey,
          pdfUrl: discovery.url,
          coverage,
          baseConfidence: 'web-discovered',
          source: 'auto_discovery',
        })
        if (rows.length) {
          await upsertHazardRows(ctx.supabaseRest, rows)
            .catch(e => console.error(`[auto-discover] persist failed: ${e?.message}`))
        }
      }

      return jsonResponse({
        result: {
          enriched: true,
          confidence: 'web-discovered',
          source: discovery.url,
          holesDiscovered: hazardsByHole.length,
          coverage,
        },
      }, 200)
    } catch (e) {
      console.error(`[auto-discover] parse failed: ${e.message}`)
      return jsonResponse({ result: { skipped: true, reason: 'parse_failed', detail: e.message } }, 200)
    }
  }

  // HTML source — extract hole design data via web search
  try {
    const text = await ctx.callClaude(
      buildHoleDesignMessages(courseName, location || ''),
      2000,
      true,
      undefined,
      MODEL_FAST,
      { webSearchMaxUses: 2, timeoutMs: 30000 },
    )
    const r = parseJsonFromText(text)
    if (!r.ok || r.value?.error) {
      return jsonResponse({ result: { skipped: true, reason: 'web_extract_failed' } }, 200)
    }

    // Normalize web-search hole design data into hazard rows
    const holes = Array.isArray(r.value.holes) ? r.value.holes : []
    const hazardsByHole = holes
      .filter(h => h && h.hole && Array.isArray(h.hazards) && h.hazards.length)
      .map(h => ({ hole: h.hole, dogleg: h.dogleg, hazards: h.hazards, green_notes: h.green_notes }))

    if (hazardsByHole.length && ctx.courseKey && ctx.supabaseRest) {
      const coverage = computeHazardCoverage(hazardsByHole)
      const rows = buildHazardRows(hazardsByHole, {
        courseKey: ctx.courseKey,
        coverage,
        baseConfidence: 'web-discovered',
        source: 'auto_discovery',
      })
      if (rows.length) {
        await upsertHazardRows(ctx.supabaseRest, rows)
          .catch(e => console.error(`[auto-discover] persist failed: ${e?.message}`))
      }
    }

    return jsonResponse({
      result: {
        enriched: hazardsByHole.length > 0,
        confidence: 'web-discovered',
        source: r.value.source || 'web_search',
        holesDiscovered: hazardsByHole.length,
      },
    }, 200)
  } catch (e) {
    console.error(`[auto-discover] web extract failed: ${e.message}`)
    return jsonResponse({ result: { skipped: true, reason: 'web_extract_error', detail: e.message } }, 200)
  }
}
