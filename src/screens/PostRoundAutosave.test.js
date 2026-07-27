import { describe, it, expect } from 'vitest'
import { stableBriefId, AUTOSAVE_DEBOUNCE_MS } from './HistoryTab.jsx'

describe('stableBriefId', () => {
  it('uses brief.id when present', () => {
    expect(stableBriefId({ id: 'uuid-123', rec_log_id: 'rec-1', course: 'Pine', date: '2026-01-01' }))
      .toBe('uuid-123')
  })

  it('falls back to rec_log_id when no id', () => {
    expect(stableBriefId({ rec_log_id: 'rec-1', course: 'Pine', date: '2026-01-01' }))
      .toBe('rec-1')
  })

  it('falls back to deterministic slug from course + date', () => {
    expect(stableBriefId({ course: ' Pine Valley ', date: '2026-07-10' }))
      .toBe('pine valley::2026-07-10')
  })

  it('handles missing date', () => {
    expect(stableBriefId({ course: 'Augusta' }))
      .toBe('augusta::unknown')
  })

  it('handles missing course', () => {
    expect(stableBriefId({}))
      .toBe('::unknown')
  })
})

describe('AUTOSAVE_DEBOUNCE_MS', () => {
  it('is 2000ms', () => {
    expect(AUTOSAVE_DEBOUNCE_MS).toBe(2000)
  })
})
