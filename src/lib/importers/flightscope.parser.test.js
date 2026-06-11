import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import flightscope from './flightscope.parser.js'

const fixture = fs.readFileSync(
  new URL('./__fixtures__/flightscope.csv', import.meta.url),
  'utf8',
)

// Metric FS Golf export with European decimal commas.
const METRIC_CSV = [
  'club,Shot,Ball (km/h),Club (km/h),Smash,Carry (m),Total (m),Roll (m),Spin (rpm),Height (m),Time (s),Spin Axis (°),Lateral (m),Shot Type,Launch H (°),Launch V (°)',
  'Driver,1,230,155,"1,48",240,250,10,2253,35,7,"16,7 L","25,4 L",Hook,"1,5 R","15,8"',
  '7 Iron,2,"180,9","135,3","1,34",145,150,5,6420,27,"5,6","4,2 L","5,7 L",Draw,"1,1 L","19,2"',
].join('\r\n')

// Legacy Mevo (myflightscope stats.csv) export.
const LEGACY_CSV = [
  'Ball Speed (mph),Club Speed (mph),Smash,Carry Distance (yds),Launch Angle V (°),Spin (rpm),Height (ft),Time (s),Club',
  '143.2,96.4,1.49,261.5,14.8,2300,110.0,6.9,Driver',
  '112.1,84.0,1.33,157.2,19.0,6500,87.5,5.5,7 Iron',
].join('\n')

describe('flightscope parser metadata', () => {
  it('exposes the registry contract', () => {
    expect(flightscope.id).toBe('flightscope')
    expect(flightscope.label).toBe('FlightScope Mevo / Mevo+')
    expect(typeof flightscope.detect).toBe('function')
    expect(typeof flightscope.parse).toBe('function')
  })
})

describe('detect()', () => {
  it('scores a real FS Golf export at >= 0.9', () => {
    expect(flightscope.detect(fixture)).toBeGreaterThanOrEqual(0.9)
  })

  it('scores a metric FS Golf export at >= 0.9', () => {
    expect(flightscope.detect(METRIC_CSV)).toBeGreaterThanOrEqual(0.9)
  })

  it('scores a legacy Mevo stats export at >= 0.9', () => {
    expect(flightscope.detect(LEGACY_CSV)).toBeGreaterThanOrEqual(0.9)
  })

  it('handles a UTF-8 BOM', () => {
    expect(flightscope.detect('﻿' + fixture)).toBeGreaterThanOrEqual(0.9)
  })

  it('rejects non-CSV and empty input', () => {
    expect(flightscope.detect('hello world')).toBeLessThan(0.5)
    expect(flightscope.detect('')).toBe(0)
    expect(flightscope.detect(null)).toBe(0)
    expect(flightscope.detect(undefined)).toBe(0)
  })

  it('scores generic CSVs low', () => {
    expect(flightscope.detect('a,b,c\n1,2,3')).toBeLessThan(0.5)
  })

  it('scores a Garmin-style export below the FS Golf threshold', () => {
    const garmin =
      'Date,Player,Club Name,Club Type,Club Speed,Ball Speed,Smash Factor,Launch Angle,Spin Rate,Spin Axis,Apex Height,Carry Distance,Total Distance\n' +
      '5/2/25,Tester,,7 Iron,80,112,1.4,18,6500,2,90,150,158'
    expect(flightscope.detect(garmin)).toBeLessThan(0.9)
  })
})

describe('parse() — FS Golf export (fixture)', () => {
  const result = flightscope.parse(fixture)

  it('returns the normalized session shape', () => {
    expect(result.source).toBe('flightscope')
    expect(result.unitsDetected).toBe('yards')
    expect(Array.isArray(result.shots)).toBe(true)
    expect(Array.isArray(result.warnings)).toBe(true)
  })

  it('parses all club-labelled shots and skips the unlabelled row', () => {
    expect(result.shots).toHaveLength(6)
    expect(result.warnings.some((w) => /skipped 1 row.*no club/i.test(w))).toBe(true)
  })

  it('normalizes club labels to canonical keys', () => {
    const keys = result.shots.map((s) => s.clubKey)
    expect(keys).toEqual(['driver', 'driver', '7i', '7i', 'pw', '3h'])
    expect(result.shots[0].clubLabel).toBe('Driver')
    expect(result.shots[2].clubLabel).toBe('7 Iron')
  })

  it('extracts distances, speeds, launch, spin and apex for a full row', () => {
    const drive = result.shots[0]
    expect(drive.carryYds).toBe(263.5)
    expect(drive.totalYds).toBe(273.3)
    expect(drive.ballSpeedMph).toBe(143)
    expect(drive.clubSpeedMph).toBe(96.4)
    expect(drive.launchDeg).toBe(15.8)
    expect(drive.spinRpm).toBe(2253)
    expect(drive.apexFt).toBe(114.2)
  })

  it('converts L/R lateral suffixes to signed offline yards (negative = left)', () => {
    expect(result.shots[0].offlineYds).toBe(-27.8) // "27.8 L"
    expect(result.shots[1].offlineYds).toBe(13.4) // "13.4 R"
    expect(result.shots[2].offlineYds).toBe(-6.3) // "6.3 L"
  })

  it('maps "-" placeholders to null instead of 0', () => {
    const sevenIron2 = result.shots[3]
    expect(sevenIron2.spinRpm).toBeNull()
    expect(sevenIron2.offlineYds).toBeNull()
    expect(sevenIron2.carryYds).toBe(152.1)
  })

  it('has no timestamp column, so sessionDate is null', () => {
    expect(result.sessionDate).toBeNull()
    expect(result.shots.every((s) => s.timestamp === null)).toBe(true)
  })
})

