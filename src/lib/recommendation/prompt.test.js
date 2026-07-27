import { describe, it, expect } from 'vitest'
import { buildRecommendationPrompt, computeMissSideConflicts, findClubForDistance, windAdjustedClubSuggestion, buildScoringStrategy } from './prompt.js'

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

  it('injects a wind "plays +Xy" delta on the hole line and forces the model to reflect it', () => {
    // Hole 1 bearing 90 (playing east). Wind from the east (windDir 90) at
    // 25mph is a full headwind → ~1% per mph on a 425y hole = ~+11y.
    const holeWeather = [{ windDir: 90, windSpeed: 25, temp: 70, precip: 0 }, ...Array(17).fill(null)]
    const { prompt } = buildRecommendationPrompt({
      playerInfo: player, clubs, course,
      holeWeather,
      teeTime: '10:00', teeDate: '2026-06-22', pace: 11, scoringHistory: [],
    })
    // The hole line for H1 must carry the wind-plays delta …
    const h1 = prompt.split('\n').find(l => l.startsWith('H1:'))
    expect(h1).toBeTruthy()
    expect(h1).toMatch(/wind: plays \+\d+y longer/)
    // … and the prompt rules must instruct the model to name the club change.
    expect(prompt).toMatch(/name the club change/)
  })

  it('does NOT surface a wind delta on calm holes (below 3y threshold)', () => {
    const holeWeather = [{ windDir: 0, windSpeed: 2, temp: 70, precip: 0 }, ...Array(17).fill(null)]
    const { prompt } = buildRecommendationPrompt({
      playerInfo: player, clubs, course,
      holeWeather,
      teeTime: '10:00', teeDate: '2026-06-22', pace: 11, scoringHistory: [],
    })
    const h1 = prompt.split('\n').find(l => l.startsWith('H1:'))
    expect(h1).not.toMatch(/wind: plays/)
  })

  it('includes miss-side conflict caution when miss direction matches hazard', () => {
    // Player fades right, hole 1 has bunker R
    const { prompt } = buildRecommendationPrompt({
      playerInfo: player, clubs, course,
      teeTime: '10:00', teeDate: '2026-06-22', pace: 11, scoringHistory: [],
    })
    expect(prompt).toMatch(/CAUTION.*fade.*bunker.*R/i)
  })

  it('includes SCORING_STRATEGY section', () => {
    const { prompt } = buildRecommendationPrompt({
      playerInfo: player, clubs, course,
      teeTime: '10:00', teeDate: '2026-06-22', pace: 11, scoringHistory: [],
    })
    expect(prompt).toContain('SCORING_STRATEGY:')
  })
})

// ── Issue #196: Miss-side conflict tests ──────────────────────────────────

describe('computeMissSideConflicts', () => {
  it('flags conflict when righty fade meets right hazard', () => {
    const conflicts = computeMissSideConflicts(
      { shape: 'fade', magnitudeYds: 15, trigger: 'pressure' },
      [{ type: 'water', side: 'R' }],
      false, // righty
    )
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatch(/CAUTION.*fade.*water.*R/)
    expect(conflicts[0]).toContain('~15y')
    expect(conflicts[0]).toContain('especially pressure')
  })

  it('flags conflict when lefty fade meets left hazard', () => {
    const conflicts = computeMissSideConflicts(
      { shape: 'fade' },
      [{ type: 'bunker', side: 'L' }],
      true, // lefty
    )
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatch(/CAUTION.*fade.*bunker.*L/)
  })

  it('returns empty when miss goes away from hazard', () => {
    const conflicts = computeMissSideConflicts(
      'fade',
      [{ type: 'water', side: 'L' }],
      false, // righty fade goes R, hazard is L → no conflict
    )
    expect(conflicts).toHaveLength(0)
  })

  it('handles legacy string miss', () => {
    const conflicts = computeMissSideConflicts(
      'slice',
      [{ type: 'OB', side: 'R' }],
      false,
    )
    expect(conflicts).toHaveLength(1)
  })

  it('handles draw/hook for righty → left hazard', () => {
    const conflicts = computeMissSideConflicts(
      'draw',
      [{ type: 'water', side: 'L' }],
      false,
    )
    expect(conflicts).toHaveLength(1)
  })

  it('returns empty on null miss', () => {
    expect(computeMissSideConflicts(null, [{ type: 'water', side: 'R' }], false)).toEqual([])
  })

  it('returns empty on no hazards', () => {
    expect(computeMissSideConflicts('fade', [], false)).toEqual([])
  })
})

