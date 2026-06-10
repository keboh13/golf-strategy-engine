// Garmin R10 parser — Garmin Golf app per-session CSV export.
//
// Format notes (verified against real exports):
// - UTF-8, usually with a BOM. Row 1 is the header row:
//   "Date,Player,Club Name,Club Type,Club Speed,...,Apex Height,Carry Distance,
//    Carry Deviation Angle,Carry Deviation Distance,Total Distance,
//    Total Deviation Angle,Total Deviation Distance,..."
//   Newer app versions insert extra columns (e.g. "Brand/Model"), so every
//   column is resolved by header name, never by position.
// - Row 2 is a units row with bracketed per-column units, e.g.
//   ",,,,[mph],[deg],...,[yds],[Yards],[deg],[Yards],...". Metric exports use
//   [km/h] (or [m/s]) for speeds and [Meters]/[m] for distances.
// - Deviation sign convention: negative = LEFT of the target line (it tracks
//   the sign of Launch Direction / Spin Axis in the same rows), which already
//   matches NormalizedShot.offlineYds — values pass through unflipped.
// - The R10 usually estimates spin ("Spin Rate Type" = "Estimated").
//
// This module is intentionally self-contained: no imports from the app.

const YDS_PER_METER = 1.09361
const MPH_PER_MS = 2.23694
const MPH_PER_KMH = 0.621371
const FT_PER_METER = 3.28084
const FT_PER_YD = 3

// ---------------------------------------------------------------------------
// Small CSV splitter (quoted fields, "" escapes, CRLF/LF/CR)
// ---------------------------------------------------------------------------
function parseCsv(text) {
  const s = String(text || '').replace(/^\uFEFF/, '')
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += c
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  // Drop rows that are entirely empty.
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''))
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------
function num(value) {
  if (value == null) return null
  const t = String(value).trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

function round1(n) {
  const r = Math.round(n * 10) / 10
  return r === 0 ? 0 : r // avoid -0
}

// ---------------------------------------------------------------------------
// Club matcher (local copy — shared spec across importers)
// ---------------------------------------------------------------------------
function slugify(label) {
  const slug = String(label)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'unknown'
}

// Returns a canonical club key or null when the label is not recognized.
function canonicalClubKey(rawLabel) {
  const s = String(rawLabel || '')
    .toLowerCase()
    .replace(/[\s°º]+/g, '') // strip spaces and degree signs
  if (!s) return null
  if (/^(driver|dr|d)$/.test(s)) return 'driver'
  let m
  if ((m = s.match(/^([2-9])w(ood)?$/))) return `${m[1]}w`
  if ((m = s.match(/^([1-5])(h|hy|hybrid|rescue)$/))) return `${m[1]}h`
  if ((m = s.match(/^([1-9])i(ron)?$/))) return `${m[1]}i`
  if (s === 'pw' || s.includes('pitching')) return 'pw'
  if (s === 'gw' || s === 'aw' || s.includes('gap') || s.includes('approach')) return 'gw'
  if (s === 'sw' || s.includes('sand')) return 'sw'
  if (s === 'lw' || s.includes('lob')) return 'lw'
  // Bare loft 44..64, optionally "NN deg"/"NN degree(s)" (Garmin uses "60 Degree")
  if ((m = s.match(/^(\d{2})(deg(ree)?s?)?$/))) {
    const loft = Number(m[1])
    if (loft >= 44 && loft <= 64) return String(loft)
  }
  return null
}

function matchClub(clubName, clubType) {
  const name = String(clubName || '').trim()
  const type = String(clubType || '').trim()
  const label = name || type || 'Unknown'
  const clubKey = canonicalClubKey(name) || canonicalClubKey(type) || slugify(name || type)
  return { clubKey, clubLabel: label }
}

// ---------------------------------------------------------------------------
// Units (from the bracketed units row)
// ---------------------------------------------------------------------------
function cleanUnit(cell) {
  return String(cell || '')
    .trim()
    .replace(/^\[|\]$/g, '')
    .trim()
    .toLowerCase()
}

function speedToMphFactor(u) {
  if (!u) return null
  if (u.includes('mph') || u.includes('mi/h')) return 1
  if (u.includes('km') || u === 'kph') return MPH_PER_KMH // [km/h], [km/t], [kmh]
  if (u.includes('m/s') || u === 'ms') return MPH_PER_MS
  return null
}

function distanceToYardsFactor(u) {
  if (!u) return null
  if (u.includes('yd') || u.includes('yard')) return 1
  if (u.includes('met') || u === 'm') return YDS_PER_METER
  return null
}

function heightToFeetFactor(u) {
  if (!u) return null
  if (u.includes('yd') || u.includes('yard')) return FT_PER_YD
  if (u.includes('ft') || u.includes('feet') || u.includes('foot')) return 1
  if (u.includes('met') || u === 'm') return FT_PER_METER
  return null
}

// ---------------------------------------------------------------------------
// Dates — "5/1/25 7:14:22 PM", "5/4/26 10:51:29", "2025-05-01 19:14:22", ...
// ---------------------------------------------------------------------------
const DATE_RE =
  /^(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm]\.?)?)?$/

