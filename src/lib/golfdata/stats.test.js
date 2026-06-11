import { describe, it, expect } from 'vitest'
import { normalizeClubName, percentile, iqrBounds, iqrTrim, round1, computeClubStats } from './stats.js'

describe('normalizeClubName', () => {
  it("handles the app's default bag names", () => {
    expect(normalizeClubName('Driver')).toEqual({ key: 'driver', label: 'Driver' })
    expect(normalizeClubName('3-wood')).toEqual({ key: '3w', label: '3W' })
    expect(normalizeClubName('5-wood')).toEqual({ key: '5w', label: '5W' })
    expect(normalizeClubName('4-iron / hybrid')).toEqual({ key: '4i', label: '4i' })
    expect(normalizeClubName('7-iron')).toEqual({ key: '7i', label: '7i' })
    expect(normalizeClubName('PW')).toEqual({ key: 'pw', label: 'PW' })
    expect(normalizeClubName('GW (50°)')).toEqual({ key: 'gw', label: 'GW' })
    expect(normalizeClubName('SW (56°)')).toEqual({ key: 'sw', label: 'SW' })
    expect(normalizeClubName('LW (60°)')).toEqual({ key: 'lw', label: 'LW' })
  })

  it('handles launch-monitor style names', () => {
    expect(normalizeClubName('7 Iron').key).toBe('7i')
    expect(normalizeClubName('7i').key).toBe('7i')
    expect(normalizeClubName('Dr').key).toBe('driver')
    expect(normalizeClubName('d').key).toBe('driver')
    expect(normalizeClubName('1W').key).toBe('driver')
    expect(normalizeClubName('3W').key).toBe('3w')
    expect(normalizeClubName('5 Wood').key).toBe('5w')
    expect(normalizeClubName('3 Hybrid').key).toBe('3h')
    expect(normalizeClubName('4 Rescue').key).toBe('4h')
    expect(normalizeClubName('2hy').key).toBe('2h')
    expect(normalizeClubName('Pitching Wedge').key).toBe('pw')
    expect(normalizeClubName('Gap Wedge').key).toBe('gw')
    expect(normalizeClubName('Approach Wedge').key).toBe('gw')
    expect(normalizeClubName('AW').key).toBe('gw')
    expect(normalizeClubName('Sand Wedge').key).toBe('sw')
    expect(normalizeClubName('Lob Wedge').key).toBe('lw')
  })

  it('maps bare lofts 44–64 to 2-digit degree keys', () => {
    expect(normalizeClubName('56')).toEqual({ key: '56', label: '56°' })
    expect(normalizeClubName('60°')).toEqual({ key: '60', label: '60°' })
    expect(normalizeClubName('44').key).toBe('44')
    expect(normalizeClubName('64').key).toBe('64')
    // outside the wedge-loft range → slug fallback
    expect(normalizeClubName('43').key).toBe('43')
    expect(normalizeClubName('43').label).toBe('43')
    expect(normalizeClubName('65').key).toBe('65')
  })

  it('slugifies unmatched names and keeps the raw label', () => {
    expect(normalizeClubName('My Chipper!')).toEqual({ key: 'my-chipper', label: 'My Chipper!' })
    expect(normalizeClubName('6 Hybrid').key).toBe('6-hybrid')
    expect(normalizeClubName('')).toEqual({ key: 'unknown', label: 'Unknown' })
    expect(normalizeClubName(null)).toEqual({ key: 'unknown', label: 'Unknown' })
  })
})

describe('percentile', () => {
  it('interpolates linearly between closest ranks', () => {
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3)
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5)
    expect(percentile([100, 110, 120, 130, 140], 80)).toBe(132)
  })

  it('accepts unsorted input and does not mutate it', () => {
    const vals = [5, 1, 3]
    expect(percentile(vals, 0)).toBe(1)
    expect(percentile(vals, 100)).toBe(5)
    expect(vals).toEqual([5, 1, 3])
  })

  it('handles edge cases', () => {
    expect(percentile([], 50)).toBe(null)
    expect(percentile([10], 80)).toBe(10)
    expect(percentile([1, null, 2, NaN, 3], 50)).toBe(2)
  })
})

describe('iqrBounds / iqrTrim', () => {
  it('computes the 1.5×IQR fence', () => {
    expect(iqrBounds([100, 101, 102, 103, 104, 200])).toEqual({ lo: 97.5, hi: 107.5 })
    expect(iqrBounds([])).toBe(null)
  })

  it('trims outliers outside the fence', () => {
    expect(iqrTrim([100, 101, 102, 103, 104, 200])).toEqual([100, 101, 102, 103, 104])
    expect(iqrTrim([150])).toEqual([150])
    expect(iqrTrim([])).toEqual([])
  })
})

