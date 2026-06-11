// ─── Parser registry ──────────────────────────────────────────────────────────
// Every importer in this directory named `*.parser.js` is auto-registered via
// its default export. Parser contract:
//   export default { id, label, detect(text) → 0..1, parse(text) → NormalizedSession }

const modules = import.meta.glob('./*.parser.js', { eager: true })

export const parsers = Object.values(modules)
  .map(mod => mod && mod.default)
  .filter(Boolean)

// Returns the parser whose detect(text) scores highest. Ties keep the first
// registered parser; if every score is ≤ 0, returns null.
export function detectParser(text) {
  let best = null
  let bestScore = 0
  for (const parser of parsers) {
    let score = 0
    try { score = Number(parser.detect(text)) || 0 } catch { score = 0 }
    if (score > bestScore) { best = parser; bestScore = score }
  }
  return bestScore > 0 ? best : null
}
