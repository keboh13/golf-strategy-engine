/**
 * FlightScope Mevo / Mevo+ CSV parser (FS Golf app / myflightscope.com exports).
 *
 * Handles both known export shapes:
 *
 * 1. FS Golf app / myflightscope session export:
 *    club,Shot,Ball (mph),Club (mph),Smash,Carry (yds),Total (yds),Roll (yds),
 *    Spin (rpm),Height (ft),Time (s),...,Spin Axis (°),Lateral (yds),Shot Type,
 *    ...,Launch H (°),Launch V (°),...
 *    - Directional values carry an L/R suffix, e.g. "27.8 L", "3.5 R".
 *    - Missing values are shown as "-" (or empty).
 *
 * 2. Legacy Mevo (myflightscope stats.csv) export:
 *    Ball Speed (mph),Club Speed (mph),Smash,Carry Distance (yds),
 *    Launch Angle V (°),Spin (rpm),Height (ft),Time (s),Club
 *
 * Units are embedded in the header parentheses; metric exports use (m),
 * (km/h) or (m/s) and are converted to yards / mph / feet.
 *
 * This module is intentionally self-contained: no imports from the app.
 */

const M_TO_YDS = 1.09361
const MS_TO_MPH = 2.23694
const KMH_TO_MPH = 0.621371
const M_TO_FT = 3.28084

// ---------------------------------------------------------------------------
// Small CSV splitter (quoted fields, escaped quotes, CR/LF/CRLF line endings)
// ---------------------------------------------------------------------------

function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 1
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
      if (c === '\r' && text[i + 1] === '\n') i += 1
      row.push(field)
      field = ''
      rows.push(row)
      row = []
    } else {
      field += c
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''))
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

// ---------------------------------------------------------------------------
// Club matcher (local copy of the shared spec — keep in sync with siblings)
// ---------------------------------------------------------------------------

function slugify(label) {
  return (
    String(label)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'unknown'
  )
}

function matchClub(rawLabel) {
  const label = String(rawLabel == null ? '' : rawLabel).trim()
  const s = label.toLowerCase().replace(/[\s°º]/g, '')
  if (!s) return ''
  if (/^(driver|dr|d)$/.test(s)) return 'driver'
  let m = s.match(/^(\d)w(ood)?$/)
  if (m) return `${m[1]}w`
  m = s.match(/^(\d)(h|hy|hybrid|rescue)$/)
  if (m) return `${m[1]}h`
  m = s.match(/^(\d)i(ron)?$/)
  if (m) return `${m[1]}i`
  if (s.includes('pitching') || s === 'pw') return 'pw'
  if (s.includes('gap') || s.includes('approach') || s === 'aw' || s === 'gw') return 'gw'
  if (s.includes('sand') || s === 'sw') return 'sw'
  if (s.includes('lob') || s === 'lw') return 'lw'
  if (/^\d{2}$/.test(s)) {
    const loft = Number(s)
    if (loft >= 44 && loft <= 64) return s
  }
  return slugify(label)
}

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------

const MISSING = new Set(['', '-', '--', '–', '—', 'n/a', 'na', 'null'])

function isMissing(cell) {
  return MISSING.has(String(cell == null ? '' : cell).trim().toLowerCase())
}

function round1(value) {
  return Math.round(value * 10) / 10
}

/** Parse a plain numeric cell; returns null for missing / unparseable. */
function num(cell) {
  if (isMissing(cell)) return null
  let s = String(cell).trim().replace(/ /g, ' ')
  // European decimal comma ("12,3") — safe because fields are already split.
  if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.')
  const m = s.match(/^-?\d+(\.\d+)?/)
  if (!m) return null
  const v = Number.parseFloat(m[0])
  return Number.isFinite(v) ? v : null
}

/**
 * Parse a FlightScope directional cell. FS Golf exports use an L/R suffix
 * ("27.8 L", "3.5R"); plain signed numbers pass through unchanged.
 * Our convention: negative = LEFT, positive = RIGHT.
 */
function directionalNum(cell) {
  if (isMissing(cell)) return null
  const s = String(cell).trim().replace(/ /g, ' ')
  const m = s.match(/^(-?\d+(?:[.,]\d+)?)\s*([lr])?\s*$/i)
  if (!m) return null
  const v = Number.parseFloat(m[1].replace(',', '.'))
  if (!Number.isFinite(v)) return null
  if (!m[2]) return v
  return m[2].toLowerCase() === 'l' ? -Math.abs(v) : Math.abs(v)
}

function headerUnit(header) {
  const m = /\(([^)]*)\)/.exec(header || '')
  return m ? m[1].trim().toLowerCase() : null
}

