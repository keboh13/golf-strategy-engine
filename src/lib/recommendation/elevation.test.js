import { describe, it, expect } from 'vitest'
import { altitudeAdjustment, holeElevationDeltaYds, effectiveYardage } from './elevation.js'

describe('altitudeAdjustment', () => {
  it('returns 0 with no altitude', () => {
    expect(altitudeAdjustment(150, 0)).toBe(0)
    expect(altitudeAdjustment(150, null)).toBe(0)
  })
  it('shrinks yardage at altitude', () => {
    expect(altitudeAdjustment(150, 5000)).toBe(-15) // ~2% per 1k ft * 5 = 10% of 150
  })
})

describe('holeElevationDeltaYds', () => {
  it('adds yards uphill', () => {
    expect(holeElevationDeltaYds(20)).toBe(20)
  })
  it('subtracts yards downhill', () => {
    expect(holeElevationDeltaYds(-15)).toBe(-15)
  })
})

describe('effectiveYardage', () => {
  it('returns null on bad input', () => {
    expect(effectiveYardage({ rawYds: 0 })).toBeNull()
  })
  it('combines altitude and hole delta', () => {
    const r = effectiveYardage({ rawYds: 150, courseElevationFt: 5000, holeDeltaFt: 10 })
    expect(r.effectiveYds).toBe(150 - 15 + 10)
    expect(r.deltaYds).toBe(-5)
    expect(r.label).toMatch(/alt -15y/)
    expect(r.label).toMatch(/elev \+10y/)
  })
  it('no-op at sea level on flat hole', () => {
    const r = effectiveYardage({ rawYds: 150, courseElevationFt: 0, holeDeltaFt: 0 })
    expect(r.effectiveYds).toBe(150)
    expect(r.label).toBeNull()
  })
})
