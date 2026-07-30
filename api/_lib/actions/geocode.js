// Action handler: geocode
// Looks up GPS coordinates for a golf course via web search.

import { jsonResponse } from '../middleware.js'
import { parseJsonFromText } from '../extractJson.js'
import { buildGeocodeMessages } from '../coursePrompts.js'

export async function handle(body, ctx) {
  const { courseName, location } = body
  if (!courseName) return jsonResponse({ error: 'Missing courseName.' }, 400)
  const messages = buildGeocodeMessages(courseName, location || '')
  const text = await ctx.callClaude(messages, 200, true)

  const aRes = parseJsonFromText(text)
  if (!aRes.ok) return jsonResponse({ error: `No JSON in AI response (${aRes.error}).` }, 502)
  const parsed = aRes.value
  if (parsed.error) return jsonResponse({ error: parsed.error }, 422)

  return jsonResponse({ result: parsed }, 200)
}
