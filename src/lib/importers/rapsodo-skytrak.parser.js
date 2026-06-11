/**
 * Rapsodo MLM/MLM2PRO + SkyTrak CSV parser.
 *
 * One module that handles BOTH export formats with two detect signatures:
 *
 *  - Rapsodo MLM / MLM2PRO session export (R-Cloud / app export). Headers like:
 *      Shot Number, Date, Club Type, Club Brand, Club Model, Ball Speed,
 *      Club Speed, Smash Factor, Launch Angle, Launch Direction, Spin Rate,
 *      Spin Axis, Apex, Carry Distance, Total Distance, Side Carry, Descent Angle
 *    Signature: "Club Type" + "Side Carry" + a carry/total distance column.
 *    Rapsodo exports often include per-club "Average" summary rows -- these are
 *    skipped with a warning. Side Carry / Launch Direction may be annotated
 *    with "L"/"R" (e.g. "12.4 R") or be plain signed numbers (positive = right).
 *
 *  - SkyTrak shot-history export (Driving Range > History > Export). Headers like:
 *      Shot, Date, Club, Ball Speed (mph), Club Speed (mph), Launch Angle (deg),
 *      Side Angle (deg), Back Spin (rpm), Side Spin (rpm), Carry (yds), Roll (yds),
 *      Total (yds), Offline (yds), Max Height (ft), Descent Angle (deg), Flight Time (sec)
 *    Signature: "Offline" plus several of Roll / Back Spin / Side Angle /
 *    Side Spin / Flight Time. SkyTrak annotates lateral values with "L"/"R".
 *
 * Output sign convention (shared spec): offlineYds negative = LEFT, positive = RIGHT.
 * Units are detected from header annotations -- "(m)" style headers are converted
 * (meters -> yards x1.09361, m/s -> mph x2.23694, km/h -> mph x0.621371,
 *  meters -> feet x3.28084, yards -> feet x3 for apex/height columns).
 * Missing values are null (never 0/undefined/NaN); numbers rounded to 1 decimal.
 *
 * Fully standalone: no imports from the app or other src/lib files.
 */

// ---------------------------------------------------------------------------
// Small robust CSV splitter (quoted fields, escaped quotes, CRLF / lone CR).
// ---------------------------------------------------------------------------

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (ch === '\r') {
      if (text[i + 1] !== '\n') {
        // lone CR acts as a newline; CRLF is handled by the '\n' branch
        row.push(field)
        rows.push(row)
        row = []
        field = ''
      }
    } else {
      field += ch
    }
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

function isEmptyRow(row) {
  return row.every((c) => !String(c == null ? '' : c).trim())
}

// ---------------------------------------------------------------------------
// Local club matcher (copy -- shared spec across importer units).
// Canon keys: driver, 2w-9w, 1h-5h, 1i-9i, pw, gw, sw, lw, bare loft 44-64.
// ---------------------------------------------------------------------------

