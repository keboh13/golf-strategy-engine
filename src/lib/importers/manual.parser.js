// ─── Manual paste parser ──────────────────────────────────────────────────────
// Built-in fallback so the Import tab works with no launch-monitor export:
// one shot per line, "club, carry[, offline]" — carry in yards, offline in
// yards (negative = left, positive = right). Example:
//   7i, 165
//   Driver, 272, -12

import { normalizeClubName, round1 } from '../golfdata/stats.js'

// club (no commas), carry number, optional offline number — applied to trimmed lines
const LINE_RE = /^([^,]+),\s*(-?\d+(?:\.\d+)?)\s*(?:,\s*(-?\d+(?:\.\d+)?)\s*)?$/

function nonEmptyLines(text) {
  return String(text ?? '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)
}

export default {
  id: 'manual',
  label: 'Manual paste (club, carry[, offline])',

  detect(text) {
    const lines = nonEmptyLines(text)
    if (lines.length === 0) return 0
    const matching = lines.filter(l => LINE_RE.test(l)).length
    // Deliberately low ceiling — any dedicated format parser should outrank this.
    return matching / lines.length >= 0.6 ? 0.1 : 0
  },

  parse(text) {
    const shots = []
    let skipped = 0
    for (const line of nonEmptyLines(text)) {
      const m = line.match(LINE_RE)
      if (!m) { skipped++; continue }
      const { key, label } = normalizeClubName(m[1])
      shots.push({
        clubKey: key,
        clubLabel: label,
        carryYds: round1(parseFloat(m[2])),
        totalYds: null,
        offlineYds: m[3] != null ? round1(parseFloat(m[3])) : null,
        ballSpeedMph: null,
        clubSpeedMph: null,
        launchDeg: null,
        spinRpm: null,
        apexFt: null,
        timestamp: null,
      })
    }
    if (shots.length === 0) throw new Error('No shots found')
    const warnings = []
    if (skipped > 0) {
      warnings.push(`Skipped ${skipped} line${skipped === 1 ? '' : 's'} that did not match "club, carry[, offline]"`)
    }
    return { source: 'manual', sessionDate: null, unitsDetected: 'yards', shots, warnings }
  },
}
