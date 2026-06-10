import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import garmin, { summarizeByClub } from './garmin.parser.js'

const fixture = fs.readFileSync(new URL('./__fixtures__/garmin.csv', import.meta.url), 'utf8')

const METRIC_CSV = [
  'Date,Player,Club Name,Club Type,Club Speed,Ball Speed,Smash Factor,Launch Angle,Launch Direction,Backspin,Sidespin,Spin Rate,Spin Rate Type,Spin Axis,Apex Height,Carry Distance,Carry Deviation Angle,Carry Deviation Distance,Total Distance,Total Deviation Angle,Total Deviation Distance',
  ',,,,[km/h],[km/h],,[deg],[deg],[rpm],[rpm],[rpm],,[deg],[m],[Meters],[deg],[Meters],[Meters],[deg],[Meters]',
  '5/2/25 14:30:00,Tester,,7 Iron,128.7,160.9,1.25,18.0,1.0,6400,200,6504,Measured,2.0,25.0,140.0,1.5,5.0,148.0,1.6,6.0',
].join('\r\n')

describe('garmin parser metadata', () => {
  it('exposes the registry contract', () => {
    expect(garmin.id).toBe('garmin-r10')
    expect(garmin.label).toBe('Garmin R10 (Garmin Golf CSV)')
    expect(typeof garmin.detect).toBe('function')
    expect(typeof garmin.parse).toBe('function')
  })
})

describe('detect()', () => {
  it('scores a real Garmin Golf export at >= 0.8', () => {
    expect(garmin.detect(fixture)).toBeGreaterThanOrEqual(0.8)
  })

  it('scores a metric export at >= 0.8', () => {
    expect(garmin.detect(METRIC_CSV)).toBeGreaterThanOrEqual(0.8)
  })

  it('rejects non-CSV text', () => {
    expect(garmin.detect('hello world')).toBeLessThan(0.5)
    expect(garmin.detect('')).toBe(0)
    expect(garmin.detect(null)).toBe(0)
  })

  it('scores generic / other-monitor CSVs low', () => {
    expect(garmin.detect('a,b,c\n1,2,3')).toBeLessThan(0.5)
    // Launch-monitor-ish header without the Garmin signature ("Club Type" etc.)
    const other = 'Shot Number,Club,Ball Speed,Launch Angle,Spin Rate,Carry Distance\n1,7i,120,18,6500,160'
    expect(garmin.detect(other)).toBeLessThan(0.8)
  })
})

describe('parse() — imperial fixture', () => {
  const result = garmin.parse(fixture)

  it('returns session metadata', () => {
    expect(result.source).toBe('garmin-r10')
    expect(result.sessionDate).toBe('2025-05-01')
    expect(result.unitsDetected).toBe('yards')
    expect(result.shots).toHaveLength(6)
  })

  it('maps every field of a shot (incl. quoted note containing a comma)', () => {
    expect(result.shots[0]).toEqual({
      clubKey: 'driver',
      clubLabel: 'Driver',
      carryYds: 230.5,
      totalYds: 248.9,
      offlineYds: -15.5,
      ballSpeedMph: 138.9,
      clubSpeedMph: 95.3,
      launchDeg: 13.5,
      spinRpm: 2655.8,
      apexFt: 93.7, // 31.2345 yds -> ft
      timestamp: '2025-05-01T19:14:22',
    })
  })

  it('maps Garmin club names to canonical keys', () => {
    expect(result.shots.map((s) => s.clubKey)).toEqual(['driver', '7i', 'pw', '60', '4h', '3w'])
  })

  it('prefers the custom Club Name for the label but keys off Club Type', () => {
    expect(result.shots[5].clubLabel).toBe('My 3W')
    expect(result.shots[5].clubKey).toBe('3w')
  })

  it('keeps the Garmin sign convention: negative = LEFT, positive = RIGHT', () => {
    expect(result.shots[0].offlineYds).toBe(-15.5) // pulled left
    expect(result.shots[1].offlineYds).toBe(8.3) // pushed right
  })

  it('falls back to carry deviation when total deviation is missing', () => {
    expect(result.shots[2].offlineYds).toBe(-3.2)
  })

  it('uses null (never 0/NaN) for missing values', () => {
    const pw = result.shots[2]
    expect(pw.spinRpm).toBeNull()
    expect(pw.apexFt).toBeNull()
    expect(pw.carryYds).toBe(110.2)
  })

  it('rounds to one decimal and converts apex yards to feet', () => {
    const i7 = result.shots[1]
    expect(i7.carryYds).toBe(152.3)
    expect(i7.totalYds).toBe(160.1)
    expect(i7.ballSpeedMph).toBe(105.7)
    expect(i7.clubSpeedMph).toBe(78.1)
    expect(i7.launchDeg).toBe(18.2)
    expect(i7.spinRpm).toBe(6507.4)
    expect(i7.apexFt).toBe(86.7) // 28.901 yds * 3
  })

  it('parses 12-hour AM/PM dates to ISO 8601 timestamps', () => {
    expect(result.shots.map((s) => s.timestamp)).toEqual([
      '2025-05-01T19:14:22',
      '2025-05-01T19:20:05',
      '2025-05-01T19:25:40',
      '2025-05-01T19:30:12',
      '2025-05-01T19:34:55',
      '2025-05-01T19:40:01',
    ])
  })

  it('warns that the R10 estimated spin for some shots', () => {
    expect(result.warnings.some((w) => /estimated/i.test(w) && /4 of 6/.test(w))).toBe(true)
  })

  it('handles the UTF-8 BOM that real exports start with', () => {
    expect(fixture.charCodeAt(0)).toBe(0xfeff) // fixture really has one
    expect(result.shots[0].clubKey).toBe('driver') // and parsing still worked
  })
})