function pad2(n) {
  return String(n).padStart(2, '0')
}

function parseGarminDate(raw) {
  const t = String(raw || '').trim()
  if (!t) return null
  const m = t.match(DATE_RE)
  if (!m) return null
  let year
  let month
  let day
  if (m[1].length === 4) {
    // YYYY-MM-DD ordering
    year = Number(m[1])
    month = Number(m[2])
    day = Number(m[3])
  } else {
    // M/D/Y ordering (US-locale Garmin Golf export); swap when it can only be D/M/Y
    month = Number(m[1])
    day = Number(m[2])
    year = Number(m[3])
    if (month > 12 && day <= 12) {
      const tmp = month
      month = day
      day = tmp
    }
    if (year < 100) year += 2000
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const date = `${year}-${pad2(month)}-${pad2(day)}`
  if (m[4] == null) return date // date-only is still valid ISO 8601
  let hour = Number(m[4])
  const minute = Number(m[5])
  const second = m[6] == null ? 0 : Number(m[6])
  const ampm = m[7] ? m[7].toLowerCase() : null
  if (ampm) {
    if (hour < 1 || hour > 12) return null
    if (ampm.startsWith('p') && hour < 12) hour += 12
    if (ampm.startsWith('a') && hour === 12) hour = 0
  }
  if (hour > 23 || minute > 59 || second > 59) return null
  return `${date}T${pad2(hour)}:${pad2(minute)}:${pad2(second)}`
}

// ---------------------------------------------------------------------------
// Header signature
// ---------------------------------------------------------------------------
const SIGNATURE_COLUMNS = [
  'club type',
  'club speed',
  'ball speed',
  'smash factor',
  'launch angle',
  'launch direction',
  'spin rate',
  'spin rate type',
  'spin axis',
  'apex height',
  'carry distance',
  'carry deviation angle',
  'carry deviation distance',
  'total distance',
  'total deviation angle',
  'total deviation distance',
]

function normHeader(h) {
  return String(h || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function headerSet(text) {
  const firstLine = String(text || '')
    .replace(/^\uFEFF/, '')
    .slice(0, 8000)
    .split(/\r\n|\r|\n/)[0]
  const rows = parseCsv(firstLine)
  const cells = rows.length > 0 ? rows[0] : []
  return new Set(cells.map(normHeader))
}

// ---------------------------------------------------------------------------
// Per-club aggregates — turns parsed shots into a compact per-club summary
// suitable for the AI recommendation prompt (and the bag UI).
// ---------------------------------------------------------------------------
function finiteVals(shots, field) {
  const out = []
  for (const s of shots) {
    const v = s[field]
    if (typeof v === 'number' && Number.isFinite(v)) out.push(v)
  }
  return out
}

function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
}

// Sample standard deviation (n−1); needs ≥ 3 samples, else null.
function sampleStd(values) {
  if (values.length < 3) return null
  const m = mean(values)
  const ss = values.reduce((acc, v) => acc + (v - m) ** 2, 0)
  return Math.sqrt(ss / (values.length - 1))
}

function r1(n) {
  return n == null ? null : round1(n)
}

// Display/sort order: driver, woods, hybrids, irons, wedges (by loft), other.
function clubOrder(key) {
  if (key === 'driver') return 0
  let m
  if ((m = key.match(/^([2-9])w$/))) return 10 + Number(m[1])
  if ((m = key.match(/^([1-5])h$/))) return 20 + Number(m[1])
  if ((m = key.match(/^([1-9])i$/))) return 30 + Number(m[1])
  const wedgeLoft = { pw: 46, gw: 50, sw: 56, lw: 60 }[key]
  if (wedgeLoft) return 40 + wedgeLoft
  if ((m = key.match(/^(4[4-9]|5[0-9]|6[0-4])$/))) return 40 + Number(m[1])
  return 100
}

// summarizeByClub(shots) → per-club aggregate rows, longest-hitting club first
// within the standard bag order. Per club:
//   { clubKey, clubLabel, shotCount,
//     carryAvgYds, carryMinYds, carryMaxYds, carryStdYds,
//     totalAvgYds,
//     offlineAvgYds  (signed bias: negative = LEFT),
//     offlineStdYds  (lateral dispersion),
//     ballSpeedAvgMph, clubSpeedAvgMph, launchAvgDeg, spinAvgRpm, apexAvgFt }
// Missing values are null — never 0/NaN. Std fields need ≥ 3 samples.
export function summarizeByClub(shots) {
  const byClub = new Map()
  for (const shot of shots || []) {
    const key = shot.clubKey || 'unknown'
    if (!byClub.has(key)) byClub.set(key, { clubLabel: shot.clubLabel || key, shots: [] })
    byClub.get(key).shots.push(shot)
  }

  const rows = []
  for (const [clubKey, group] of byClub) {
    const carry = finiteVals(group.shots, 'carryYds')
    const total = finiteVals(group.shots, 'totalYds')
    const offline = finiteVals(group.shots, 'offlineYds')
    rows.push({
      clubKey,
      clubLabel: group.clubLabel,
      shotCount: group.shots.length,
      carryAvgYds: r1(mean(carry)),
      carryMinYds: carry.length ? r1(Math.min(...carry)) : null,
      carryMaxYds: carry.length ? r1(Math.max(...carry)) : null,
      carryStdYds: r1(sampleStd(carry)),
      totalAvgYds: r1(mean(total)),
      offlineAvgYds: r1(mean(offline)),
      offlineStdYds: r1(sampleStd(offline)),
      ballSpeedAvgMph: r1(mean(finiteVals(group.shots, 'ballSpeedMph'))),
      clubSpeedAvgMph: r1(mean(finiteVals(group.shots, 'clubSpeedMph'))),
      launchAvgDeg: r1(mean(finiteVals(group.shots, 'launchDeg'))),
      spinAvgRpm: r1(mean(finiteVals(group.shots, 'spinRpm'))),
      apexAvgFt: r1(mean(finiteVals(group.shots, 'apexFt'))),
    })
  }

  return rows.sort(
    (a, b) => clubOrder(a.clubKey) - clubOrder(b.clubKey) || a.clubKey.localeCompare(b.clubKey)
  )
}

export default {
  id: 'garmin-r10',
  label: 'Garmin R10 (Garmin Golf CSV)',

  detect(text) {
    if (typeof text !== 'string' || text.trim() === '') return 0
    let headers
    try {
      headers = headerSet(text)
    } catch {
      return 0
    }
    const hits = SIGNATURE_COLUMNS.filter((c) => headers.has(c)).length
    if (!headers.has('club type') || !headers.has('carry distance')) {
      return hits >= 4 ? 0.3 : 0
    }
    if (hits >= 10) return 0.95
    if (hits >= 6) return 0.8
    return 0.4
  },

  parse(text) {
    const rows = parseCsv(text)
    if (rows.length === 0) {
      throw new Error('The file is empty — no shots found')
    }

    const header = rows[0].map(normHeader)
    const colIndex = {}
    header.forEach((name, i) => {
      if (name && colIndex[name] == null) colIndex[name] = i
    })

    const hasClubColumn = colIndex['club type'] != null || colIndex['club name'] != null
    if (!hasClubColumn || colIndex['carry distance'] == null) {
      throw new Error(
        'This does not look like a Garmin Golf CSV export (expected columns like "Club Type" and "Carry Distance")'
      )
    }

    // Units row: directly under the header, cells like "[mph]" / "[Meters]".
    const warnings = []
    let unitsRow = null
    let dataStart = 1
    if (rows.length > 1 && rows[1].some((c) => /^\s*\[[^\]]*\]\s*$/.test(c))) {
      unitsRow = rows[1]
      dataStart = 2
    }

    const cell = (row, name) => {
      const i = colIndex[name]
      return i == null || i >= row.length ? '' : row[i]
    }
    const unitFor = (name) => {
      if (!unitsRow) return ''
      const i = colIndex[name]
      return i == null || i >= unitsRow.length ? '' : cleanUnit(unitsRow[i])
    }

    // Per-column conversion factors (null factor → pass value through as-is).
    const carryUnit = unitFor('carry distance')
    const distFactor = distanceToYardsFactor(carryUnit)
    const totalFactor = distanceToYardsFactor(unitFor('total distance')) ?? distFactor
    const offlineFactor =
      distanceToYardsFactor(unitFor('total deviation distance')) ??
      distanceToYardsFactor(unitFor('carry deviation distance')) ??
      distFactor
    const ballSpeedFactor = speedToMphFactor(unitFor('ball speed'))
    const clubSpeedFactor = speedToMphFactor(unitFor('club speed')) ?? ballSpeedFactor
    const apexFactor = heightToFeetFactor(unitFor('apex height'))

    let unitsDetected = 'unknown'
    if (carryUnit.includes('yd') || carryUnit.includes('yard')) {
      unitsDetected = 'yards'
    } else if (carryUnit.includes('met') || carryUnit === 'm') {
      unitsDetected = 'meters'
    } else if (!unitsRow) {
      warnings.push('No units row found in the file; values were imported unconverted (assumed yards and mph)')
    } else {
      warnings.push(`Unrecognized distance unit "${carryUnit || '?'}"; distances were imported unconverted`)
    }

    const convert = (row, name, factor) => {
      const v = num(cell(row, name))
      if (v == null) return null
      return round1(v * (factor ?? 1))
    }

    const shots = []
    let badDates = 0
    let estimatedSpin = 0
    for (let r = dataStart; r < rows.length; r++) {
      const row = rows[r]
      const { clubKey, clubLabel } = matchClub(cell(row, 'club name'), cell(row, 'club type'))

      const rawDate = cell(row, 'date')
      const timestamp = parseGarminDate(rawDate)
      if (rawDate.trim() !== '' && timestamp == null) badDates++

      if (/^estimated$/i.test(cell(row, 'spin rate type').trim())) estimatedSpin++

      // Garmin's deviation distances are already negative=LEFT / positive=RIGHT.
      // Prefer the total (final position) deviation, fall back to carry deviation.
      const offlineYds =
        convert(row, 'total deviation distance', offlineFactor) ??
        convert(row, 'carry deviation distance', offlineFactor)

      shots.push({
        clubKey,
        clubLabel,
        carryYds: convert(row, 'carry distance', distFactor),
        totalYds: convert(row, 'total distance', totalFactor),
        offlineYds,
        ballSpeedMph: convert(row, 'ball speed', ballSpeedFactor),
        clubSpeedMph: convert(row, 'club speed', clubSpeedFactor),
        launchDeg: convert(row, 'launch angle', null),
        spinRpm: convert(row, 'spin rate', null),
        apexFt: convert(row, 'apex height', apexFactor),
        timestamp,
      })
    }

    if (shots.length === 0) {
      throw new Error('No shots found')
    }

    if (badDates > 0) {
      warnings.push(`Could not parse the shot date/time for ${badDates} of ${shots.length} shots`)
    }
    if (estimatedSpin > 0) {
      warnings.push(`Spin rate was estimated (not measured) by the R10 for ${estimatedSpin} of ${shots.length} shots`)
    }

    const firstTimestamp = shots.find((s) => s.timestamp != null)
    const sessionDate = firstTimestamp ? firstTimestamp.timestamp.slice(0, 10) : null

    return {
      source: 'garmin-r10',
      sessionDate,
      unitsDetected,
      shots,
      warnings,
    }
  },
}
