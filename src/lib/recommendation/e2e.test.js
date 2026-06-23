// End-to-end golden test: 3 player profiles × 3 courses → check that:
//   1. buildRecommendationPrompt emits the required structure
//   2. A well-formed simulated LLM response passes validatePlanContract
//   3. A truncated/missing-sections simulated response fails validation
//
// The LLM is NOT called — this is a structural contract test. A future
// nightly cron can run a real LLM call against this fixture set and store
// pass/fail in rec_quality.

import { describe, it, expect } from 'vitest'
import { buildRecommendationPrompt } from './prompt.js'
import { validatePlanContract } from './planContract.js'

const players = [
  { name: 'Scratch', handicap: '0.5', handedness: 'Right', miss: { shape: 'fade', magnitudeYds: 6, trigger: 'pressure' }, ballFlight: 'Fade' },
  { name: 'Mid',     handicap: '14', handedness: 'Right', miss: 'Both sides under pressure', ballFlight: 'Straight' },
  { name: 'Lefty',   handicap: '8',  handedness: 'Left',  miss: { shape: 'draw', magnitudeYds: 10, trigger: 'tight tee shots' }, ballFlight: 'Draw' },
]

const baseClubs = (carryDriver) => [
  { club: 'Driver',  carry: carryDriver, shape: 'Slight fade' },
  { club: '7-iron',  carry: 165, shape: 'Straight' },
  { club: 'PW',      carry: 120, shape: 'Draw' },
]

const baseCourse = (overrides = {}) => ({
  name: 'TestCourse',
  par: 72,
  yardage: 6900,
  rating: 71.2,
  slope: 132,
  source: 'GolfCourseAPI',
  holes: Array.from({ length: 18 }, (_, i) => ({
    par: [4,4,3,5,4,3,4,5,4,4,3,4,5,4,3,4,4,5][i],
    yardage: 380,
    handicap: i + 1,
  })),
  ...overrides,
})

const courses = [
  baseCourse({ elevation: 100 }),
  baseCourse({ elevation: 5000, holes: baseCourse().holes.map((h, i) => i === 0 ? { ...h, osmDesign: { dogleg: 'right', bearingDeg: 90, hazards: [{ type: 'water', loc: 'R' }] } } : h) }),
  baseCourse({ holes: baseCourse().holes.map((h, i) => i < 3 ? { ...h, hzDesign: { _confidence: 'high', hazards: [{ type: 'bunker', side: 'R', carry_yards: 220 }] } } : h) }),
]

function simulateGoodPlan() {
  let s = `## Round strategy\nA, B, C.\n\n## Scoring roadmap\nH1 Par 4 — go\n\n## Hole-by-hole\n`
  for (let i = 1; i <= 18; i++) {
    s += `### Hole ${i} — Par 4\n- **Tee**: driver\n- **Approach**: 7i, 165y, center\n- **Caddy**: smooth.\n\`\`\`green-json\n{"depth_y":28,"hazards":[]}\n\`\`\`\n`
  }
  return s
}

function simulateTruncatedPlan() {
  return simulateGoodPlan().replace(/### Hole 15[\s\S]*$/, '')
}

describe('e2e: 3 profiles × 3 courses → prompt + contract', () => {
  for (const p of players) {
    for (let c = 0; c < courses.length; c++) {
      it(`prompt valid for ${p.name} × course#${c}`, () => {
        const { prompt, meta } = buildRecommendationPrompt({
          playerInfo: p, clubs: baseClubs(p.handicap === '14' ? 230 : 275),
          course: courses[c], teeTime: '10:00', teeDate: '2026-06-22', pace: 11,
          scoringHistory: [],
        })
        expect(meta.mode).toBe('course_loaded')
        // Confirm all 18 holes appear in the prompt
        for (let i = 1; i <= 18; i++) expect(prompt).toContain(`H${i}:`)
        expect(prompt).toContain('Confidence rollup')
        expect(prompt).toContain('PRE-COMPUTED HINTS')
      })
    }
  }

  it('a complete simulated plan passes contract validation', () => {
    expect(validatePlanContract(simulateGoodPlan()).ok).toBe(true)
  })

  it('a truncated plan fails contract validation', () => {
    const r = validatePlanContract(simulateTruncatedPlan())
    expect(r.ok).toBe(false)
    expect(r.banner).toMatch(/missing holes/)
  })
})