function slugify(label) {
  return String(label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function matchClub(rawLabel) {
  const label = String(rawLabel == null ? '' : rawLabel).trim()
  const norm = label.toLowerCase().replace(/[°º]/g, '').replace(/\s+/g, '')
  if (!norm) return slugify(label)

  if (/^(driver|dr|d)$/.test(norm)) return 'driver'
  let m = /^([1-9])w(ood)?$/.exec(norm)
  if (m) return `${m[1]}w`
  m = /^([1-9])(h|hy|hybrid|rescue)$/.exec(norm)
  if (m) return `${m[1]}h`
  m = /^([1-9])i(ron)?$/.exec(norm)
  if (m) return `${m[1]}i`
  if (norm === 'pw' || norm.includes('pitching')) return 'pw'
  if (norm === 'gw' || norm === 'aw' || norm.includes('gap') || norm.includes('approach')) return 'gw'
  if (norm === 'sw' || norm.includes('sand')) return 'sw'
  if (norm === 'lw' || norm.includes('lob')) return 'lw'
  m = /^(\d{2})$/.exec(norm)
  if (m) {
    const loft = Number(m[1])
    if (loft >= 44 && loft <= 64) return String(loft)
  }
  return slugify(label)
}

// ---------------------------------------------------------------------------
// Value parsing helpers.
// ---------------------------------------------------------------------------

function round1(v) {
  if (v == null || !isFinite(v)) return null
  return Math.round(v * 10) / 10
}

function parseNum(cell) {
  if (cell == null) return null
  const s = String(cell).trim()
  if (!s) return null
  const m = /-?\d[\d,]*(?:\.\d+)?/.exec(s)
  if (!m) return null
  const v = parseFloat(m[0].replace(/,/g, ''))
  return isFinite(v) ? v : null
}

// Lateral values may be "12.4 R", "8.0 L", "L 3.2", "12.4R" or plain signed
// numbers. L => negative (left), R => positive (right). Plain signed numbers
// pass through (both formats treat positive as right of target).
function parseDirectional(cell) {
  if (cell == null) return null
  const s = String(cell)
    .trim()
    .replace(/\b(yds?|yards?|meters?|mtrs?|m|ft|feet)\b\.?/gi, '')
    .trim()
  if (!s) return null
  const m = /^([lr])?\s*(-?\d[\d,]*(?:\.\d+)?)\s*([lr])?$/i.exec(s)
  if (!m) return parseNum(s)
  const dir = (m[1] || m[3] || '').toLowerCase()
  let v = parseFloat(m[2].replace(/,/g, ''))
  if (!isFinite(v)) return null
  if (dir === 'l') v = -Math.abs(v)
  else if (dir === 'r') v = Math.abs(v)
  return v
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function buildDateParts(y, mo, d, hh, mm, ss, ampm) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  const date = `${y}-${pad2(mo)}-${pad2(d)}`
  if (hh == null) return { iso: date, date }
  let h = Number(hh)
  if (ampm) {
    const p = ampm.toLowerCase()
    if (p === 'pm' && h < 12) h += 12
    if (p === 'am' && h === 12) h = 0
  }
  return { iso: `${date}T${pad2(h)}:${pad2(mm)}:${pad2(ss == null ? 0 : ss)}`, date }
}

// Accepts ISO (YYYY-MM-DD[ HH:MM[:SS]]) and US-style M/D/YYYY with optional
// 12h or 24h time. Returns { iso, date } or null.
function parseTimestamp(cell) {
  if (cell == null) return null
  const s = String(cell).trim()
  if (!s) return null
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s)
  if (m) {
    return buildDateParts(Number(m[1]), Number(m[2]), Number(m[3]), m[4], m[5], m[6], null)
  }
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([APap][Mm])?)?$/.exec(s)
  if (m) {
    let year = Number(m[3])
    if (year < 100) year += 2000
    let month = Number(m[1])
    let day = Number(m[2])
    if (month > 12 && day <= 12) {
      // tolerate D/M/Y exports
      const t = month
      month = day
      day = t
    }
    return buildDateParts(year, month, day, m[4], m[5], m[6], m[7])
  }
  return null
}

// Pull a date out of free text (metadata lines like "Exported:,06/02/2025").
function findDateInText(text) {
  const m = /(\d{4}-\d{1,2}-\d{1,2})|(\d{1,2}\/\d{1,2}\/\d{2,4})/.exec(String(text == null ? '' : text))
  if (!m) return null
  const parsed = parseTimestamp(m[0])
  return parsed ? parsed.date : null
}

// ---------------------------------------------------------------------------
// Header analysis.
// ---------------------------------------------------------------------------

const SPEED_UNITS = { mph: true, kmh: true, ms: true }

function classifyUnit(raw) {
  const u = String(raw == null ? '' : raw).toLowerCase().replace(/[^a-z/]/g, '')
  if (!u) return null
  if (u.includes('mph')) return 'mph'
  if (/km\/?h|kph|kmh/.test(u)) return 'kmh'
  if (/^m\/?s$/.test(u)) return 'ms'
  if (/yd|yard/.test(u)) return 'yards'
  if (/ft|feet|foot/.test(u)) return 'feet'
  if (/^m$|meter|metre|mtr/.test(u)) return 'meters'
  if (u.includes('deg')) return 'deg'
  if (u.includes('rpm')) return 'rpm'
  if (u.includes('sec')) return 'sec'
  return null
}