function distanceUnitOf(header) {
  const u = headerUnit(header)
  if (u === 'yds' || u === 'yd' || u === 'yards' || u === 'y') return 'yards'
  if (u === 'm' || u === 'meters' || u === 'metres' || u === 'mtr') return 'meters'
  return null
}

/** meters → yards when the column is metric; yards pass through. */
function toYards(value, unit) {
  if (value == null) return null
  return round1(unit === 'meters' ? value * M_TO_YDS : value)
}

function speedToMph(value, unit) {
  if (value == null) return null
  if (unit === 'km/h' || unit === 'kph' || unit === 'kmh' || unit === 'km/hr') {
    return round1(value * KMH_TO_MPH)
  }
  if (unit === 'm/s' || unit === 'ms' || unit === 'mps') {
    return round1(value * MS_TO_MPH)
  }
  return round1(value)
}

function heightToFeet(value, unit) {
  if (value == null) return null
  return round1(unit === 'meters' ? value * M_TO_FT : value)
}

function pad2(v) {
  return String(v).padStart(2, '0')
}

/** Best-effort timestamp → ISO 8601 string (no timezone math). */
function toIsoTimestamp(cell) {
  if (isMissing(cell)) return null
  const s = String(cell).trim()
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/)
  if (m) {
    const date = `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`
    if (m[4] == null) return date
    return `${date}T${pad2(m[4])}:${m[5]}:${m[6] || '00'}`
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ](\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]m)?)?$/i)
  if (m) {
    const date = `${m[3]}-${pad2(m[1])}-${pad2(m[2])}`
    if (m[4] == null) return date
    let hour = Number.parseInt(m[4], 10)
    const ap = m[7] ? m[7].toLowerCase() : null
    if (ap === 'pm' && hour < 12) hour += 12
    if (ap === 'am' && hour === 12) hour = 0
    return `${date}T${pad2(hour)}:${m[5]}:${m[6] || '00'}`
  }
  return null
}

// ---------------------------------------------------------------------------
// Header detection
// ---------------------------------------------------------------------------

function normalizeHeaderCells(row) {
  return row.map((cell) =>
    String(cell)
      .replace(/ /g, ' ')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' '),
  )
}