describe('parse() — metric export (CRLF)', () => {
  const result = garmin.parse(METRIC_CSV)
  const shot = result.shots[0]

  it('detects meters', () => {
    expect(result.unitsDetected).toBe('meters')
    expect(result.shots).toHaveLength(1)
  })

  it('converts km/h to mph', () => {
    expect(shot.clubSpeedMph).toBe(80) // 128.7 km/h * 0.621371
    expect(shot.ballSpeedMph).toBe(100) // 160.9 km/h * 0.621371
  })

  it('converts meters to yards', () => {
    expect(shot.carryYds).toBe(153.1) // 140 m * 1.09361
    expect(shot.totalYds).toBe(161.9) // 148 m * 1.09361
    expect(shot.offlineYds).toBe(6.6) // 6 m * 1.09361
  })

  it('converts apex meters to feet', () => {
    expect(shot.apexFt).toBe(82) // 25 m * 3.28084
  })

  it('leaves degrees and rpm unconverted', () => {
    expect(shot.launchDeg).toBe(18)
    expect(shot.spinRpm).toBe(6504)
  })

  it('parses 24-hour dates', () => {
    expect(shot.timestamp).toBe('2025-05-02T14:30:00')
    expect(result.sessionDate).toBe('2025-05-02')
  })

  it('does not warn about estimated spin when spin was measured', () => {
    expect(result.warnings.some((w) => /estimated/i.test(w))).toBe(false)
  })
})

describe('parse() — m/s speeds', () => {
  it('converts m/s to mph', () => {
    const csv = [
      'Date,Club Type,Club Speed,Ball Speed,Carry Distance',
      ',,[m/s],[m/s],[Meters]',
      '5/3/25 9:00:00 AM,Driver,40.0,58.5,210.0',
    ].join('\n')
    const result = garmin.parse(csv)
    expect(result.shots[0].clubSpeedMph).toBe(89.5) // 40 m/s * 2.23694
    expect(result.shots[0].ballSpeedMph).toBe(130.9) // 58.5 m/s * 2.23694
    expect(result.shots[0].carryYds).toBe(229.7)
    expect(result.shots[0].timestamp).toBe('2025-05-03T09:00:00')
  })
})

