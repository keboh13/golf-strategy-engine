import { describe, it, expect } from 'vitest'
import { DEFAULT_PROFILE_NAME } from './useProfile.js'

// useProfile is a React hook that round-trips Supabase — without a DOM or
// renderer we can't drive it through its full lifecycle. The Plan-level
// invariants worth pinning are the constants and module-level contract; the
// behavior is validated by manual smoke (covered in the PR description).

describe('useProfile constants', () => {
  it("exports 'Default' as the seed profile name", () => {
    expect(DEFAULT_PROFILE_NAME).toBe('Default')
  })
})
