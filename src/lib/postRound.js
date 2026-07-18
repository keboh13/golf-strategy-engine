// Post-round → next-round loop.
//
// The old workflow captured "Notes for AI refinement" as a single freeform
// blob per brief. That's genuinely useful, but the audit noted the retention
// engine is the round-over-round improvement — for that to fire, the next
// brief has to *see* what went wrong last time and adjust concretely.
//
// This module owns two pieces:
//   1. A per-hole capture shape:
//      { scores: { [holeNum]: number }, notes: { [holeNum]: string }, generalNotes: string }
//   2. Selecting the freshest post-round data for a course, and turning it
//      into a compact prompt block the LLM can use.

// Pick the newest saved brief for `courseName` that has any structured
// post-round data. Deliberately loose on match — case-insensitive, trims
// whitespace — because course names come from many sources (Library,
// manual entry, scorecard search) and may differ subtly.
export function getLatestPostRoundForCourse(savedBriefs, courseName) {
  if (!Array.isArray(savedBriefs) || !courseName) return null
  const target = String(courseName).trim().toLowerCase()
  for (const b of savedBriefs) {
    if (!b || String(b.course || '').trim().toLowerCase() !== target) continue
    const pr = b.postRound
    if (!pr) continue
    const scoresCount = pr.scores ? Object.keys(pr.scores).length : 0
    const notesCount  = pr.notes  ? Object.values(pr.notes).filter(Boolean).length : 0
    if (!scoresCount && !notesCount && !pr.generalNotes) continue
    return { ...pr, date: b.date, tee: b.tee }
  }
  return null
}

// Render the prompt block. Returns an empty string when there's nothing
// meaningful to say (so callers can `if (block) …` without needing to
// separately check for structured emptiness).
export function renderPriorRoundBlock(priorRound) {
  if (!priorRound) return ''
  const scores = priorRound.scores || {}
  const notes  = priorRound.notes  || {}
  const holeLines = []
  const holeNums = new Set([...Object.keys(scores), ...Object.keys(notes)].map(n => parseInt(n)).filter(n => n >= 1 && n <= 18))
  const sorted = Array.from(holeNums).sort((a, b) => a - b)
  for (const n of sorted) {
    const s = scores[n]
    const noteRaw = notes[n]
    const bits = []
    if (Number.isFinite(s)) bits.push(`shot ${s}`)
    if (typeof noteRaw === 'string' && noteRaw.trim()) bits.push(noteRaw.trim())
    if (bits.length) holeLines.push(`  H${n}: ${bits.join(' — ')}`)
  }
  if (!holeLines.length && !priorRound.generalNotes) return ''
  const header = `PRIOR ROUND — HINDSIGHT (${priorRound.date || 'previous round'}${priorRound.tee ? ' · ' + priorRound.tee : ''}):
Use this to correct specific past mistakes on the same holes — call it out explicitly ("last time you went long on 7 — clubbing down") rather than treating it as generic history.`
  const body = holeLines.length ? holeLines.join('\n') : ''
  const gen  = priorRound.generalNotes ? `\n  General: ${priorRound.generalNotes.trim()}` : ''
  return `${header}\n${body}${gen}`
}