describe('round1', () => {
  it('rounds to 1 decimal, passing null through', () => {
    expect(round1(163.75)).toBe(163.8)
    expect(round1(-2.04)).toBe(-2)
    expect(round1(null)).toBe(null)
    expect(round1(NaN)).toBe(null)
  })
})

describe('computeClubStats', () => {
  const shot = (over) => ({
    clubKey: '7i', clubLabel: '7i', carryYds: null, totalYds: null, offlineYds: null,
    ballSpeedMph: null, clubSpeedMph: null, launchDeg: null, spinRpm: null,
    apexFt: null, timestamp: null, ...over,
  })

  it('drops null carries, IQR-trims, and aggregates per club', () => {
    const shots = [
      shot({ carryYds: 160, offlineYds: -10 }),
      shot({ carryYds: 162, offlineYds: 5 }),
      shot({ carryYds: 165, offlineYds: -6 }),
      shot({ carryYds: 168, offlineYds: 3 }),
      shot({ carryYds: 250, offlineYds: 0 }),   // IQR outlier — dropped
      shot({ carryYds: null, offlineYds: 99 }), // null carry — dropped
    ]
    const [stats] = computeClubStats(shots)
    expect(stats.clubKey).toBe('7i')
    expect(stats.samples).toBe(4)
    expect(stats.carryAvg).toBe(163.8)
    expect(stats.carryP50).toBe(163.5)
    expect(stats.carryP80).toBe(166.2)
    expect(stats.carryStd).toBe(3.5)
    expect(stats.totalAvg).toBe(null)
    expect(stats.offlineBias).toBe(-2)
    expect(stats.offlineStd).toBe(7.2)
    expect(stats.dispLeftP80).toBe(9.2)   // P80 of |{-10, -6}|
    expect(stats.dispRightP80).toBe(4.6)  // P80 of {5, 3}
    expect(stats.ballSpeedAvg).toBe(null)
    expect(stats.lastSessionDate).toBe(null)
    expect(stats.sources).toEqual([])
  })

  it('returns null std below 3 samples and null for missing metrics', () => {
    const [stats] = computeClubStats([
      shot({ carryYds: 160 }),
      shot({ carryYds: 164 }),
    ])
    expect(stats.samples).toBe(2)
    expect(stats.carryStd).toBe(null)
    expect(stats.offlineBias).toBe(null)
    expect(stats.offlineStd).toBe(null)
    expect(stats.dispLeftP80).toBe(null)
    expect(stats.dispRightP80).toBe(null)
  })

  it('averages ball speed, launch, and spin to 1 decimal', () => {
    const [stats] = computeClubStats([
      shot({ carryYds: 160, ballSpeedMph: 120.1, launchDeg: 18.2, spinRpm: 6500 }),
      shot({ carryYds: 162, ballSpeedMph: 121.4, launchDeg: 17.1, spinRpm: 6800 }),
    ])
    expect(stats.ballSpeedAvg).toBe(120.8)
    expect(stats.launchAvg).toBe(17.7)
    expect(stats.spinAvg).toBe(6650)
  })

  it('tracks sources and lastSessionDate (sessionDate first, timestamp fallback)', () => {
    const [stats] = computeClubStats([
      shot({ carryYds: 160, source: 'trackman', sessionDate: '2026-05-01' }),
      shot({ carryYds: 162, source: 'manual', timestamp: '2026-06-01T10:00:00Z' }),
      shot({ carryYds: 164, source: 'trackman', sessionDate: '2026-04-01' }),
    ])
    expect(stats.sources.sort()).toEqual(['manual', 'trackman'])
    expect(stats.lastSessionDate).toBe('2026-06-01')
  })

  it('groups by clubKey and sorts in bag order', () => {
    const stats = computeClubStats([
      shot({ clubKey: 'pw', clubLabel: 'PW', carryYds: 120 }),
      shot({ clubKey: 'driver', clubLabel: 'Driver', carryYds: 270 }),
      shot({ clubKey: '7i', carryYds: 165 }),
      shot({ clubKey: '3w', clubLabel: '3W', carryYds: 240 }),
      shot({ clubKey: '56', clubLabel: '56°', carryYds: 85 }),
    ])
    expect(stats.map(s => s.clubKey)).toEqual(['driver', '3w', '7i', 'pw', '56'])
  })

  it('returns an empty array for empty or all-null input', () => {
    expect(computeClubStats([])).toEqual([])
    expect(computeClubStats(null)).toEqual([])
    expect(computeClubStats([shot({ carryYds: null })])).toEqual([])
  })
})
