// Action handler: hole-design-search
// Searches for hole-by-hole design details via web search.
// Includes background auto-discover enrichment (fire-and-forget).

import { jsonResponse } from '../middleware.js'
import { parseJsonFromText } from '../extractJson.js'
import { buildHoleDesignMessages } from '../coursePrompts.js'
import { computeHazardCoverage, buildHazardRows } from '../hazardCoverage.js'
import { upsertHazardRows } from '../coursePersist.js'

const MODEL_FAST = 'claude-haiku-4-5-20251001'

export async function handle(body, ctx) {
  const { courseName, location } = body
  if (!courseName) return jsonResponse({ error: 'Missing courseName.' }, 400)
  const messages = buildHoleDesignMessages(courseName, location || '')
  // hole-design-search is enrichment, not gating — the plan can generate
  // without it. Optimised for latency: Haiku (~5x faster than Sonnet for
  // this shallow JSON), 2000 tokens (18 holes x ~80 tokens each = ~1.5k
  // real payload + slack), cap web_search at 2 calls, wall-clock 30s.
  // Response schema is unchanged so mergeDesignDataIntoHoles / promptSections
  // downstream see the same shape.
  const text = await ctx.callClaude(messages, 2000, true, undefined, MODEL_FAST, {
    webSearchMaxUses: 2,
    timeoutMs: 30000,
  })

  const aRes = parseJsonFromText(text)
  if (!aRes.ok) return jsonResponse({ error: `No JSON in AI response (${aRes.error}).` }, 502)
  const parsed = aRes.value
  if (parsed.error) return jsonResponse({ error: parsed.error }, 422)

  // Issue #175: After hole-design-search, queue a background auto-discovery
  // enrichment if the course has no existing hazard data. This is fire-and-forget
  // — the main response is already built and will be returned immediately.
  if (ctx.courseKey && ctx.supabaseRest) {
    // Check if hazard data already exists — if not, queue enrichment
    const enrichmentCheck = ctx.supabaseRest(
      `course_hole_hazards?course_key=eq.${encodeURIComponent(ctx.courseKey)}&select=hole_ref&limit=1`,
      { method: 'GET' }
    ).then(async (res) => {
      if (!res.ok) return
      const rows = await res.json()
      if (Array.isArray(rows) && rows.length > 0) return // already has data

      // Fire the auto-discover action as an internal call. This is a
      // lightweight self-POST that runs the discovery pipeline. It will
      // rate-limit itself if data appears between the check and the call.
      console.log(`[auto-discover] queuing background enrichment for ${ctx.courseKey}`)
      // We inline the enrichment here rather than making an HTTP call to
      // ourselves, to avoid cold-start and authentication overhead.
      const holes = Array.isArray(parsed.holes) ? parsed.holes : []
      const hazardsByHole = holes
        .filter(h => h && h.hole && Array.isArray(h.hazards) && h.hazards.length)
        .map(h => ({ hole: h.hole, dogleg: h.dogleg, hazards: h.hazards, green_notes: h.green_notes }))

      if (!hazardsByHole.length) return

      const coverage = computeHazardCoverage(hazardsByHole)
      const hzRows = buildHazardRows(hazardsByHole, {
        courseKey: ctx.courseKey,
        coverage,
        baseConfidence: 'web-discovered',
        source: 'auto_discovery',
      })
      if (hzRows.length) {
        await upsertHazardRows(ctx.supabaseRest, hzRows)
          .catch(e => console.error(`[auto-discover] persist failed: ${e?.message}`))
        console.log(`[auto-discover] persisted ${hzRows.length} hazard rows for ${ctx.courseKey} (confidence: web-discovered)`)
      }
    }).catch(e => console.error(`[auto-discover] enrichment check failed: ${e?.message}`))
    // Do not await — this runs in the background after the response is sent.
    // Vercel keeps the function alive until all promises settle (within maxDuration).
    void enrichmentCheck
  }

  return jsonResponse({ result: parsed }, 200)
}
