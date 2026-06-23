import { describe, it, expect } from 'vitest'
import { pickHoleSource, holeConfidence, rollupConfidence, sourceRank } from './confidence.js'

describe('pickHoleSource', () => {
  it('prefers yardage-book over osm over web', () => {
    expect(pickHoleSource({}, { hzDesign: { _confidence: 'high' } })).toBe('yardage_book_high')
    expect(pickHoleSource({}, { osmDesign: {} })).toBe('osm')
    expect(pickHoleSource({}, { webDesign: {} })).toBe('web_search')
  })
  it('falls back to course source', () => {
    expect(pickHoleSource({ source: 'GolfCourseAPI' }, {})).toBe('GolfCourseAPI')
    expect(pickHoleSource({ source: 'OpenGolfAPI' }, {})).toBe('OpenGolfAPI')
    expect(pickHoleSource({ source: 'yardage_book' }, {})).toBe('yardage_book')
    expect(pickHoleSource({}, {})).toBe('manual')
  })
})

describe('holeConfidence', () => {
  it('tags every field', () => {
    const c = holeConfidence({ source: 'GolfCourseAPI' }, { par: 4, yardage: '425', handicap: 3 })
    expect(c.par).toBe('high')
    expect(c.yardage).toBe('high')
    expect(c.hazards).toBe('none')
  })
  it('marks hazards high when from yardage book', () => {
    const c = holeConfidence({}, {
      par: 4, yardage: '425', handicap: 3,
      hzDesign: { _confidence: 'high', hazards: [{ type: 'water', side: 'L' }] },
    })
    expect(c.hazards).toBe('high')
  })
})

describe('rollupConfidence', () => {
  it('returns highest + per-source breakdown', () => {
    const r = rollupConfidence({
      source: 'OpenGolfAPI',
      holes: [
        { hzDesign: { _confidence: 'high' } },
        { hzDesign: { _confidence: 'high' } },
        { osmDesign: {} },
        {},
      ],
    })
    expect(r.highest).toBe('yardage_book_high')
    expect(r.breakdown['yardage_book_high']).toBe(2)
    expect(r.breakdown['osm']).toBe(1)
    expect(r.breakdown['OpenGolfAPI']).toBe(1)
  })
})

describe('sourceRank', () => {
  it('orders as expected', () => {
    expect(sourceRank('yardage_book_high')).toBeGreaterThan(sourceRank('osm'))
    expect(sourceRank('osm')).toBeGreaterThan(sourceRank('web_search'))
    expect(sourceRank('web_search')).toBeGreaterThan(sourceRank('manual'))
    expect(sourceRank('manual')).toBeGreaterThan(sourceRank('unknown'))
  })
})
