import { describe, it, expect } from 'vitest'
import { hazardOverlapProb, tee_shot_overlaps, formatOverlapLine, approach_overlaps, pickApproachClubStats, compareLayupApproach, formatApproachOverlapLine } from './dispersion.js'

const driver = { carryYds: 275, offlineBiasYds: 0, lateralSigmaYds: 12 }

describe('hazardOverlapProb', () => {
  it('returns null when no lateral sigma', () => {
    expect(hazardOverlapProb({ type: 'water', side: 'L', carry_yards: 270 }, { carryYds: 275 }))
      .toBeNull()
  })
  it('returns null on non-lateral side', () => {
    expect(hazardOverlapProb({ type: 'water', side: 'front' }, driver)).toBeNull()
  })
  it('returns 0 when hazard past carry', () => {
    expect(hazardOverlapProb({ type: 'water', side: 'L', carry_yards: 320 }, driver)).toBe(0)
  })
  it('returns ~0 with small sigma and no bias for a hazard 22y to the side', () => {
    const p = hazardOverlapProb({ type: 'bunker', side: 'R', carry_yards: 270 }, { carryYds: 275, offlineBiasYds: 0, lateralSigmaYds: 5 })
    // hazard center 22y right, width ±25, sigma 5 → very low miss prob
    expect(p).toBeLessThan(0.05)
  })
  it('returns higher prob when player biases toward the hazard side', () => {
    const pNoBias = hazardOverlapProb({ type: 'bunker', side: 'R', carry_yards: 270 }, driver)
    const pRightBias = hazardOverlapProb(
      { type: 'bunker', side: 'R', carry_yards: 270 },
      { ...driver, offlineBiasYds: 15 },
    )
    expect(pRightBias).toBeGreaterThan(pNoBias)
  })
  it('returns symmetric prob for L/R when bias=0', () => {
    const pL = hazardOverlapProb({ type: 'water', side: 'L', carry_yards: 270 }, driver)
    const pR = hazardOverlapProb({ type: 'water', side: 'R', carry_yards: 270 }, driver)
    expect(Math.abs(pL - pR)).toBeLessThan(0.02)
  })
})

describe('tee_shot_overlaps', () => {
  it('sorts by prob desc and filters by threshold', () => {
    const hazards = [
      { type: 'water', side: 'L', carry_yards: 270 },
      { type: 'bunker', side: 'R', carry_yards: 240 },
      { type: 'native', side: 'front' },          // ignored
      { type: 'OB', side: 'R', carry_yards: 999 }, // past carry
    ]
    const out = tee_shot_overlaps({ hazards, clubStats: { ...driver, offlineBiasYds: 8 }, threshold: 0 })
    expect(out.length).toBe(2)
    expect(out[0].prob).toBeGreaterThanOrEqual(out[1].prob)
  })
  it('returns empty array on no clubStats', () => {
    expect(tee_shot_overlaps({ hazards: [{ side: 'L' }], clubStats: null })).toEqual([])
  })
})

describe('formatOverlapLine', () => {
  it('formats human-readable line', () => {
    const line = formatOverlapLine('Driver', [
      { type: 'water', side: 'L', carry_yards: 270, prob: 0.32 },
      { type: 'bunker', side: 'R', carry_yards: 240, prob: 0.15 },
    ])
    expect(line).toContain('Driver dispersion overlaps')
    expect(line).toContain('water L @270y ~32%')
    expect(line).toContain('bunker R @240y ~15%')
  })
  it('returns null on empty overlap', () => {
    expect(formatOverlapLine('Driver', [])).toBeNull()
  })
})

// ── Issue #193: Approach-shot dispersion tests ──────────────────────────────

