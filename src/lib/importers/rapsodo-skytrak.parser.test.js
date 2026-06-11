import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import parser, { aggregateByClub } from './rapsodo-skytrak.parser.js'

const rapsodoFixture = fs.readFileSync(new URL('./__fixtures__/rapsodo.csv', import.meta.url), 'utf8')
const skytrakFixture = fs.readFileSync(new URL('./__fixtures__/skytrak.csv', import.meta.url), 'utf8')

// Metric SkyTrak export (meters / km/h), with L/R annotated offline.
const SKYTRAK_METRIC_CSV = [
  'Shot,Date,Club,Ball Speed (km/h),Club Speed (km/h),Launch Angle (deg),Back Spin (rpm),Side Spin (rpm),Carry (m),Roll (m),Total (m),Offline (m),Max Height (m),Flight Time (sec)',
  '1,2025-06-01 18:05:12,Driver,229.0,158.7,13.1,2710,310,200.0,18.0,218.0,5.0 L,27.0,5.9',
].join('\r\n')

// Metric Rapsodo export (meters / km/h).
const RAPSODO_METRIC_CSV = [
  'Shot Number,Date,Club Type,Ball Speed (km/h),Club Speed (km/h),Smash Factor,Launch Angle,Launch Direction,Spin Rate,Spin Axis,Apex (m),Carry Distance (m),Total Distance (m),Side Carry (m),Descent Angle',
  '1,2025-05-12 10:02:13,Driver,238.5,165.0,1.45,12.8,2.1,2450,3.2,27.0,212.5,229.5,7.7 R,38.2',
].join('\n')

describe('module metadata', () => {
  it('exposes the registry contract', () => {
    expect(parser.id).toBe('rapsodo-skytrak')
    expect(parser.label).toBe('Rapsodo MLM / SkyTrak')
    expect(typeof parser.detect).toBe('function')
    expect(typeof parser.parse).toBe('function')
  })
})

describe('detect()', () => {
  it('scores a Rapsodo MLM export at >= 0.9', () => {
    expect(parser.detect(rapsodoFixture)).toBeGreaterThanOrEqual(0.9)
  })

  it('scores a SkyTrak export at >= 0.85', () => {
    expect(parser.detect(skytrakFixture)).toBeGreaterThanOrEqual(0.85)
  })

  it('scores metric variants at >= 0.85', () => {
    expect(parser.detect(SKYTRAK_METRIC_CSV)).toBeGreaterThanOrEqual(0.85)
    expect(parser.detect(RAPSODO_METRIC_CSV)).toBeGreaterThanOrEqual(0.9)
  })

  it('rejects non-CSV text and empty input', () => {
    expect(parser.detect('hello world')).toBeLessThan(0.5)
    expect(parser.detect('')).toBe(0)
    expect(parser.detect(null)).toBe(0)
  })

  it('scores a Garmin-style export below the parse threshold', () => {
    const garminish =
      'Date,Player,Club Name,Club Type,Club Speed,Ball Speed,Smash Factor,Launch Angle,Launch Direction,Spin Rate,Spin Axis,Apex Height,Carry Distance,Total Distance\n' +
      '5/1/25 7:14:22 PM,Alex,,Driver,95.3,138.9,1.46,13.5,-4.2,2655,-7.6,31.2,230.5,248.9'
    expect(parser.detect(garminish)).toBeLessThan(0.8)
  })

  it('scores generic CSVs low', () => {
    expect(parser.detect('a,b,c,d\n1,2,3,4')).toBeLessThan(0.5)
  })
})

