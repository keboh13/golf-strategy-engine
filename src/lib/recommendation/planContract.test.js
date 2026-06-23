import { describe, it, expect } from 'vitest'
import { validatePlanContract } from './planContract.js'

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
})
