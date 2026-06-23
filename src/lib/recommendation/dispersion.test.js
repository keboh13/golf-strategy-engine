import { describe, it, expect } from 'vitest'
import { hazardOverlapProb, tee_shot_overlaps, formatOverlapLine } from './dispersion.js'

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