// "Carry Distance (yds)" -> { key: 'carry distance', unit: 'yards' }
// "Ball MPH"             -> { key: 'ball', unit: 'mph' }
function parseHeaderCell(raw) {
  const original = String(raw == null ? '' : raw).trim()
  let unit = null
  const paren = /[([]([^)\]]*)[)\]]/.exec(original)
  if (paren) unit = classifyUnit(paren[1])
  let key = original
    .replace(/[([][^)\]]*[)\]]/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
  const tokens = key.split(' ')
  if (tokens.length > 1) {
    const trailing = classifyUnit(tokens[tokens.length - 1])
    if (trailing) {
      if (!unit) unit = trailing
      tokens.pop()
      key = tokens.join(' ')
    }
  }
  return { key, unit }
}

function resolveField(key, unit) {
  switch (key) {
    case 'club type':
    case 'club name':
      return 'club'
    case 'club':
      return unit && SPEED_UNITS[unit] ? 'clubSpeed' : 'club'
    case 'ball':
      return unit && SPEED_UNITS[unit] ? 'ballSpeed' : null
    case 'ball speed':
      return 'ballSpeed'
    case 'club speed':
    case 'club head speed':
    case 'clubhead speed':
      return 'clubSpeed'
    case 'carry':
    case 'carry distance':
      return 'carry'
    case 'total':
    case 'total distance':
      return 'total'
    case 'side carry':
    case 'offline':
    case 'offline distance':
    case 'side distance':
      return 'offline'
    case 'launch angle':
    case 'launch':
    case 'vertical launch':
      return 'launch'
    case 'spin rate':
    case 'total spin':
    case 'spin':
      return 'spin'
    case 'back spin':
    case 'backspin':
      return 'backspin'
    case 'apex':
    case 'apex height':
    case 'max height':
    case 'height':
    case 'peak height':
      return 'apex'
    case 'date':
    case 'time':
    case 'date time':
    case 'timestamp':
    case 'date and time':
      return 'date'
    default:
      return null
  }
}

// Returns { rapsodo, skytrak } confidence scores (0..1) for one row treated
// as a potential header row.
function scoreHeaderRow(cells) {
  const keys = cells.map((c) => parseHeaderCell(c).key)
  const has = (k) => keys.indexOf(k) !== -1

  let rapsodo = 0
  if (has('club type') && has('side carry') && (has('carry distance') || has('total distance'))) {
    rapsodo = 0.95
  } else {
    const hints = ['club type', 'side carry', 'smash factor', 'launch direction', 'spin axis'].filter(has).length
    if (hints >= 2 && (has('carry distance') || has('carry'))) rapsodo = 0.5
  }

  let skytrak = 0
  const stHints = ['offline', 'roll', 'back spin', 'side angle', 'side spin', 'flight time'].filter(has).length
  if (has('offline') && has('club') && stHints >= 3) skytrak = 0.9
  else if (has('offline') && stHints >= 4) skytrak = 0.85
  else if (stHints >= 2) skytrak = 0.4

  return { rapsodo, skytrak }
}

const MAX_HEADER_SCAN_ROWS = 60

// Finds the most plausible header row. Returns
// { index, format, score, cols, units } or null.
function findHeader(rows) {
  let best = null
  const limit = Math.min(rows.length, MAX_HEADER_SCAN_ROWS)
  for (let i = 0; i < limit; i++) {
    const row = rows[i]
    if (row.length < 4) continue
    const { rapsodo, skytrak } = scoreHeaderRow(row)
    const score = Math.max(rapsodo, skytrak)
    if (score > (best ? best.score : 0)) {
      const cols = {}
      const units = {}
      row.forEach((cell, idx) => {
        const { key, unit } = parseHeaderCell(cell)
        const field = resolveField(key, unit)
        if (field && cols[field] == null) {
          cols[field] = idx
          units[field] = unit || null
        }
      })
      if (cols.spin == null && cols.backspin != null) {
        // SkyTrak reports back spin + side spin; use back spin as spinRpm.
        cols.spin = cols.backspin
        units.spin = units.backspin
      }
      best = { index: i, format: rapsodo >= skytrak ? 'rapsodo' : 'skytrak', score, cols, units }
    }
  }
  return best
}

// ---------------------------------------------------------------------------
// Unit conversions (shared spec constants).
// ---------------------------------------------------------------------------

const M_TO_YDS = 1.09361
const MS_TO_MPH = 2.23694
const KMH_TO_MPH = 0.621371
const M_TO_FT = 3.28084
const YDS_TO_FT = 3

function convertDistance(v, unit) {
  if (v == null) return null
  if (unit === 'meters') return v * M_TO_YDS
  return v
}