const approachClubs = [
  { club: 'Driver', carry: 275 },
  { club: '3-wood', carry: 245 },
  { club: '5-iron', carry: 195, stats: { samples: 30, carryP50: 195, offlineBias: 2, offlineStd: 8 } },
  { club: '6-iron', carry: 180, stats: { samples: 30, carryP50: 180, offlineBias: 1, offlineStd: 7 } },
  { club: '7-iron', carry: 165, stats: { samples: 40, carryP50: 165, offlineBias: 0, offlineStd: 6 } },
  { club: '8-iron', carry: 152, stats: { samples: 35, carryP50: 152, offlineBias: -1, offlineStd: 5 } },
  { club: 'PW', carry: 135, stats: { samples: 50, carryP50: 135, offlineBias: 0, offlineStd: 4 } },
]

describe('pickApproachClubStats', () => {
  it('picks closest iron/wedge for a given distance', () => {
    const stats = pickApproachClubStats(approachClubs, 165)
    expect(stats).not.toBeNull()
    expect(stats.clubLabel).toBe('7-iron')
    expect(stats.carryYds).toBe(165)
  })
  it('does not pick driver or woods', () => {
    const stats = pickApproachClubStats(approachClubs, 250)
    expect(stats).not.toBeNull()
    expect(stats.clubLabel).not.toMatch(/driver|wood/i)
  })
  it('returns null on empty clubs', () => {
    expect(pickApproachClubStats([], 150)).toBeNull()
  })
  it('returns null on invalid distance', () => {
    expect(pickApproachClubStats(approachClubs, -10)).toBeNull()
  })
})

describe('approach_overlaps', () => {
  it('computes approach dispersion for greenside hazards', () => {
    const result = approach_overlaps({
      holeYardage: 440,
      teeCarryYds: 275,
      hazards: [
        { type: 'bunker', side: 'R', carry_yards: 270 },
        { type: 'water', side: 'L' },
      ],
      clubs: approachClubs,
      threshold: 0,
    })
    expect(result).not.toBeNull()
    expect(result.approachYds).toBe(165)
    expect(result.clubStats.clubLabel).toBe('7-iron')
    expect(Array.isArray(result.overlaps)).toBe(true)
  })
  it('returns null when approach distance is <= 0', () => {
    expect(approach_overlaps({
      holeYardage: 250, teeCarryYds: 275,
      hazards: [], clubs: approachClubs,
    })).toBeNull()
  })
  it('returns null on missing inputs', () => {
    expect(approach_overlaps({ holeYardage: null, teeCarryYds: 275, hazards: [], clubs: [] })).toBeNull()
  })
})

describe('compareLayupApproach', () => {
  it('compares go-for-it vs layup approach dispersion', () => {
    const result = compareLayupApproach({
      holeYardage: 520,
      teeCarryYds: 275,
      layupCarryYds: 220,
      hazards: [{ type: 'water', side: 'R' }],
      clubs: approachClubs,
    })
    expect(result).not.toBeNull()
    expect(result.goForIt).not.toBeNull()
    expect(result.layup).not.toBeNull()
    // Layup approach should be longer (300y vs 245y)
    expect(result.layup.approachYds).toBeGreaterThan(result.goForIt.approachYds)
  })
  it('returns null when layupCarryYds is missing', () => {
    expect(compareLayupApproach({
      holeYardage: 520, teeCarryYds: 275,
      hazards: [], clubs: approachClubs,
    })).toBeNull()
  })
})

describe('formatApproachOverlapLine', () => {
  it('formats approach overlap line', () => {
    const line = formatApproachOverlapLine({
      clubStats: { clubLabel: '7-iron' },
      approachYds: 165,
      overlaps: [{ type: 'bunker', side: 'R', carry_yards: null, prob: 0.25 }],
    })
    expect(line).toContain('7-iron approach from 165y')
    expect(line).toContain('bunker R ~25%')
  })
  it('returns null on no overlaps', () => {
    expect(formatApproachOverlapLine({ clubStats: {}, approachYds: 150, overlaps: [] })).toBeNull()
  })
  it('returns null on null input', () => {
    expect(formatApproachOverlapLine(null)).toBeNull()
  })
})
