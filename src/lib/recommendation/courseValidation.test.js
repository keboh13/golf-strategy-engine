import { describe, it, expect } from 'vitest'
import { validateCourseTotals } from './courseValidation.js'

function goodCourse(overrides = {}) {
  const pars = [4,4,3,5,4,3,4,5,4,4,3,4,5,4,3,4,4,5]
  const yards = [400,420,180,540,395,170,410,520,405,400,165,420,560,400,180,420,405,510]
  return {
    par: 72, yardage: 6900,
    holes: pars.map((p, i) => ({ par: p, yardage: yards[i], handicap: i + 1 })),
    ...overrides,
  }
}

describe('validateCourseTotals', () => {
  it('passes a clean course', () => {
    expect(validateCourseTotals(goodCourse())).toEqual([])
  })
  it('flags hole count', () => {
    const c = goodCourse(); c.holes = c.holes.slice(0, 17)
    expect(validateCourseTotals(c)).toContain('hole_count:17')
  })
  it('flags par mismatch', () => {
    const c = goodCourse(); c.par = 71
    const issues = validateCourseTotals(c)
    expect(issues.some(i => i.startsWith('par_total_mismatch'))).toBe(true)
  })
  it('flags yardage drift > 2%', () => {
    const c = goodCourse(); c.yardage = 6500   // ~6% off
    const issues = validateCourseTotals(c)
    expect(issues.some(i => i.startsWith('yardage_total_mismatch'))).toBe(true)
  })
  it('allows yardage drift within 2%', () => {
    const c = goodCourse(); c.yardage = 6850   // within 1%
    const issues = validateCourseTotals(c)
    expect(issues.some(i => i.startsWith('yardage_total_mismatch'))).toBe(false)
  })
  it('flags impossible hole yardage', () => {
    const c = goodCourse(); c.holes[3].yardage = 5
    const issues = validateCourseTotals(c)
    expect(issues.some(i => i.startsWith('bad_yardage_count'))).toBe(true)
  })
  it('flags duplicate handicap', () => {
    const c = goodCourse(); c.holes[0].handicap = 2
    expect(validateCourseTotals(c)).toContain('handicap_duplicates')
  })
})
