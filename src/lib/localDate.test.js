import { describe, it, expect } from 'vitest'
import { todayLocalIso } from './localDate.js'

describe('todayLocalIso', () => {
  it('returns the local calendar day, not the UTC one, for a late-evening timestamp', () => {
    // 2026-07-17 21:00 in whatever local zone this runs in. UTC-based slicing
    // could jump forward a day; local formatting must not.
    const localEvening = new Date(2026, 6, 17, 21, 0, 0)
    expect(todayLocalIso(localEvening)).toBe('2026-07-17')
  })

  it('pads month and day with a leading zero', () => {
    expect(todayLocalIso(new Date(2026, 0, 5, 10, 0))).toBe('2026-01-05')
  })

  it('handles a mid-year date', () => {
    expect(todayLocalIso(new Date(2026, 5, 30, 12, 0))).toBe('2026-06-30')
  })
})
