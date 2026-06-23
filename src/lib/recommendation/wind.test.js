import { describe, it, expect } from 'vitest'
import { decomposeWind, windDistanceAdjustmentYds } from './wind.js'

describe('decomposeWind', () => {
  it('returns null when inputs missing', () => {
    expect(decomposeWind({ windDir: null, windSpeed: 10, bearingDeg: 0 })).toBeNull()
    expect(decomposeWind({ windDir: 0, windSpeed: null, bearingDeg: 0 })).toBeNull()
    expect(decomposeWind({ windDir: 0, windSpeed: 10, bearingDeg: null })).toBeNull()
  })

  it('treats zero wind speed as calm', () => {
    expect(decomposeWind({ windDir: 90, windSpeed: 0, bearingDeg: 0 })).toEqual({
      headMph: 0, crossMph: 0, label: 'calm',
    })
  })

  it('pure headwind: hole plays N, wind from N', () => {
    // bearing 0 (playing north), windDir 0 (wind from north) → pure headwind
    const r = decomposeWind({ windDir: 0, windSpeed: 10, bearingDeg: 0 })
    expect(r.headMph).toBe(10)
    expect(r.crossMph).toBe(0)
    expect(r.label).toBe('10mph headwind')
  })

  it('pure tailwind: hole plays N, wind from S', () => {
    const r = decomposeWind({ windDir: 180, windSpeed: 10, bearingDeg: 0 })
    expect(r.headMph).toBe(-10)
    expect(r.crossMph).toBe(0)
    expect(r.label).toBe('10mph tailwind')
  })

  it('pure left-to-right cross: hole plays N, wind from W', () => {
    // wind from west (270°) blows toward east (right of someone facing N)
    const r = decomposeWind({ windDir: 270, windSpeed: 10, bearingDeg: 0 })
    expect(r.headMph).toBe(0)
    expect(r.crossMph).toBe(10)
    expect(r.label).toBe('10mph L→R cross')
  })

  it('pure right-to-left cross: hole plays N, wind from E', () => {
    const r = decomposeWind({ windDir: 90, windSpeed: 10, bearingDeg: 0 })
    expect(r.headMph).toBe(0)
    expect(r.crossMph).toBe(-10)
    expect(r.label).toBe('10mph R→L cross')
  })

  it('diagonal: SW wind on a NE-playing hole', () => {
    // bearing 45 (NE), wind from 225 (SW) → pure tailwind from behind-left
    const r = decomposeWind({ windDir: 225, windSpeed: 10, bearingDeg: 45 })
    expect(r.headMph).toBe(-10)
    expect(Math.abs(r.crossMph)).toBeLessThanOrEqual(1) // rounding noise
  })

  it('combined head + cross', () => {
    // bearing 0, wind from NE (45°) → headwind + R→L cross (wind hits player's right shoulder)
    const r = decomposeWind({ windDir: 45, windSpeed: 14, bearingDeg: 0 })
    expect(r.headMph).toBeGreaterThan(0)
    expect(r.crossMph).toBeLessThan(0)
    expect(r.label).toMatch(/headwind/)
    expect(r.label).toMatch(/R→L cross/)
  })
})

describe('windDistanceAdjustmentYds', () => {
  it('returns 0 for invalid input', () => {
    expect(windDistanceAdjustmentYds(NaN, 150)).toBe(0)
    expect(windDistanceAdjustmentYds(10, 0)).toBe(0)
  })
  it('adds yards in headwind', () => {
    expect(windDistanceAdjustmentYds(10, 150)).toBe(15)  // ~1%
  })
  it('subtracts yards in tailwind, smaller magnitude', () => {
    const v = windDistanceAdjustmentYds(-10, 150)
    expect(v).toBeLessThan(0)
    expect(Math.abs(v)).toBeLessThan(15)                 // ~0.7%
  })
})
