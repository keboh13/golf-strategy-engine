// ─── Score-history paste import ───────────────────────────────────────────────
// Pure module — no app imports. Parses pasted score history (GHIN.com Stats →
// Score History rows, generic CSV/TSV exports, or "date - course - score" lines)
// into round objects matching the app's scoring-history shape.

// Local copy of the app's toParStr logic (src/App.jsx) — keep in sync.
function toParStr(score, par = 72) {
  const diff = parseInt(score) - par
  if (isNaN(diff)) return ''
  return diff === 0 ? 'E' : diff > 0 ? `+${diff}` : String(diff)
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }
const MONTH_RE = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*'

function monthNum(name) {
  return MONTHS[String(name).slice(0, 3).toLowerCase()] || null
}

function ymd(y, m, d) {
  let yy = parseInt(y, 10), mm = parseInt(m, 10), dd = parseInt(d, 10)
  if (isNaN(yy) || isNaN(mm) || isNaN(dd)) return null
  if (mm > 12 && dd <= 12) { const t = mm; mm = dd; dd = t } // tolerate D/M/YYYY
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null
  if (yy < 100) yy += yy >= 70 ? 1900 : 2000
  if (yy < 1900 || yy > 2100) return null
  return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
}

// Normalize a date string to 'YYYY-MM-DD'. Accepts M/D/YYYY (or M-D-YYYY,
// 2-digit years), YYYY-MM-DD, 'D MMM YYYY' and 'MMM D, YYYY'. Returns null if
// not a recognizable date.
export function normalizeDate(s) {
  const t = String(s).trim()
  let m = t.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/)
  if (m) return ymd(m[1], m[2], m[3])
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})$/)
  if (m) return ymd(m[3], m[1], m[2])
  m = t.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/)
  if (m && monthNum(m[2])) return ymd(m[3], monthNum(m[2]), m[1])
  m = t.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/)
  if (m && monthNum(m[1])) return ymd(m[3], monthNum(m[1]), m[2])
  return null
}

// Find the first date-like token in a line. Returns { token, date } or null.
function findDateToken(line) {
  const patterns = [
    /\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/,
    /\b\d{1,2}[-/]\d{1,2}[-/]\d{4}\b/,
    /\b\d{1,2}\/\d{1,2}\/\d{2}\b/,
    new RegExp(`\\b\\d{1,2}\\s+${MONTH_RE}\\.?,?\\s+\\d{4}\\b`, 'i'),
    new RegExp(`\\b${MONTH_RE}\\.?\\s+\\d{1,2},?\\s+\\d{4}\\b`, 'i'),
  ]
  for (const re of patterns) {
    const m = line.match(re)
    if (m) {
      const date = normalizeDate(m[0])
      if (date) return { token: m[0], date }
    }
  }
  return null
}

function cleanCourse(s) {
  const cleaned = String(s)
    .replace(/[\t]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s\-–—,;:|ⓘ⌄▾▸]+/, '')
    .replace(/[\s\-–—,;:|ⓘ⌄▾▸]+$/, '')
    .trim()
  return /[A-Za-z]/.test(cleaned) ? cleaned : null
}

function makeRound({ course, date, score, par = 72, roundType = 'Casual', notes = '', location = '' }) {
  return {
    course,
    location,
    date,
    score,
    par,
    toPar: toParStr(score, par),
    roundType,
    conditions: 'Normal',
    notes,
  }
}

// Lines that are obvious headers / UI chrome — skipped silently, no warning.
function isNoiseLine(line) {
  const l = line.toLowerCase()
  if (/^(no stats|score history|stats|graph view|round with advanced stats|filter by.*|\d+ most recent scores)$/.test(l)) return true
  if (!/\d/.test(line) && /\bdate\b/.test(l) && /\b(score|course)\b/.test(l)) return true
  return false
}

