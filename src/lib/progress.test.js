import { describe, it, expect } from 'vitest'
import {
  STEP_STATES,
  formatElapsed,
  formatExpected,
  isOverdue,
  summarizeDurations,
} from './progress.js'

describe('formatElapsed', () => {
  it('hides under 1s so the UI does not jitter on fast steps', () => {
    expect(formatElapsed(0)).toBe('')
    expect(formatElapsed(500)).toBe('')
    expect(formatElapsed(999)).toBe('')
  })
  it('formats sub-10s with one decimal', () => {
    expect(formatElapsed(1000)).toBe('1.0s')
    expect(formatElapsed(3450)).toBe('3.5s')
    expect(formatElapsed(9999)).toBe('10.0s')
  })
  it('drops the decimal at or above 10s', () => {
    expect(formatElapsed(10_000)).toBe('10s')
    expect(formatElapsed(45_400)).toBe('45s')
  })
  it('switches to minute form at and above 1 minute', () => {
    expect(formatElapsed(60_000)).toBe('1m')
    expect(formatElapsed(72_000)).toBe('1m 12s')
    expect(formatElapsed(125_000)).toBe('2m 5s')
  })
  it('returns empty on null / undefined / negative', () => {
    expect(formatElapsed(null)).toBe('')
    expect(formatElapsed(undefined)).toBe('')
    expect(formatElapsed(-1)).toBe('')
  })
})

describe('formatExpected', () => {
  it('stays quiet when no expectation is given', () => {
    expect(formatExpected(null)).toBe('')
    expect(formatExpected(0)).toBe('')
    expect(formatExpected(undefined)).toBe('')
  })
  it('renders sub-1s as ~ <1s rather than rounding to 0', () => {
    expect(formatExpected(400)).toBe('~ <1s')
  })
  it('renders seconds for under-a-minute expectations', () => {
    expect(formatExpected(8000)).toBe('~ 8s typically')
  })
  it('renders minutes once the expectation crosses 60s', () => {
    expect(formatExpected(120_000)).toBe('~ 2m typically')
  })
})

describe('isOverdue', () => {
  it('returns false when elapsed is unknown', () => {
    expect(isOverdue({ elapsedMs: null, expectedMs: 1000 })).toBe(false)
  })
  it('prefers p90 over expected when both are present', () => {
    expect(isOverdue({ elapsedMs: 5000, expectedMs: 1000, p90Ms: 8000 })).toBe(false)
    expect(isOverdue({ elapsedMs: 9000, expectedMs: 1000, p90Ms: 8000 })).toBe(true)
  })
  it('uses 2× expected as the cutoff when no p90 is known', () => {
    expect(isOverdue({ elapsedMs: 1500, expectedMs: 1000 })).toBe(false)
    expect(isOverdue({ elapsedMs: 2500, expectedMs: 1000 })).toBe(true)
  })
  it('is never overdue without any expectation signal', () => {
    expect(isOverdue({ elapsedMs: 999_999 })).toBe(false)
  })
})

describe('summarizeDurations', () => {
  it('captures only steps that have both start and end timestamps', () => {
    const steps = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const startsAt = { a: 1000, b: 2000, c: 3000 }
    const endsAt = { a: 1500, c: 3300 }
    expect(summarizeDurations(steps, startsAt, endsAt)).toEqual({ a: 500, c: 300 })
  })
  it('returns an empty object when nothing has finished', () => {
    expect(summarizeDurations([{ id: 'a' }], {}, {})).toEqual({})
  })
  it('ignores out-of-order timestamps that would yield negative durations', () => {
    const out = summarizeDurations([{ id: 'a' }], { a: 5000 }, { a: 1000 })
    expect(out).toEqual({})
  })
  it('handles missing inputs without throwing', () => {
    expect(summarizeDurations(undefined, undefined, undefined)).toEqual({})
    expect(summarizeDurations(null, null, null)).toEqual({})
  })
})

describe('STEP_STATES', () => {
  it('exposes the five canonical states for the component to gate on', () => {
    expect(Object.values(STEP_STATES).sort()).toEqual(
      ['done', 'error', 'pending', 'running', 'skipped'].sort()
    )
  })
})
