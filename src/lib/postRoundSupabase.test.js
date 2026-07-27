import { describe, it, expect, vi, beforeEach } from 'vitest'

// Set env vars BEFORE any imports so createClient gets called
vi.stubEnv('VITE_SUPABASE_URL', 'https://fake.supabase.co')
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'fake-anon-key')

// Build chainable query mocks
const mockMaybeSingle = vi.fn()
const mockEq2 = vi.fn(() => ({ maybeSingle: mockMaybeSingle }))
const mockEq1 = vi.fn(() => ({ eq: mockEq2 }))
const mockSelectChain = vi.fn(() => ({ eq: mockEq1 }))
const mockUpsert = vi.fn()

const mockFrom = vi.fn(() => ({
  upsert: mockUpsert,
  select: mockSelectChain,
}))

const mockSupabase = { from: mockFrom }

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => mockSupabase,
}))

// Also mock courseCache to avoid import errors
vi.mock('./courseCache.js', () => ({
  cacheKey: (n, l) => `${n}::${l}`,
  isLocalCacheStale: () => false,
  setCachedCourse: () => {},
}))

const { savePostRound, loadPostRound } = await import('./supabase.js')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('savePostRound', () => {
  it('upserts with correct shape and conflict key', async () => {
    mockUpsert.mockResolvedValue({ error: null })
    await savePostRound('user-1', 'brief-abc', {
      scores: { 1: 4, 7: 6 },
      notes: { 7: 'went long' },
      generalNotes: 'windy',
    })
    expect(mockUpsert).toHaveBeenCalledTimes(1)
    const [row, opts] = mockUpsert.mock.calls[0]
    expect(row.user_id).toBe('user-1')
    expect(row.brief_id).toBe('brief-abc')
    expect(row.scores).toEqual({ 1: 4, 7: 6 })
    expect(row.notes).toEqual({ 7: 'went long' })
    expect(row.general_notes).toBe('windy')
    expect(opts.onConflict).toBe('user_id,brief_id')
  })

  it('defaults empty fields', async () => {
    mockUpsert.mockResolvedValue({ error: null })
    await savePostRound('user-1', 'brief-abc', {})
    const [row] = mockUpsert.mock.calls[0]
    expect(row.scores).toEqual({})
    expect(row.notes).toEqual({})
    expect(row.general_notes).toBe('')
  })

  it('throws on Supabase error', async () => {
    mockUpsert.mockResolvedValue({ error: { message: 'RLS' } })
    await expect(savePostRound('u', 'b', {})).rejects.toEqual({ message: 'RLS' })
  })
})

describe('loadPostRound', () => {
  it('returns null when no data', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null })
    const result = await loadPostRound('user-1', 'brief-abc')
    expect(result).toBeNull()
  })

  it('maps DB columns to camelCase shape', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: {
        scores: { 3: 5 },
        notes: { 3: 'chunked' },
        general_notes: 'greens slow',
        updated_at: '2026-07-27T12:00:00Z',
      },
      error: null,
    })
    const result = await loadPostRound('user-1', 'brief-abc')
    expect(result.scores).toEqual({ 3: 5 })
    expect(result.notes).toEqual({ 3: 'chunked' })
    expect(result.generalNotes).toBe('greens slow')
    expect(result.updatedAt).toBe('2026-07-27T12:00:00Z')
  })

  it('throws on Supabase error', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: { message: 'fail' } })
    await expect(loadPostRound('u', 'b')).rejects.toEqual({ message: 'fail' })
  })
})
