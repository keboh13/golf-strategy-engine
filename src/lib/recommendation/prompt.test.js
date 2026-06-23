import { describe, it, expect } from 'vitest'
import { buildRecommendationPrompt } from './prompt.js'

const player = {
  name: 'Test', handicap: '8', handedness: 'Right',
  miss: { shape: 'fade', magnitudeYds: 15, trigger: 'pressure' },
  ballFlight: 'Fade',
}

const clubs = [
  { club: 'Driver', carry: 275, shape: 'Slight fade', stats: {
    samples: 50, carryP50: 275, carryP80: 285, carryStd: 9,
    offlineBias: 5, offlineStd: 12, dispLeftP80: 12, dispRightP80: 18,
    ballSpeedAvg: 158, launchAvg: 10.5, spinAvg: 2600,
    sources: ['r10'], lastSessionDate: '2025-12-01',
  } },
  { club: '7-iron', carry: 165, shape: 'Draw' },
]

const course = {
  name: 'Test GC', location: 'Anywhere',
  yardage: 6900, rating: 71.2, slope: 132, par: 72,
  source: 'GolfCourseAPI',
  conditions: 'Firm',
  elevation: 1000,
  holes: [
    { par: 4, yardage: 425, handicap: 3, osmDesign: { dogleg: 'right', bearingDeg: 90, hazards: [{ type: 'bunker', loc: 'R' }] } },
    ...Array.from({ length: 17 }, (_, i) => ({ par: i % 3 === 0 ? 3 : 4, yardage: 380, handicap: i + 2 })),
  ],
}

describe('buildRecommendationPrompt', () => {
  it('returns profile-only brief when no course', () => {
    const { prompt, meta } = buildRecommendationPrompt({
      playerInfo: player, clubs, course: {}, scoringHistory: [],
    })
    expect(meta.mode).toBe('profile_only')
    expect(prompt).toContain('profile-only brief')
  })

  it('builds full course prompt with all 18 holes', () => {
    const { prompt, meta } = buildRecommendationPrompt({
      playerInfo: player, clubs, course,
      teeTime: '10:00', teeDate: '2026-06-22', pace: 11,
      scoringHistory: [], nowMs: Date.parse('2026-06-22'),
    })
    expect(meta.mode).toBe('course_loaded')
    // 18 hole lines
    for (let i = 1; i <= 18; i++) {
      expect(prompt).toContain(`H${i}: Par`)
    }
    expect(prompt).toContain('Course Handicap:')
    expect(prompt).toContain('Confidence rollup:')
  })

  it('includes elevation-adjusted yardage for course at altitude', () => {
    const { prompt } = buildRecommendationPrompt({
      playerInfo: player, clubs,
      course: { ...course, elevation: 5000 },
      teeTime: '10:00', teeDate: '2026-06-22', pace: 11, scoringHistory: [],
    })
    expect(prompt).toContain('plays')   // effective-yardage parens
    expect(prompt).toContain('alt')
  })

  it('includes wind decomposition when weather available', () => {
    const holeWeather = [{ windDir: 90, windSpeed: 15, temp: 75, precip: 0 }, ...Array(17).fill(null)]
    const { prompt } = buildRecommendationPrompt({
      playerInfo: player, clubs, course,
      holeWeather,
      teeTime: '10:00', teeDate: '2026-06-22', pace: 11, scoringHistory: [],
    })
    // hole 1 bearing 90, wind from east 15mph → headwind
    expect(prompt).toMatch(/headwind/)
  })

  it('includes dispersion-vs-hazard risk line', () => {
    const { prompt } = buildRecommendationPrompt({
      playerInfo: player, clubs, course,
      teeTime: '10:00', teeDate: '2026-06-22', pace: 11, scoringHistory: [],
    })
    // hole 1 has bunker R, driver has positive (right) bias → should flag
    expect(prompt).toMatch(/Risk:|dispersion overlaps/)
  })

  it('respects style param', () => {
    const aggressive = buildRecommendationPrompt({
      playerInfo: player, clubs, course, teeTime: '10:00', teeDate: '2026-06-22', pace: 11, scoringHistory: [], style: 'aggressive',
    })
    const conservative = buildRecommendationPrompt({
      playerInfo: player, clubs, course, teeTime: '10:00', teeDate: '2026-06-22', pace: 11, scoringHistory: [], style: 'conservative',
    })
    expect(aggressive.prompt).toMatch(/AGGRESSIVE PLAN/)
    expect(conservative.prompt).toMatch(/CONSERVATIVE PLAN/)
  })

  it('handles structured miss object', () => {
    const { prompt } = buildRecommendationPrompt({
      playerInfo: player, clubs, course, teeTime: '10:00', teeDate: '2026-06-22', pace: 11, scoringHistory: [],
    })
    expect(prompt).toMatch(/fade.*~15y.*under pressure/)
  })

  it('handles legacy string miss', () => {
    const { prompt } = buildRecommendationPrompt({
      playerInfo: { ...player, miss: 'Both (fade misses right under pressure)' },
      clubs, course, teeTime: '10:00', teeDate: '2026-06-22', pace: 11, scoringHistory: [],
    })
    expect(prompt).toMatch(/Miss tendency: Both/)
  })
})