describe('parse() — Rapsodo fixture', () => {
  const result = parser.parse(rapsodoFixture)

  it('returns session metadata', () => {
    expect(result.source).toBe('rapsodo')
    expect(result.sessionDate).toBe('2025-05-12')
    expect(result.unitsDetected).toBe('yards')
    expect(result.shots).toHaveLength(7)
  })

  it('maps every field of a shot', () => {
    expect(result.shots[0]).toEqual({
      clubKey: 'driver',
      clubLabel: 'Driver',
      carryYds: 232.4,
      totalYds: 251,
      offlineYds: 8.4,
      ballSpeedMph: 148.2,
      clubSpeedMph: 102.5,
      launchDeg: 12.8,
      spinRpm: 2450,
      apexFt: 88,
      timestamp: '2025-05-12T10:02:13',
    })
  })

  it('maps club labels to canonical keys', () => {
    expect(result.shots.map((s) => s.clubKey)).toEqual([
      'driver', 'driver', 'driver', '7i', '7i', 'pw', 'pw',
    ])
  })

  it('handles "L"/"R" annotated Side Carry: negative = LEFT, positive = RIGHT', () => {
    expect(result.shots[0].offlineYds).toBe(8.4) // 8.4 R
    expect(result.shots[1].offlineYds).toBe(-12.1) // 12.1 L
    expect(result.shots[6].offlineYds).toBe(-0.5) // 0.5 L
  })

  it('uses null (never 0/NaN) for missing values', () => {
    const pw2 = result.shots[6]
    expect(pw2.ballSpeedMph).toBeNull()
    expect(pw2.spinRpm).toBeNull()
    expect(pw2.apexFt).toBeNull()
    expect(pw2.carryYds).toBe(125)
  })

  it('skips per-club "Average" summary rows with a warning', () => {
    expect(result.warnings.some((w) => /Skipped 2 average\/summary rows/.test(w))).toBe(true)
  })

  it('skips rows with no club label with a warning', () => {
    expect(result.warnings.some((w) => /Skipped 1 row with no club label/.test(w))).toBe(true)
  })

  it('parses 12-hour AM/PM US dates to ISO timestamps', () => {
    expect(result.shots[1].timestamp).toBe('2025-05-12T10:03:40')
  })
})

describe('parse() — SkyTrak fixture', () => {
  const result = parser.parse(skytrakFixture)

  it('returns session metadata', () => {
    expect(result.source).toBe('skytrak')
    expect(result.sessionDate).toBe('2025-06-01')
    expect(result.unitsDetected).toBe('yards')
    expect(result.shots).toHaveLength(5)
    expect(result.warnings).toEqual([])
  })

  it('maps every field of a shot, using Back Spin as spinRpm', () => {
    expect(result.shots[0]).toEqual({
      clubKey: 'driver',
      clubLabel: 'Driver',
      carryYds: 221.5,
      totalYds: 241.3,
      offlineYds: 9.6,
      ballSpeedMph: 142.3,
      clubSpeedMph: 98.6,
      launchDeg: 13.1,
      spinRpm: 2710,
      apexFt: 79.4,
      timestamp: '2025-06-01T18:05:12',
    })
  })

  it('handles "L"/"R" annotated Offline values', () => {
    expect(result.shots[1].offlineYds).toBe(-4.1) // 4.1 L
    expect(result.shots[3].offlineYds).toBe(5.3) // 5.3 R
  })

  it('maps club labels including abbreviations to canonical keys', () => {
    expect(result.shots.map((s) => s.clubKey)).toEqual(['driver', 'driver', '6i', '6i', 'sw'])
  })
})

describe('parse() — metric unit conversion', () => {
  it('converts a metric SkyTrak export to yards/mph/feet', () => {
    const result = parser.parse(SKYTRAK_METRIC_CSV)
    expect(result.source).toBe('skytrak')
    expect(result.unitsDetected).toBe('meters')
    const shot = result.shots[0]
    expect(shot.carryYds).toBe(218.7) // 200 m
    expect(shot.totalYds).toBe(238.4) // 218 m
    expect(shot.offlineYds).toBe(-5.5) // 5.0 L (m)
    expect(shot.ballSpeedMph).toBe(142.3) // 229 km/h
    expect(shot.clubSpeedMph).toBe(98.6) // 158.7 km/h
    expect(shot.apexFt).toBe(88.6) // 27 m
  })

  it('converts a metric Rapsodo export to yards/mph/feet', () => {
    const result = parser.parse(RAPSODO_METRIC_CSV)
    expect(result.source).toBe('rapsodo')
    expect(result.unitsDetected).toBe('meters')
    const shot = result.shots[0]
    expect(shot.carryYds).toBe(232.4) // 212.5 m
    expect(shot.offlineYds).toBe(8.4) // 7.7 R (m)
    expect(shot.apexFt).toBe(88.6) // 27 m
    expect(shot.ballSpeedMph).toBe(148.2) // 238.5 km/h
    expect(shot.clubSpeedMph).toBe(102.5) // 165 km/h
  })
})