function isFsGolfHeader(cells) {
  const joined = `,${cells.join(',')},`
  return (
    cells.includes('club') &&
    /,ball \(/.test(joined) &&
    /,club \(/.test(joined) &&
    cells.includes('smash') &&
    /,carry \(/.test(joined)
  )
}

function isLegacyMevoHeader(cells) {
  const joined = cells.join(',')
  return (
    joined.includes('ball speed (') &&
    joined.includes('carry distance (') &&
    joined.includes('launch angle v')
  )
}

function findHeaderRow(rows) {
  const limit = Math.min(rows.length, 15)
  for (let i = 0; i < limit; i += 1) {
    const cells = normalizeHeaderCells(rows[i])
    if (isFsGolfHeader(cells) || isLegacyMevoHeader(cells)) return i
  }
  // Looser fallback: a club column plus a carry column.
  for (let i = 0; i < limit; i += 1) {
    const cells = normalizeHeaderCells(rows[i])
    const hasClub = cells.some((c) => c === 'club' || c === 'club name')
    const hasCarry = cells.some((c) => c.startsWith('carry'))
    if (hasClub && hasCarry) return i
  }
  return -1
}

function findCol(cells, predicate) {
  for (let i = 0; i < cells.length; i += 1) {
    if (predicate(cells[i])) return i
  }
  return -1
}

// ---------------------------------------------------------------------------
// Parser module
// ---------------------------------------------------------------------------

export default {
  id: 'flightscope',
  label: 'FlightScope Mevo / Mevo+',

  detect(text) {
    if (typeof text !== 'string' || text.trim() === '') return 0
    // Only the head of the file is needed to recognize the header.
    const rows = parseCsv(stripBom(text).slice(0, 8000)).slice(0, 15)
    let best = 0
    for (const row of rows) {
      if (row.length < 3) continue
      const cells = normalizeHeaderCells(row)
      if (isFsGolfHeader(cells) || isLegacyMevoHeader(cells)) return 0.95
      const joined = cells.join(',')
      const tokens = ['smash', 'spin (', 'height (', 'carry', 'lateral (', 'launch v', 'spin axis']
      const hits = tokens.filter((t) => joined.includes(t)).length
      best = Math.max(best, Math.min(0.6, hits * 0.12))
    }
    return best
  },

  parse(text) {
    if (typeof text !== 'string' || text.trim() === '') {
      throw new Error('The file is empty — export a session as CSV from the FS Golf app or myflightscope.com and try again.')
    }
    const rows = parseCsv(stripBom(text))
    const headerIndex = findHeaderRow(rows)
    if (headerIndex === -1) {
      throw new Error('Could not find FlightScope columns in this file — expected a CSV session export from the FS Golf app or myflightscope.com.')
    }

    const header = normalizeHeaderCells(rows[headerIndex])
    const cols = {
      club: findCol(header, (c) => c === 'club' || c === 'club name'),
      carry: findCol(header, (c) => c.startsWith('carry')),
      total: findCol(header, (c) => c.startsWith('total')),
      lateral: findCol(header, (c) => c.startsWith('lateral') && !c.startsWith('lateral impact')),
      ballSpeed: findCol(header, (c) => c.startsWith('ball')),
      clubSpeed: findCol(header, (c) => c.startsWith('club speed') || c.startsWith('club (')),
      launch: findCol(header, (c) => c.startsWith('launch v') || c.startsWith('launch angle v')),
      spin: findCol(header, (c) => c.startsWith('spin (')),
      height: findCol(header, (c) => c.startsWith('height') || c.startsWith('apex')),
      timestamp: findCol(
        header,
        (c) => c === 'date' || c === 'time' || c === 'date/time' || c === 'date & time' || c === 'timestamp' || c === 'created',
      ),
    }

    if (cols.club === -1) {
      throw new Error('Could not find a Club column in this FlightScope export.')
    }

    const warnings = []

    // Units come from the header parentheses, per column.
    const carryUnit = cols.carry !== -1 ? distanceUnitOf(header[cols.carry]) : null
    const totalUnit = cols.total !== -1 ? distanceUnitOf(header[cols.total]) : null
    const lateralUnit = cols.lateral !== -1 ? distanceUnitOf(header[cols.lateral]) : null
    const heightUnitRaw = cols.height !== -1 ? distanceUnitOf(header[cols.height]) : null
    const ballSpeedUnit = cols.ballSpeed !== -1 ? headerUnit(header[cols.ballSpeed]) : null
    const clubSpeedUnit = cols.clubSpeed !== -1 ? headerUnit(header[cols.clubSpeed]) : null

    const unitsDetected = carryUnit || totalUnit || lateralUnit || 'unknown'
    if (unitsDetected === 'unknown') {
      warnings.push('Could not determine distance units from the file header — values were assumed to be yards.')
    }
    // Height column on imperial exports is in feet; "(yards)" never appears there.
    const heightUnit = heightUnitRaw === 'meters' ? 'meters' : 'feet'

    const cell = (row, index) => (index === -1 || index >= row.length ? '' : row[index])

    const shots = []
    let skippedNoClub = 0
    let skippedSummary = 0

    for (let i = headerIndex + 1; i < rows.length; i += 1) {
      const row = rows[i]
      const clubRaw = String(cell(row, cols.club)).trim()
      if (clubRaw === '' || isMissing(clubRaw)) {
        skippedNoClub += 1
        continue
      }
      if (/^(average|avg|std|deviation|consistency|totals?:?)\b/i.test(clubRaw)) {
        skippedSummary += 1
        continue
      }

      const launch = num(cell(row, cols.launch))
      const spin = num(cell(row, cols.spin))
      shots.push({
        clubKey: matchClub(clubRaw),
        clubLabel: clubRaw,
        carryYds: toYards(num(cell(row, cols.carry)), carryUnit || unitsDetected),
        totalYds: toYards(num(cell(row, cols.total)), totalUnit || unitsDetected),
        offlineYds: toYards(directionalNum(cell(row, cols.lateral)), lateralUnit || unitsDetected),
        ballSpeedMph: speedToMph(num(cell(row, cols.ballSpeed)), ballSpeedUnit),
        clubSpeedMph: speedToMph(num(cell(row, cols.clubSpeed)), clubSpeedUnit),
        launchDeg: launch == null ? null : round1(launch),
        spinRpm: spin == null ? null : round1(spin),
        apexFt: heightToFeet(num(cell(row, cols.height)), heightUnit),
        timestamp: toIsoTimestamp(cell(row, cols.timestamp)),
      })
    }

    if (skippedNoClub > 0) {
      warnings.push(`Skipped ${skippedNoClub} row${skippedNoClub === 1 ? '' : 's'} with no club label.`)
    }
    if (skippedSummary > 0) {
      warnings.push(`Skipped ${skippedSummary} summary row${skippedSummary === 1 ? '' : 's'} (averages / deviations).`)
    }

    if (shots.length === 0) {
      throw new Error('No shots found')
    }

    const firstTimestamp = shots.find((s) => s.timestamp != null)
    const sessionDate = firstTimestamp ? firstTimestamp.timestamp.slice(0, 10) : null

    return {
      source: 'flightscope',
      sessionDate,
      unitsDetected,
      shots,
      warnings,
    }
  },
}
