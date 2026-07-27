import { describe, it, expect } from 'vitest'
import { validatePlanContract, validateContentQuality } from './planContract.js'

function buildPlan({ holes = 18, includeAllFields = true, badGreenJson = 0 } = {}) {
  let s = `## Round strategy
2-3 sentences here.

## Scoring roadmap
H1 Par 4 — go

## Hole-by-hole
`
  for (let i = 1; i <= holes; i++) {
    const fields = includeAllFields
      ? `- **Tee**: driver fade
- **Approach**: 7i, 165y, center
- **Caddy**: smooth swing
`
      : `- **Tee**: driver`
    const greenJson = i <= badGreenJson ? '{bad json' : '{"depth_y":28,"hazards":[]}'
    s += `### Hole ${i} — Par 4
${fields}
\`\`\`green-json
${greenJson}
\`\`\`
`
  }
  return s
}

describe('validatePlanContract', () => {
  it('passes on complete plan', () => {
    const r = validatePlanContract(buildPlan())
    expect(r.ok).toBe(true)
    expect(r.issues).toEqual([])
  })
  it('flags empty input', () => {
    const r = validatePlanContract('')
    expect(r.ok).toBe(false)
    expect(r.issues).toContain('empty_plan')
  })
  it('flags truncated hole count', () => {
    const r = validatePlanContract(buildPlan({ holes: 14 }))
    expect(r.ok).toBe(false)
    expect(r.issues.some(i => i.startsWith('missing_holes:'))).toBe(true)
    expect(r.banner).toMatch(/missing holes/)
  })
  it('flags missing top-level sections', () => {
    const r = validatePlanContract('## Hole-by-hole\nfoo')
    expect(r.ok).toBe(false)
    expect(r.issues).toContain('missing_section:Round strategy')
  })
  it('flags missing per-hole fields', () => {
    const r = validatePlanContract(buildPlan({ includeAllFields: false }))
    expect(r.ok).toBe(false)
    expect(r.issues.some(i => i.startsWith('incomplete_hole_sections:'))).toBe(true)
  })
  it('flags malformed green-json', () => {
    const r = validatePlanContract(buildPlan({ badGreenJson: 3 }))
    expect(r.ok).toBe(false)
    expect(r.issues.some(i => i.startsWith('green_json_malformed:'))).toBe(true)
  })
  it('returns contentWarnings array', () => {
    const r = validatePlanContract(buildPlan())
    expect(Array.isArray(r.contentWarnings)).toBe(true)
  })
  it('passes content quality options through', () => {
    const r = validatePlanContract(buildPlan(), {
      playerClubs: [{ club: 'Driver' }, { club: '7-iron' }],
      hasWindData: true,
    })
    expect(Array.isArray(r.contentWarnings)).toBe(true)
    // Plan has no wind mentions so should warn
    expect(r.contentWarnings.some(w => w.includes('wind_ignored'))).toBe(true)
  })
})

// ── Issue #207: Content quality validation tests ──────────────────────────

describe('validateContentQuality', () => {
  it('returns empty array on empty text', () => {
    expect(validateContentQuality('')).toEqual([])
  })

  it('flags unknown clubs', () => {
    const text = `### Hole 1
- **Tee**: BazoOka, center
- **Approach**: 7i
- **Caddy**: go`
    const warnings = validateContentQuality(text, {
      playerClubs: [{ club: 'Driver' }, { club: '7-iron' }],
    })
    expect(warnings.some(w => w.includes('unknown_clubs'))).toBe(true)
  })

  it('flags low club variety (same club >80% of tee shots)', () => {
    let text = '## Round strategy\nfoo\n## Scoring roadmap\nbar\n## Hole-by-hole\n'
    for (let i = 1; i <= 18; i++) {
      text += `### Hole ${i}\n- **Tee**: Driver, center\n- **Approach**: 7i\n- **Caddy**: go\n`
    }
    const warnings = validateContentQuality(text, {
      playerClubs: [{ club: 'Driver' }, { club: '7-iron' }, { club: '3-wood' }],
    })
    expect(warnings.some(w => w.includes('low_club_variety'))).toBe(true)
  })

  it('flags wind ignored when wind data provided', () => {
    const text = `### Hole 1\n- **Tee**: Driver\n- **Approach**: 7i\n- **Caddy**: smooth`
    const warnings = validateContentQuality(text, { hasWindData: true })
    expect(warnings.some(w => w.includes('wind_ignored'))).toBe(true)
  })

  it('does not flag wind when not provided', () => {
    const text = `### Hole 1\n- **Tee**: Driver\n- **Approach**: 7i\n- **Caddy**: smooth`
    const warnings = validateContentQuality(text, { hasWindData: false })
    expect(warnings.every(w => !w.includes('wind_ignored'))).toBe(true)
  })

  it('does not flag wind when plan mentions wind', () => {
    const text = `### Hole 1\n- **Tee**: Driver into headwind\n- **Approach**: 7i\n- **Caddy**: use wind`
    const warnings = validateContentQuality(text, { hasWindData: true })
    expect(warnings.every(w => !w.includes('wind_ignored'))).toBe(true)
  })

  it('flags repetition when same tee recommendation appears 3+ times', () => {
    let text = ''
    for (let i = 1; i <= 6; i++) {
      text += `### Hole ${i}\n- **Tee**: Driver, center fairway, slight fade\n- **Approach**: 7i\n- **Caddy**: go\n`
    }
    const warnings = validateContentQuality(text)
    expect(warnings.some(w => w.includes('repetition'))).toBe(true)
  })

  it('does not flag repetition for unique recommendations', () => {
    let text = ''
    for (let i = 1; i <= 6; i++) {
      text += `### Hole ${i}\n- **Tee**: ${i % 2 ? 'Driver' : '3-wood'}, target ${i}\n- **Approach**: 7i\n- **Caddy**: go\n`
    }
    const warnings = validateContentQuality(text)
    expect(warnings.every(w => !w.includes('repetition'))).toBe(true)
  })
})