describe('parse() — errors', () => {
  it('throws on empty input', () => {
    expect(() => parser.parse('')).toThrow(/empty/i)
  })

  it('throws a helpful error on non-launch-monitor CSVs', () => {
    expect(() => parser.parse('a,b,c,d\n1,2,3,4')).toThrow(/does not look like/i)
  })
})

describe('aggregateByClub()', () => {
  const { shots } = parser.parse(rapsodoFixture)
  const aggregates = aggregateByClub(shots)

  it('returns one entry per club, sorted longest carry first', () => {
    expect(aggregates.map((a) => a.clubKey)).toEqual(['driver', '7i', 'pw'])
  })

  it('computes carry stats for the driver', () => {
    const driver = aggregates[0]
    expect(driver.clubLabel).toBe('Driver')
    expect(driver.shotCount).toBe(3)
    expect(driver.avgCarryYds).toBe(232.1)
    expect(driver.medianCarryYds).toBe(232.4)
    expect(driver.minCarryYds).toBe(228)
    expect(driver.maxCarryYds).toBe(236)
    expect(driver.carryStdDevYds).toBe(4)
    expect(driver.avgTotalYds).toBe(251.7)
  })

  it('computes dispersion (offline mean + stddev) for the driver', () => {
    const driver = aggregates[0]
    expect(driver.avgOfflineYds).toBeCloseTo(-0.1, 1)
    expect(driver.offlineStdDevYds).toBe(10.7)
  })

  it('computes speed/launch/spin/apex averages', () => {
    const driver = aggregates[0]
    expect(driver.avgBallSpeedMph).toBe(148)
    expect(driver.avgClubSpeedMph).toBe(102.4)
    expect(driver.avgLaunchDeg).toBe(12.8)
    expect(driver.avgSpinRpm).toBe(2483.3)
    expect(driver.avgApexFt).toBe(88.3)
  })

  it('ignores nulls when averaging (PW has one shot missing ball speed/spin)', () => {
    const pw = aggregates[2]
    expect(pw.shotCount).toBe(2)
    expect(pw.avgCarryYds).toBeCloseTo(126.65, 1)
    expect(pw.avgBallSpeedMph).toBe(98.5) // only one non-null value
    expect(pw.avgSpinRpm).toBe(8900)
    expect(pw.avgApexFt).toBe(90)
  })

  it('returns null stddev for single-value groups, never NaN', () => {
    const single = aggregateByClub([
      { clubKey: 'lw', clubLabel: 'LW', carryYds: 75, offlineYds: 1.5 },
    ])
    expect(single[0].carryStdDevYds).toBeNull()
    expect(single[0].offlineStdDevYds).toBeNull()
    expect(single[0].avgBallSpeedMph).toBeNull()
  })

  it('handles empty/invalid input', () => {
    expect(aggregateByClub([])).toEqual([])
    expect(aggregateByClub(null)).toEqual([])
    expect(aggregateByClub([{ carryYds: 100 }])).toEqual([]) // no clubKey
  })

  it('works on SkyTrak shots too', () => {
    const st = aggregateByClub(parser.parse(skytrakFixture).shots)
    expect(st.map((a) => a.clubKey)).toEqual(['driver', '6i', 'sw'])
    expect(st[0].avgCarryYds).toBeCloseTo(218.9, 1)
    expect(st[2].shotCount).toBe(1)
  })
})