// GHIN.com Score History row, e.g. (tab- or space-separated):
//   76 A   06/03/2020   74.7/133   -   1.1   Streamsong Resort BLACK   No Stats
// Score type letters: H home, A away, T tournament, C competition, P penalty,
// N nine-hole, E exceptional. T/C → Tournament, everything else → Casual.
function parseGhinLine(line) {
  const typeM = line.match(/(?:^|[\s,])(\d{2,3})\s*([HACTPNE])(?=[\s,]|$)/)
  if (!typeM) return null
  const dateInfo = findDateToken(line)
  if (!dateInfo) return null
  const score = parseInt(typeM[1], 10)
  if (score < 40 || score > 200) return null
  const letter = typeM[2].toUpperCase()

  let rest = line.replace(typeM[0], ' ').replace(dateInfo.token, ' ')

  // Optional "rating / slope" (e.g. 74.7/133 or 70.6 / 128)
  let rating = null, slope = null
  const ratingM = rest.match(/(?:^|[\s,])(\d{2}(?:\.\d)?)\s*\/\s*(\d{2,3})(?=$|[\s,])/)
  if (ratingM && parseFloat(ratingM[1]) >= 55 && parseFloat(ratingM[1]) <= 85 &&
      parseInt(ratingM[2], 10) >= 55 && parseInt(ratingM[2], 10) <= 155) {
    rating = ratingM[1]
    slope = ratingM[2]
    rest = rest.replace(ratingM[0], ' ')
  }

  rest = rest
    .replace(/\bno stats\b/gi, ' ')
    .replace(/\bpcc\b\s*:?\s*/gi, ' ')
    .replace(/(?:^|[\s,])[+-]?\d{1,3}\.\d+(?=$|[\s,])/g, ' ')   // differential
    .replace(/(?:^|[\s,])[-–—](?=$|[\s,])/g, ' ')               // bare dash (PCC column)

  const course = cleanCourse(rest)
  if (!course) return null

  return makeRound({
    course,
    date: dateInfo.date,
    score,
    roundType: letter === 'T' || letter === 'C' ? 'Tournament' : 'Casual',
    notes: rating ? `Imported from GHIN paste; rating/slope ${rating}/${slope}` : 'Imported from GHIN paste',
  })
}

// Generic delimited line: tab-, comma-, or " - "-separated fields containing a
// date, a course name, a score, and optionally par / location / round type —
// in any reasonable column order, e.g.:
//   2026-06-01,Rhodes Ranch GC,68,72
//   6/8/2026 - Rhodes Ranch GC - 68
//   TPC Summerlin\t6/3/2026\t74
function parseDelimitedLine(line) {
  // Protect "MMM D, YYYY" dates from the comma split
  const protectedLine = line.replace(/([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})/g, '$1 $2 $3')
  let parts
  if (protectedLine.includes('\t')) parts = protectedLine.split('\t')
  else if (protectedLine.includes(',')) parts = protectedLine.split(',')
  else if (/\s[-–—]\s/.test(protectedLine)) parts = protectedLine.split(/\s+[-–—]\s+/)
  else return null
  parts = parts.map(p => p.trim()).filter(p => p !== '')
  if (parts.length < 2) return null

  let date = null, score = null, par = null, ratingSlope = null, roundType = null
  const textParts = []

  for (const p of parts) {
    if (!date) {
      const d = normalizeDate(p)
      if (d) { date = d; continue }
    }
    if (/^\d{2}(\.\d)?\s*\/\s*\d{2,3}$/.test(p)) { if (!ratingSlope) ratingSlope = p.replace(/\s+/g, ''); continue }
    if (/^[+-]?\d+\.\d+$/.test(p)) continue            // differential-like
    if (/^[-–—]$/.test(p)) continue                    // bare dash
    if (/^no stats$/i.test(p)) continue
    if (/^(tournament|competition|qualifier)$/i.test(p)) { roundType = 'Tournament'; continue }
    if (/^(casual|practice|practice round)$/i.test(p)) { roundType = 'Casual'; continue }
    if (/^\d{2,3}$/.test(p)) {
      const n = parseInt(p, 10)
      if (score === null && n >= 40 && n <= 200) { score = n; continue }
      if (score !== null && par === null && n >= 27 && n <= 73) { par = n; continue }
      continue
    }
    textParts.push(p)
  }

  if (!date || score === null || textParts.length === 0) return null
  const course = cleanCourse(textParts[0])
  if (!course) return null
  const location = textParts.slice(1).map(t => cleanCourse(t)).filter(Boolean).join(', ')

  return makeRound({
    course,
    location,
    date,
    score,
    par: par ?? 72,
    roundType: roundType || 'Casual',
    notes: ratingSlope ? `Imported from paste; rating/slope ${ratingSlope}` : '',
  })
}

