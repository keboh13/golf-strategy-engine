// Balanced-brace JSON extractor for LLM responses.
//
// The previous approach (`text.match(/\{[\s\S]*\}/)`) is greedy: it matches
// the first `{` to the LAST `}` in the response, swallowing trailing
// commentary or a second JSON object. That silently corrupted parsed data.
//
// extractJson() walks the string, ignoring braces inside strings/escapes, and
// returns the first balanced top-level JSON object. Strips ```json fences
// first. Returns null if no balanced object is found.

export function stripJsonFences(text) {
  if (typeof text !== 'string') return ''
  return text.replace(/```json|```/g, '').trim()
}

export function extractJson(rawText) {
  const text = stripJsonFences(rawText)
  const start = text.indexOf('{')
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (escape) { escape = false; continue }
    if (inString) {
      if (ch === '\\') { escape = true; continue }
      if (ch === '"') inString = false
      continue
    }
    if (ch === '"') { inString = true; continue }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

export function parseJsonFromText(rawText) {
  const slice = extractJson(rawText)
  if (slice == null) return { ok: false, error: 'no_balanced_json' }
  try {
    return { ok: true, value: JSON.parse(slice) }
  } catch (e) {
    return { ok: false, error: `parse_failed: ${e.message}` }
  }
}
