import { describe, it, expect } from 'vitest'
import { summarizeHistory, escCap, renderHistoryBlock } from './history.js'

describe('escCap', () => {
  it('caps blowups at par+3', () => {
    expect(escCap(4, 9)).toBe(7)
    expect(escCap(4, 6)).toBe(6)
  })
  it('returns score unchanged when within cap', () => {
    expect(escCap(3, 5)).toBe(5)
  })
})

const baseRound = {
  course: 'Test', score: 75, toPar: '+3', date: '2099-01-01',
  roundType: 'Casual',
  holes: [
    { par: 4, score: 5 }, { par: 4, score: 4 }, { par: 3, score: 3 }, { par: 5, score: 6 },
    { par: 4, score: 4 }, { par: 3, score: 4 }, { par: 4, score: 5 }, { par: 5, score: 5 },
    { par: 4, score: 5 }, { par: 4, score: 4 }, { par: 3, score: 3 }, { par: 4, score: 4 },
    { par: 5, score: 5 }, { par: 4, score: 4 }, { par: 3, score: 4 }, { par: 4, score: 4 },
    { par: 4, score: 5 }, { par: 5, score: 6 },
  ],
}

describe('summarizeHistory', () => {
  it('returns null on empty', () => {
    expect(summarizeHistory([])).toBeNull()
  })
  it('weights recent rounds heavier than old', () => {
    const rounds = [
      { ...baseRound, date: '2099-01-01', toPar: '+1' },  // recent, low
      { ...baseRound, date: '2098-01-01', toPar: '+10' }, // 1y old, high
    ]
    const s = summarizeHistory(rounds, { nowMs: Date.parse('2099-01-01') })
    // weighted avg should be closer to +1 than +10
    expect(s.overall.avg).toBeLessThan(s.overall.flat)
  })
  it('caps per-hole at par+3', () => {
    const rounds = [{
      ...baseRound,
      holes: [{ par: 4, score: 12 }], // would be +8 uncapped, +3 capped
    }]
    const s = summarizeHistory(rounds, { nowMs: Date.parse('2099-01-01') })
    expect(s.perPar[4].avg).toBe(3)
  })
  it('splits by round type', () => {
    const rounds = [
      { ...baseRound, roundType: 'Tournament', toPar: '+5' },
      { ...baseRound, roundType: 'Casual', toPar: '+1' },
    ]
    const s = summarizeHistory(rounds, { nowMs: Date.parse('2099-01-01') })
    expect(s.tournament.avg).toBe(5)
    expect(s.casual.avg).toBe(1)
  })
  it('only counts complete 9s for front/back', () => {
    const rounds = [{
      ...baseRound,
      holes: baseRound.holes.slice(0, 18),
    }]
    const s = summarizeHistory(rounds, { nowMs: Date.parse('2099-01-01') })
    expect(s.frontBack.front.n).toBe(1)
    expect(s.frontBack.back.n).toBe(1)
  })
})

describe('renderHistoryBlock', () => {
  it('renders nothing on null', () => {
    expect(renderHistoryBlock(null)).toBe('')
  })
  it('renders annotated lines', () => {
    const s = summarizeHistory([baseRound], { nowMs: Date.parse('2099-01-01') })
    const out = renderHistoryBlock(s)
    expect(out).toContain('SCORING HISTORY (recency-weighted')
    expect(out).toContain('n=')
    expect(out).toContain('Par 3 avg')
  })
})
