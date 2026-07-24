import { describe, it, expect } from 'vitest'
import { buildScorecardDiff } from './scorecardDiff.js'

describe('buildScorecardDiff', () => {
  it('returns an empty diff when nothing changed', () => {
    const current = { name: 'Ravines', yardage: '6800' }
    const parsed = { name: 'Ravines', yardage: '6800' }
    expect(buildScorecardDiff(current, parsed)).toEqual({})
  })

  it('reports a changed top-level field', () => {
    const current = { name: 'Ravines', yardage: '6800' }
    const parsed = { name: 'Ravines', yardage: '6900' }
    const diff = buildScorecardDiff(current, parsed)
    expect(diff.yardage).toEqual({ current: '6800', parsed: '6900' })
  })

  it('does not report a field the parse left null', () => {
    const current = { rating: '71.2' }
    const parsed = { rating: null }
    expect(buildScorecardDiff(current, parsed)).toEqual({})
  })
})

describe('buildScorecardDiff — hazards', () => {
  it('omits the hazards entry when the parse found no hazard data', () => {
    const diff = buildScorecardDiff({}, { hazardsByHole: [] })
    expect(diff.hazards).toBeUndefined()
  })

  it('reports hazard coverage and carries the raw array for accept', () => {
    const hazardsByHole = [{ hole: 1, dogleg: 'left' }, { hole: 2, dogleg: 'straight' }]
    const diff = buildScorecardDiff({}, { hazardsByHole, hazardCoverage: { covered: 2, total: 18, missingHoles: [] } })
    expect(diff.hazards.parsed).toMatch(/2\/18/)
    expect(diff.hazards._value).toEqual(hazardsByHole)
  })
})
