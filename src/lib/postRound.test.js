import { describe, it, expect } from 'vitest'
import { getLatestPostRoundForCourse, renderPriorRoundBlock } from './postRound.js'

describe('getLatestPostRoundForCourse', () => {
  it('returns null when nothing matches', () => {
    const briefs = [{ course: 'Pinehurst', postRound: { scores: { 1: 5 } } }]
    expect(getLatestPostRoundForCourse(briefs, 'Augusta')).toBeNull()
    expect(getLatestPostRoundForCourse([], 'Pinehurst')).toBeNull()
    expect(getLatestPostRoundForCourse(null, 'Pinehurst')).toBeNull()
  })

  it('matches case-insensitively and trims whitespace', () => {
    const briefs = [{ course: '  Pinehurst No. 2 ', postRound: { scores: { 1: 4 } }, date: '2026-07-10' }]
    const pr = getLatestPostRoundForCourse(briefs, 'pinehurst no. 2')
    expect(pr).toBeTruthy()
    expect(pr.date).toBe('2026-07-10')
  })

  it('picks the first (assumed newest) matching brief with any structured data', () => {
    const briefs = [
      { course: 'Pinehurst', date: '2026-07-15', postRound: { scores: { 3: 5 } } },
      { course: 'Pinehurst', date: '2026-07-10', postRound: { notes: { 7: 'long' } } },
    ]
    expect(getLatestPostRoundForCourse(briefs, 'Pinehurst').date).toBe('2026-07-15')
  })

  it('skips briefs whose postRound has only empty structures', () => {
    const briefs = [
      { course: 'Pinehurst', date: '2026-07-15', postRound: { scores: {}, notes: {} } },
      { course: 'Pinehurst', date: '2026-07-10', postRound: { scores: { 3: 5 } } },
    ]
    expect(getLatestPostRoundForCourse(briefs, 'Pinehurst').date).toBe('2026-07-10')
  })
})

describe('renderPriorRoundBlock', () => {
  it('returns empty string when there is nothing to say', () => {
    expect(renderPriorRoundBlock(null)).toBe('')
    expect(renderPriorRoundBlock({ scores: {}, notes: {} })).toBe('')
  })

  it('renders sorted hole lines that combine score and note', () => {
    const out = renderPriorRoundBlock({
      scores: { 7: 6, 3: 4 },
      notes:  { 7: 'went long', 3: 'perfect' },
      date: '2026-07-10',
    })
    expect(out).toMatch(/HINDSIGHT \(2026-07-10\)/)
    // Hole 3 comes before hole 7 in the output
    const h3 = out.indexOf('H3:')
    const h7 = out.indexOf('H7:')
    expect(h3).toBeGreaterThan(-1)
    expect(h7).toBeGreaterThan(h3)
    expect(out).toContain('H3: shot 4 — perfect')
    expect(out).toContain('H7: shot 6 — went long')
  })

  it('appends general notes when present', () => {
    const out = renderPriorRoundBlock({ scores: { 1: 4 }, generalNotes: 'wind stronger than forecast' })
    expect(out).toContain('General: wind stronger than forecast')
  })

  it('ignores hole numbers outside 1..18', () => {
    const out = renderPriorRoundBlock({ scores: { 0: 4, 19: 5, 4: 3 } })
    expect(out).toContain('H4:')
    expect(out).not.toContain('H0:')
    expect(out).not.toContain('H19:')
  })
})
