// Action handler: hazard-extract
// Extracts hazard data from a single hole diagram image (vision).

import { jsonResponse } from '../middleware.js'
import { parseJsonFromText } from '../extractJson.js'
import { buildHazardExtractMessages } from '../coursePrompts.js'
import { validateHazardsJson } from '../courseValidation.js'
import { upsertHazardRows } from '../coursePersist.js'

const MODEL_FAST = 'claude-haiku-4-5-20251001'

export async function handle(body, ctx) {
  const { hole, image_url, image_base64, image_media_type, persist } = body
  if (!hole || (!image_url && !image_base64)) {
    return jsonResponse({ error: 'hazard-extract needs `hole` and `image_url` or `image_base64`.' }, 400)
  }
  const imageRef = image_url
    ? { kind: 'url', value: image_url }
    : { kind: 'base64', value: image_base64, media_type: image_media_type }
  const messages = buildHazardExtractMessages(hole, imageRef)
  const text = await ctx.callClaude(messages, 2000, false, undefined, MODEL_FAST)
  const vRes = parseJsonFromText(text)
  if (!vRes.ok) return jsonResponse({ error: `No JSON in vision response (${vRes.error}).` }, 502)
  const parsed = vRes.value
  if (parsed.error) return jsonResponse({ error: parsed.error }, 422)

  // Schema-gate hazards before persisting. Vision output is hallucination-
  // prone and lands in a shared row visible to all users for that hole.
  const hazardIssues = validateHazardsJson(parsed)
  parsed._validationIssues = hazardIssues

  if (persist && hazardIssues.length === 0 && ctx.courseKey && ctx.supabaseRest) {
    const hzRes = await upsertHazardRows(ctx.supabaseRest, [{
      course_key: ctx.courseKey,
      hole_ref: Number(hole),
      hazards: parsed,
      source: 'vision',
      image_path: image_url || null,
      updated_at: new Date().toISOString(),
    }])
    if (!hzRes.ok) {
      const detail = hzRes._err || (await hzRes.text?.().catch(() => '')) || ''
      console.error(`[course_hole_hazards] persist failed (${hzRes.status}): ${detail}`)
      parsed._hazardPersistError = `course_hole_hazards persist failed (${hzRes.status}). ${detail}`
    }
  }
  return jsonResponse({ result: parsed }, 200)
}