function convertSpeed(v, unit) {
  if (v == null) return null
  if (unit === 'kmh') return v * KMH_TO_MPH
  if (unit === 'ms') return v * MS_TO_MPH
  return v
}

function convertApex(v, unit) {
  if (v == null) return null
  if (unit === 'meters') return v * M_TO_FT
  if (unit === 'yards') return v * YDS_TO_FT
  return v
}

// ---------------------------------------------------------------------------
// Row filtering.
// ---------------------------------------------------------------------------

// Rapsodo exports include per-club summary rows (first cell "Average"); some
// exports also emit "Avg"/"Summary"/"Totals" rows.
function isSummaryRow(row, clubIdx) {
  const candidates = [row[0], row[1]]
  if (clubIdx != null) candidates.push(row[clubIdx])
  return candidates.some((c) => c != null && /^(average|avg|summary|totals?)\b/i.test(String(c).trim()))
}

// ---------------------------------------------------------------------------
// Per-club aggregation -- normalized stats suitable for an AI recommendation
// prompt. Aggregates only non-null values; stddev is the sample standard
// deviation (null when fewer than 2 values). Clubs sorted longest-first.
// ---------------------------------------------------------------------------

function mean(values) {
  if (!values.length) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

function median(values) {
  if (!values.length) return null
  const sorted = values.slice().sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function sampleStdDev(values) {
  if (values.length < 2) return null
  const m = mean(values)
  const ss = values.reduce((acc, v) => acc + (v - m) * (v - m), 0)
  return Math.sqrt(ss / (values.length - 1))
}

/**
 * Groups normalized shots by clubKey and computes aggregate stats per club.
 *
 * @param {Array} shots NormalizedShot[] as produced by parse().
 * @returns {Array} one entry per club, sorted by avgCarryYds descending:
 *   { clubKey, clubLabel, shotCount,
 *     avgCarryYds, medianCarryYds, minCarryYds, maxCarryYds, carryStdDevYds,
 *     avgTotalYds, avgOfflineYds, offlineStdDevYds,
 *     avgBallSpeedMph, avgClubSpeedMph, avgLaunchDeg, avgSpinRpm, avgApexFt }
 *   Missing metrics are null, never 0/NaN; numbers rounded to 1 decimal.
 */
export function aggregateByClub(shots) {
  const groups = new Map()
  for (const shot of shots || []) {
    if (!shot || !shot.clubKey) continue
    let group = groups.get(shot.clubKey)
    if (!group) {
      group = { clubKey: shot.clubKey, clubLabel: shot.clubLabel || shot.clubKey, shots: [] }
      groups.set(shot.clubKey, group)
    }
    group.shots.push(shot)
  }

  const result = []
  for (const group of groups.values()) {
    const pick = (field) => group.shots.map((s) => s[field]).filter((v) => v != null && isFinite(v))
    const carries = pick('carryYds')
    const offlines = pick('offlineYds')
    result.push({
      clubKey: group.clubKey,
      clubLabel: group.clubLabel,
      shotCount: group.shots.length,
      avgCarryYds: round1(mean(carries)),
      medianCarryYds: round1(median(carries)),
      minCarryYds: carries.length ? round1(Math.min(...carries)) : null,
      maxCarryYds: carries.length ? round1(Math.max(...carries)) : null,
      carryStdDevYds: round1(sampleStdDev(carries)),
      avgTotalYds: round1(mean(pick('totalYds'))),
      avgOfflineYds: round1(mean(offlines)),
      offlineStdDevYds: round1(sampleStdDev(offlines)),
      avgBallSpeedMph: round1(mean(pick('ballSpeedMph'))),
      avgClubSpeedMph: round1(mean(pick('clubSpeedMph'))),
      avgLaunchDeg: round1(mean(pick('launchDeg'))),
      avgSpinRpm: round1(mean(pick('spinRpm'))),
      avgApexFt: round1(mean(pick('apexFt'))),
    })
  }

  result.sort((a, b) => {
    const ac = a.avgCarryYds == null ? -Infinity : a.avgCarryYds
    const bc = b.avgCarryYds == null ? -Infinity : b.avgCarryYds
    return bc - ac
  })
  return result
}

// ---------------------------------------------------------------------------
// Parser module (registry contract).
// ---------------------------------------------------------------------------

export default {
  id: 'rapsodo-skytrak',
  label: 'Rapsodo MLM / SkyTrak',

  // 0..1 confidence; >= 0.8 when either header signature matches.
  detect(text) {
    if (typeof text !== 'string' || !text.trim()) return 0
    const rows = parseCsv(stripBom(text).slice(0, 32768))
    let best = 0
    const limit = Math.min(rows.length, MAX_HEADER_SCAN_ROWS)
    for (let i = 0; i < limit; i++) {
      if (rows[i].length < 4) continue
      const { rapsodo, skytrak } = scoreHeaderRow(rows[i])
      best = Math.max(best, rapsodo, skytrak)
      if (best >= 0.95) break
    }
    return best
  },

  // -> NormalizedSession (source 'rapsodo' or 'skytrak' per detected format).
  parse(text) {
    if (typeof text !== 'string' || !text.trim()) {
      throw new Error('The file is empty or could not be read as text.')
    }
    const rows = parseCsv(stripBom(text))
    const header = findHeader(rows)
    if (!header || header.score < 0.8) {
      throw new Error(
        'This file does not look like a Rapsodo MLM or SkyTrak CSV export. ' +
          'Expected columns like "Club Type"/"Side Carry" (Rapsodo) or "Club"/"Offline"/"Back Spin" (SkyTrak).'
      )
    }

    const { cols, units, format } = header
    const warnings = []
    const shots = []
    let summaryRows = 0
    let noClubRows = 0

    const cellAt = (row, field) => {
      const idx = cols[field]
      return idx == null ? null : row[idx]
    }

    for (let i = header.index + 1; i < rows.length; i++) {
      const row = rows[i]
      if (isEmptyRow(row)) continue
      if (isSummaryRow(row, cols.club)) {
        summaryRows++
        continue
      }
      const clubRaw = cellAt(row, 'club')
      const clubLabel = clubRaw == null ? '' : String(clubRaw).trim()
      if (!clubLabel) {
        noClubRows++
        continue
      }

      const ts = parseTimestamp(cellAt(row, 'date'))
      shots.push({
        clubKey: matchClub(clubLabel),
        clubLabel,
        carryYds: round1(convertDistance(parseNum(cellAt(row, 'carry')), units.carry)),
        totalYds: round1(convertDistance(parseNum(cellAt(row, 'total')), units.total)),
        // negative = LEFT, positive = RIGHT (L/R annotations handled in parseDirectional)
        offlineYds: round1(convertDistance(parseDirectional(cellAt(row, 'offline')), units.offline)),
        ballSpeedMph: round1(convertSpeed(parseNum(cellAt(row, 'ballSpeed')), units.ballSpeed)),
        clubSpeedMph: round1(convertSpeed(parseNum(cellAt(row, 'clubSpeed')), units.clubSpeed)),
        launchDeg: round1(parseNum(cellAt(row, 'launch'))),
        spinRpm: round1(parseNum(cellAt(row, 'spin'))),
        apexFt: round1(convertApex(parseNum(cellAt(row, 'apex')), units.apex)),
        timestamp: ts ? ts.iso : null,
      })
    }

    if (summaryRows > 0) {
      warnings.push(
        `Skipped ${summaryRows} average/summary row${summaryRows === 1 ? '' : 's'} (per-club averages are not individual shots).`
      )
    }
    if (noClubRows > 0) {
      warnings.push(`Skipped ${noClubRows} row${noClubRows === 1 ? '' : 's'} with no club label.`)
    }
    if (shots.length === 0) {
      throw new Error('No shots found')
    }

    // Session date: first shot with a parseable date, else any date found in
    // metadata lines above the header.
    let sessionDate = null
    for (let i = header.index + 1; i < rows.length && !sessionDate; i++) {
      const ts = parseTimestamp(cellAt(rows[i], 'date'))
      if (ts) sessionDate = ts.date
    }
    if (!sessionDate) {
      for (let i = 0; i < header.index && !sessionDate; i++) {
        for (const cell of rows[i]) {
          const d = findDateInText(cell)
          if (d) {
            sessionDate = d
            break
          }
        }
      }
    }

    const distanceUnit = units.carry || units.total || units.offline || null
    const unitsDetected = distanceUnit === 'meters' ? 'meters' : distanceUnit === 'yards' ? 'yards' : 'unknown'

    return { source: format, sessionDate, unitsDetected, shots, warnings }
  },
}
