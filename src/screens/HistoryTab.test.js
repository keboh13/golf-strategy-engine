import { describe, it, expect, beforeEach, vi } from 'vitest'
import { draftKey, draftHasContent, readDraft, DRAFT_TTL_MS } from './HistoryTab.jsx'

const mockStorage = {}
vi.stubGlobal('localStorage', {
  getItem: (k) => mockStorage[k] ?? null,
  setItem: (k, v) => { mockStorage[k] = v },
  removeItem: (k) => { delete mockStorage[k] },
})

beforeEach(() => {
  Object.keys(mockStorage).forEach(k => delete mockStorage[k])
})

describe('draftKey', () => {
  it('normalises course name to lowercase trimmed key', () => {
    expect(draftKey('  Pine Valley  ')).toBe('postRound_draft_pine valley')
  })
  it('handles empty/null', () => {
    expect(draftKey(null)).toBe('postRound_draft_')
    expect(draftKey('')).toBe('postRound_draft_')
  })
})

describe('draftHasContent', () => {
  it('returns false for empty draft', () => {
    expect(draftHasContent({ scores: {}, notes: {}, generalNotes: '' })).toBe(false)
  })
  it('detects a score', () => {
    expect(draftHasContent({ scores: { 1: 4 }, notes: {}, generalNotes: '' })).toBe(true)
  })
  it('detects a note', () => {
    expect(draftHasContent({ scores: {}, notes: { 3: 'pushed right' }, generalNotes: '' })).toBe(true)
  })
  it('detects generalNotes', () => {
    expect(draftHasContent({ scores: {}, notes: {}, generalNotes: 'windy' })).toBe(true)
  })
  it('ignores non-finite score values', () => {
    expect(draftHasContent({ scores: { 1: NaN }, notes: {}, generalNotes: '' })).toBe(false)
  })
  it('ignores empty string notes', () => {
    expect(draftHasContent({ scores: {}, notes: { 1: '' }, generalNotes: '' })).toBe(false)
  })
})

describe('readDraft', () => {
  it('returns null when no draft stored', () => {
    expect(readDraft('Pine Valley')).toBeNull()
  })

  it('reads a stored draft', () => {
    const draft = { scores: { 1: 5 }, notes: {}, generalNotes: '', updatedAt: new Date().toISOString() }
    mockStorage[draftKey('Pine Valley')] = JSON.stringify(draft)
    const result = readDraft('Pine Valley')
    expect(result.scores[1]).toBe(5)
  })

  it('evicts drafts older than TTL', () => {
    const old = new Date(Date.now() - DRAFT_TTL_MS - 1000).toISOString()
    const draft = { scores: { 1: 5 }, notes: {}, generalNotes: '', updatedAt: old }
    const key = draftKey('Pine Valley')
    mockStorage[key] = JSON.stringify(draft)
    expect(readDraft('Pine Valley')).toBeNull()
    expect(mockStorage[key]).toBeUndefined()
  })

  it('keeps drafts within TTL', () => {
    const recent = new Date(Date.now() - 1000).toISOString()
    const draft = { scores: { 1: 5 }, notes: {}, generalNotes: '', updatedAt: recent }
    mockStorage[draftKey('Pine Valley')] = JSON.stringify(draft)
    expect(readDraft('Pine Valley')).not.toBeNull()
  })

  it('handles corrupted JSON gracefully', () => {
    mockStorage[draftKey('Pine Valley')] = '{broken'
    expect(readDraft('Pine Valley')).toBeNull()
  })

  it('matches course name case-insensitively', () => {
    const draft = { scores: { 2: 3 }, notes: {}, generalNotes: '', updatedAt: new Date().toISOString() }
    mockStorage[draftKey('pine valley')] = JSON.stringify(draft)
    expect(readDraft('Pine Valley')).not.toBeNull()
    expect(readDraft('  PINE VALLEY  ')).not.toBeNull()
  })
})