describe('parse() — degraded inputs', () => {
  it('handles a missing units row: unknown units, pass-through values, warning', () => {
    const csv = ['Date,Club Type,Carry Distance,Total Distance', '5/1/25 1:05:00 PM,7 Iron,150.04,158.96'].join('\n')
    const result = garmin.parse(csv)
    expect(result.unitsDetected).toBe('unknown')
    expect(result.warnings.some((w) => /units/i.test(w))).toBe(true)
    expect(result.shots[0].carryYds).toBe(150)
    expect(result.shots[0].totalYds).toBe(159)
  })

  it('null timestamp plus a warning for unparseable dates', () => {
    const csv = [
      'Date,Club Type,Carry Distance',
      ',,[Yards]',
      'not a date,7 Iron,150.0',
    ].join('\n')
    const result = garmin.parse(csv)
    expect(result.shots[0].timestamp).toBeNull()
    expect(result.sessionDate).toBeNull()
    expect(result.warnings.some((w) => /date/i.test(w))).toBe(true)
  })

  it('falls back to day-first parsing when month-first is impossible', () => {
    const csv = ['Date,Club Type,Carry Distance', ',,[Yards]', '25/12/24 1:00:00 PM,Driver,250.0'].join('\n')
    const result = garmin.parse(csv)
    expect(result.shots[0].timestamp).toBe('2024-12-25T13:00:00')
  })

  it('slugifies unrecognized club labels', () => {
    const csv = ['Date,Club Name,Club Type,Carry Distance', ',,,[Yards]', '5/1/25 1:00:00 PM,Old Mashie!,,95.0'].join(
      '\n'
    )
    const result = garmin.parse(csv)
    expect(result.shots[0].clubKey).toBe('old-mashie')
    expect(result.shots[0].clubLabel).toBe('Old Mashie!')
  })
})

describe('summarizeByClub()', () => {
  const shot = (overrides) => ({
    clubKey: '7i',
    clubLabel: '7 Iron',
    carryYds: null,
    totalYds: null,
    offlineYds: null,
    ballSpeedMph: null,
    clubSpeedMph: null,
    launchDeg: null,
    spinRpm: null,
    apexFt: null,
    timestamp: null,
    ...overrides,
  })

  it('groups by club and computes avg/min/max/std', () => {
    const rows = summarizeByClub([
      shot({ carryYds: 150, offlineYds: -6, ballSpeedMph: 104 }),
      shot({ carryYds: 155, offlineYds: 2, ballSpeedMph: 106 }),
      shot({ carryYds: 160, offlineYds: 4, ballSpeedMph: 108 }),
      shot({ clubKey: 'driver', clubLabel: 'Driver', carryYds: 240, offlineYds: -12 }),
    ])
    expect(rows).toHaveLength(2)
    // Bag order: driver before 7i
    expect(rows.map((r) => r.clubKey)).toEqual(['driver', '7i'])

    const i7 = rows[1]
    expect(i7.shotCount).toBe(3)
    expect(i7.carryAvgYds).toBe(155)
    expect(i7.carryMinYds).toBe(150)
    expect(i7.carryMaxYds).toBe(160)
    expect(i7.carryStdYds).toBe(5) // sample std of [150,155,160]
    expect(i7.offlineAvgYds).toBe(0) // bias cancels out
    expect(i7.offlineStdYds).toBe(5.3) // sqrt(28) ≈ 5.2915
    expect(i7.ballSpeedAvgMph).toBe(106)
  })

  it('uses null (never 0/NaN) for stats it cannot compute', () => {
    const rows = summarizeByClub([
      shot({ clubKey: 'driver', clubLabel: 'Driver', carryYds: 240, offlineYds: -12 }),
    ])
    const d = rows[0]
    expect(d.shotCount).toBe(1)
    expect(d.carryAvgYds).toBe(240)
    expect(d.carryStdYds).toBeNull() // needs >= 3 samples
    expect(d.offlineStdYds).toBeNull()
    expect(d.totalAvgYds).toBeNull()
    expect(d.spinAvgRpm).toBeNull()
    expect(d.apexAvgFt).toBeNull()
  })

  it('sorts the whole fixture session into standard bag order', () => {
    const rows = summarizeByClub(garmin.parse(fixture).shots)
    expect(rows.map((r) => r.clubKey)).toEqual(['driver', '3w', '4h', '7i', 'pw', '60'])
    expect(rows.every((r) => r.shotCount === 1)).toBe(true)
    expect(rows[0].carryAvgYds).toBe(230.5)
  })

  it('handles empty/missing input', () => {
    expect(summarizeByClub([])).toEqual([])
    expect(summarizeByClub(null)).toEqual([])
  })
})

describe('parse() — errors', () => {
  it('throws "No shots found" for a header-and-units-only file', () => {
    const headerOnly = fixture.split('\n').slice(0, 2).join('\n')
    expect(() => garmin.parse(headerOnly)).toThrow('No shots found')
  })

  it('throws a readable error for files that are not Garmin exports', () => {
    expect(() => garmin.parse('a,b,c\n1,2,3')).toThrow(/Garmin/)
  })

  it('throws on empty input', () => {
    expect(() => garmin.parse('')).toThrow()
  })
})
