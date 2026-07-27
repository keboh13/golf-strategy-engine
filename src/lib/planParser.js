// Pure function that parses a game-plan markdown string into structured
// sections: preamble, per-hole data (with optional green-json), and postamble.
// Extracted from App.jsx (lines 592-631) — used in the Prep flow's
// companion/hole-by-hole view.

export function parsePlanHoles(plan) {
  if (!plan) return { preamble: '', holes: [], postamble: '' }
  const lines = plan.split('\n')
  const holeRegex = /^###?\s*Hole\s+(\d+)/i
  const sectionRegex = /^##\s/
  let preambleEnd = -1
  const holes = []
  let cur = null

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(holeRegex)
    if (m) {
      if (cur) { cur.end = i; holes.push(cur) }
      if (preambleEnd < 0) preambleEnd = i
      cur = { num: parseInt(m[1], 10), start: i, end: lines.length }
    } else if (cur && sectionRegex.test(lines[i]) && !holeRegex.test(lines[i])) {
      cur.end = i
      holes.push(cur)
      cur = null
    }
  }
  if (cur) holes.push(cur)

  const preamble = preambleEnd > 0 ? lines.slice(0, preambleEnd).join('\n') : plan
  const postStart = holes.length ? holes[holes.length - 1].end : lines.length
  const postamble = lines.slice(postStart).join('\n')

  const greenJsonRegex = /```green-json\s*\n([\s\S]*?)\n```/
  const holeData = holes.map(h => {
    const content = lines.slice(h.start, h.end).join('\n')
    const gm = content.match(greenJsonRegex)
    let green = null
    if (gm) {
      try { green = JSON.parse(gm[1].trim()) } catch {}
    }
    return { num: h.num, content: content.replace(greenJsonRegex, '').trim(), green }
  })

  return { preamble, holes: holeData, postamble }
}