describe('parse() — metric export with decimal commas', () => {
  const result = flightscope.parse(METRIC_CSV)

  it('detects meters and converts distances to yards', () => {
    expect(result.unitsDetected).toBe('meters')
    expect(result.shots[0].carryYds).toBe(262.5) // 240 m
    expect(result.shots[0].totalYds).toBe(273.4) // 250 m
  })

  it('converts km/h speeds to mph', () => {
    expect(result.shots[0].ballSpeedMph).toBe(142.9) // 230 km/h
    expect(result.shots[0].clubSpeedMph).toBe(96.3) // 155 km/h
  })

  it('converts metric apex height to feet', () => {
    expect(result.shots[0].apexFt).toBe(114.8) // 35 m
  })

  it('parses decimal-comma values and signed lateral in meters', () => {
    expect(result.shots[1].ballSpeedMph).toBe(112.4) // 180,9 km/h
    expect(result.shots[1].launchDeg).toBe(19.2) // "19,2"
    expect(result.shots[0].offlineYds).toBe(-27.8) // "25,4 L" m → yds
  })
})

describe('parse() — legacy Mevo stats export', () => {
  const result = flightscope.parse(LEGACY_CSV)

  it('parses shots with the club column last', () => {
    expect(result.shots).toHaveLength(2)
    expect(result.shots.map((s) => s.clubKey)).toEqual(['driver', '7i'])
  })

  it('maps legacy column names', () => {
    const drive = result.shots[0]
    expect(drive.carryYds).toBe(261.5)
    expect(drive.ballSpeedMph).toBe(143.2)
    expect(drive.clubSpeedMph).toBe(96.4)
    expect(drive.launchDeg).toBe(14.8)
    expect(drive.spinRpm).toBe(2300)
    expect(drive.apexFt).toBe(110)
  })

  it('leaves absent columns null', () => {
    expect(result.shots[0].totalYds).toBeNull()
    expect(result.shots[0].offlineYds).toBeNull()
  })
})

describe('parse() — edge cases', () => {
  it('skips summary rows (averages / deviations) with a warning', () => {
    const csv =
      fixture.trimEnd() +
      '\nAverage,,120,85,1.35,170,176,6,5000,90,5.8,1,20,2 L,3 L,,1 L,19,Outdoor,View,206.7 ft'
    const result = flightscope.parse(csv)
    expect(result.shots).toHaveLength(6)
    expect(result.warnings.some((w) => /summary row/i.test(w))).toBe(true)
  })

  it('tolerates a UTF-8 BOM and CRLF line endings', () => {
    const result = flightscope.parse('﻿' + fixture.replace(/\n/g, '\r\n'))
    expect(result.shots).toHaveLength(6)
  })

  it('parses a date column into sessionDate when present', () => {
    const csv = [
      'Date,club,Shot,Ball (mph),Club (mph),Smash,Carry (yds),Total (yds)',
      '2026-05-14 18:02:11,Driver,1,143,96.4,1.48,263.5,273.3',
    ].join('\n')
    const result = flightscope.parse(csv)
    expect(result.sessionDate).toBe('2026-05-14')
    expect(result.shots[0].timestamp).toBe('2026-05-14T18:02:11')
  })

  it('throws a friendly error on empty input', () => {
    expect(() => flightscope.parse('')).toThrow(/empty/i)
  })

  it('throws when the header cannot be found', () => {
    expect(() => flightscope.parse('a,b,c\n1,2,3')).toThrow(/FlightScope/i)
  })

  it('throws when no shot rows survive filtering', () => {
    const headerOnly = fixture.split('\n')[0]
    expect(() => flightscope.parse(headerOnly + '\n,,,,,,,,,,,,,,,,,,,,')).toThrow(/no shots/i)
  })
})