// Last resort: an undelimited line with a date, exactly one plausible score
// (optionally followed by par), and a course name, e.g.:
//   6/8/2026 Rhodes Ranch GC 68
function parseLooseLine(line) {
  const dateInfo = findDateToken(line)
  if (!dateInfo) return null
  let rest = line.replace(dateInfo.token, ' ')

  let ratingSlope = null
  const ratingM = rest.match(/(?:^|[\s,])(\d{2}(?:\.\d)?)\s*\/\s*(\d{2,3})(?=$|[\s,])/)
  if (ratingM && parseFloat(ratingM[1]) >= 55 && parseFloat(ratingM[1]) <= 85 &&
      parseInt(ratingM[2], 10) >= 55 && parseInt(ratingM[2], 10) <= 155) {
    ratingSlope = `${ratingM[1]}/${ratingM[2]}`
    rest = rest.replace(ratingM[0], ' ')
  }

  const tokens = rest.split(/[\s,]+/).filter(Boolean)
  const intIdx = []
  tokens.forEach((t, i) => { if (/^\d{2,3}$/.test(t) && +t >= 27 && +t <= 200) intIdx.push(i) })

  let score = null, par = null
  if (intIdx.length === 1 && +tokens[intIdx[0]] >= 40) {
    score = +tokens[intIdx[0]]
  } else if (intIdx.length === 2 && +tokens[intIdx[0]] >= 40 && +tokens[intIdx[1]] >= 27 && +tokens[intIdx[1]] <= 73) {
    score = +tokens[intIdx[0]]
    par = +tokens[intIdx[1]]
  } else {
    return null // no score, or too ambiguous
  }

  const course = cleanCourse(tokens.filter((_, i) => !intIdx.includes(i)).join(' '))
  if (!course) return null

  return makeRound({
    course,
    date: dateInfo.date,
    score,
    par: par ?? 72,
    notes: ratingSlope ? `Imported from paste; rating/slope ${ratingSlope}` : '',
  })
}

// Dedupe key: same day + same course (case/space-insensitive) + same score.
function roundKey(r) {
  return `${r.date}|${String(r.course).toLowerCase().replace(/\s+/g, ' ').trim()}|${r.score}`
}

// Parse pasted score history. Returns { rounds, warnings }.
// Duplicates — within the paste or against `existingRounds` (the app's
// current scoring history) — are skipped with a warning.
// Throws Error('No rounds found') when nothing parseable is present.
export function parseScorePaste(text, existingRounds = []) {
  const lines = String(text ?? '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  const rounds = []
  const warnings = []
  const seen = new Set(
    (existingRounds || [])
      .filter(r => r && r.date && r.course && r.score !== '' && r.score != null)
      .map(roundKey)
  )

  for (const line of lines) {
    if (isNoiseLine(line)) continue
    const round = parseGhinLine(line) || parseDelimitedLine(line) || parseLooseLine(line)
    if (!round) {
      warnings.push(`Could not parse line: "${line}"`)
      continue
    }
    const key = roundKey(round)
    if (seen.has(key)) {
      warnings.push(`Skipped duplicate: ${round.date} ${round.course} (${round.score})`)
      continue
    }
    seen.add(key)
    rounds.push(round)
  }

  if (rounds.length === 0) throw new Error('No rounds found')
  return { rounds, warnings }
}