// ── Issue #200: Wind-adjusted club suggestion tests ───────────────────────

const fullBag = [
  { club: 'Driver', carry: 275 },
  { club: '3-wood', carry: 245 },
  { club: '5-iron', carry: 195 },
  { club: '6-iron', carry: 180 },
  { club: '7-iron', carry: 165 },
  { club: '8-iron', carry: 152 },
  { club: '9-iron', carry: 140 },
  { club: 'PW', carry: 128 },
]

describe('findClubForDistance', () => {
  it('finds exact match', () => {
    const result = findClubForDistance(fullBag, 165)
    expect(result.club).toBe('7-iron')
  })
  it('finds closest club', () => {
    const result = findClubForDistance(fullBag, 170)
    expect(result.club).toBe('7-iron')
  })
  it('returns null on empty clubs', () => {
    expect(findClubForDistance([], 165)).toBeNull()
  })
  it('returns null on invalid distance', () => {
    expect(findClubForDistance(fullBag, -5)).toBeNull()
  })
})

describe('windAdjustedClubSuggestion', () => {
  it('suggests club change when wind delta exceeds 10y', () => {
    const suggestion = windAdjustedClubSuggestion(fullBag, 165, 15)
    expect(suggestion).not.toBeNull()
    expect(suggestion).toContain('Wind-adjusted')
    expect(suggestion).toContain('165y plays as 180y')
    expect(suggestion).toContain('6-iron')
    expect(suggestion).toContain('normally 7-iron')
  })
  it('returns null when delta is small', () => {
    expect(windAdjustedClubSuggestion(fullBag, 165, 5)).toBeNull()
  })
  it('returns null when same club for both distances', () => {
    // 165 and 167 both map to 7-iron
    expect(windAdjustedClubSuggestion(fullBag, 165, 2)).toBeNull()
  })
  it('handles negative wind delta (tailwind)', () => {
    const suggestion = windAdjustedClubSuggestion(fullBag, 180, -15)
    expect(suggestion).not.toBeNull()
    expect(suggestion).toContain('180y plays as 165y')
  })
})

// ── Issue #204: Scoring strategy tests ────────────────────────────────────

describe('buildScoringStrategy', () => {
  const testClubs = [
    { club: 'Driver', carry: 275 },
    { club: '3-wood', carry: 245 },
    { club: '5-iron', carry: 195 },
    { club: '7-iron', carry: 165 },
  ]

  it('categorizes reachable par 5 as birdie target', () => {
    const holes = [{ par: 5, yardage: '510', handicap: 10 }]
    const result = buildScoringStrategy(holes, testClubs, {}, {})
    expect(result).toContain('birdie target')
    expect(result).toContain('SCORING_STRATEGY')
  })

  it('categorizes short par 4 as birdie opportunity', () => {
    const holes = [{ par: 4, yardage: '320', handicap: 14 }]
    const result = buildScoringStrategy(holes, testClubs, {}, {})
    expect(result).toContain('birdie opportunity')
  })

  it('categorizes short par 3 as birdie chance', () => {
    const holes = [{ par: 3, yardage: '145', handicap: 16 }]
    const result = buildScoringStrategy(holes, testClubs, {}, {})
    expect(result).toContain('birdie chance')
  })

  it('categorizes long par 4 as par-save', () => {
    const holes = [{ par: 4, yardage: '450', handicap: 1 }]
    const result = buildScoringStrategy(holes, testClubs, {}, {})
    expect(result).toContain('par')
  })

  it('flags bogey risk when miss conflicts with hazards', () => {
    const holes = [{
      par: 4, yardage: '440', handicap: 2,
      osmDesign: { hazards: [{ type: 'water', loc: 'R' }, { type: 'bunker', loc: 'R' }] },
    }]
    const result = buildScoringStrategy(holes, testClubs, { miss: { shape: 'fade' }, handedness: 'Right' }, {})
    expect(result).toContain('elevated risk')
  })

  it('returns empty string on no holes', () => {
    expect(buildScoringStrategy([], testClubs, {}, {})).toBe('')
  })

  it('returns empty string on null holes', () => {
    expect(buildScoringStrategy(null, testClubs, {}, {})).toBe('')
  })
})
