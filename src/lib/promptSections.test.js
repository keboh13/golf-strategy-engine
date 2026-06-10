import { describe, it, expect } from 'vitest'
import { buildClubLine, buildBagSection } from './promptSections.js'

// Expected legacy strings below are hand-computed from the original builder
// in src/App.jsx (buildPrompt):
//   let s = `${c.club}: ${c.carry}y (${c.shape})`
//   const analytics = [
//     c.ballSpeed   ? `${c.ballSpeed}mph ball speed` : '',
//     c.launchAngle ? `${c.launchAngle}° launch` : '',
//     c.spinRate    ? `${c.spinRate}rpm spin` : '',
//     (c.dispLeft || c.dispRight) ? `${c.dispLeft || 0}yd left / ${c.dispRight || 0}yd right dispersion` : '',
//   ].filter(Boolean)
//   if (analytics.length) s += ` | ${analytics.join(', ')}`
//   ...join(', ')

describe('buildClubLine — legacy path (no club.stats)', () => {
  it('renders the base line with no optional fields', () => {
    expect(buildClubLine({ club: 'Driver', carry: '275', shape: 'Draw' }))
      .toBe('Driver: 275y (Draw)')
  })

  it('treats empty-string optional fields as absent', () => {
    expect(buildClubLine({
      club: '7 Iron', carry: '172', shape: 'Straight',
      ballSpeed: '', launchAngle: '', spinRate: '', dispLeft: '', dispRight: '',
    })).toBe('7 Iron: 172y (Straight)')
  })

  it('renders ball speed alone', () => {
    expect(buildClubLine({ club: 'Driver', carry: '275', shape: 'Draw', ballSpeed: '158' }))
      .toBe('Driver: 275y (Draw) | 158mph ball speed')
  })

  it('renders launch angle alone', () => {
    expect(buildClubLine({ club: 'Driver', carry: '275', shape: 'Draw', launchAngle: '10.5' }))
      .toBe('Driver: 275y (Draw) | 10.5° launch')
  })

  it('renders spin rate alone', () => {
    expect(buildClubLine({ club: 'Driver', carry: '275', shape: 'Draw', spinRate: '2600' }))
      .toBe('Driver: 275y (Draw) | 2600rpm spin')
  })

  it('renders dispersion with only left set (right defaults to 0)', () => {
    expect(buildClubLine({ club: 'Driver', carry: '275', shape: 'Draw', dispLeft: '12' }))
      .toBe('Driver: 275y (Draw) | 12yd left / 0yd right dispersion')
  })

  it('renders dispersion with only right set (left defaults to 0)', () => {
    expect(buildClubLine({ club: 'Driver', carry: '275', shape: 'Fade', dispRight: '8' }))
      .toBe('Driver: 275y (Fade) | 0yd left / 8yd right dispersion')
  })

  it('renders all optional fields joined with ", "', () => {
    expect(buildClubLine({
      club: 'Driver', carry: '275', shape: 'Draw',
      ballSpeed: '158', launchAngle: '10.5', spinRate: '2600', dispLeft: '12', dispRight: '8',
    })).toBe('Driver: 275y (Draw) | 158mph ball speed, 10.5° launch, 2600rpm spin, 12yd left / 8yd right dispersion')
  })

  it('keeps the "0" string quirk: dispLeft "0" still emits dispersion', () => {
    // ('0' || dispRight) is truthy in the original code, so this must render.
    expect(buildClubLine({ club: 'Driver', carry: '275', shape: 'Draw', dispLeft: '0' }))
      .toBe('Driver: 275y (Draw) | 0yd left / 0yd right dispersion')
  })
})

describe('buildClubLine — stats present but samples < 3', () => {
  it('falls back to the legacy line plus an (n=…) suffix', () => {
    expect(buildClubLine({
      club: 'Driver', carry: '275', shape: 'Draw',
      stats: { samples: 2, carryP50: 280, carryAvg: 279 },
    })).toBe('Driver: 275y (Draw) (n=2 imported shots)')
  })

  it('keeps legacy analytics fields in the fallback line', () => {
    expect(buildClubLine({
      club: 'Driver', carry: '275', shape: 'Draw', ballSpeed: '158',
      stats: { samples: 1 },
    })).toBe('Driver: 275y (Draw) | 158mph ball speed (n=1 imported shots)')
  })

  it('handles null samples without crashing (n=0)', () => {
    expect(buildClubLine({
      club: 'Driver', carry: '275', shape: 'Draw',
      stats: { samples: null },
    })).toBe('Driver: 275y (Draw) (n=0 imported shots)')
  })
})

const fullStats = {
  clubKey: 'driver',
  samples: 124,
  carryAvg: 273.4,
  carryP50: 275.2,
  carryP80: 282.1,
  carryStd: 9.1,
  totalAvg: 290.3,
  offlineBias: 3.2,
  offlineStd: 7.0,
  dispLeftP80: 12.3,
  dispRightP80: 8.4,
  ballSpeedAvg: 158.2,
  launchAvg: 10.5,
  spinAvg: 2602.4,
  lastSessionDate: '2026-05-20',
  sources: ['trackman'],
}

describe('buildClubLine — rich path (stats with samples >= 3)', () => {
  it('renders the full dense line on one line', () => {
    const line = buildClubLine({ club: 'Driver', carry: '275', shape: 'Draw', stats: fullStats })
    expect(line).toBe(
      'Driver: 275y carry (Draw, P50 of 124 shots, P80 282y, ±9.1y) | miss bias 3.2y R, disp 12y L / 8y R | 158.2mph ball, 10.5° launch, 2602rpm | data: trackman, last 2026-05-20'
    )
    expect(line).not.toContain('\n')
  })

  it('uses L direction for negative offline bias', () => {
    const line = buildClubLine({
      club: '3 Wood', carry: '245', shape: 'Fade',
      stats: { ...fullStats, samples: 40, offlineBias: -4.25 },
    })
    expect(line).toContain('miss bias 4.3y L')
  })

  it('renders a neutral bias of 0 without direction', () => {
    const line = buildClubLine({
      club: 'Driver', carry: '275', shape: 'Draw',
      stats: { ...fullStats, offlineBias: 0 },
    })
    expect(line).toContain('miss bias 0y,')
    expect(line).not.toContain('0y R')
    expect(line).not.toContain('0y L')
  })

  it('omits null segments entirely', () => {
    const line = buildClubLine({
      club: 'Driver', carry: '275', shape: 'Draw',
      stats: {
        clubKey: 'driver', samples: 10, carryAvg: null, carryP50: 280.4,
        carryP80: null, carryStd: null, totalAvg: null, offlineBias: null,
        offlineStd: null, dispLeftP80: null, dispRightP80: null,
        ballSpeedAvg: null, launchAvg: null, spinAvg: null,
        lastSessionDate: null, sources: [],
      },
    })
    expect(line).toBe('Driver: 280y carry (Draw, P50 of 10 shots)')
  })

  it('falls back to carryAvg labelled "avg" when carryP50 is null', () => {
    const line = buildClubLine({
      club: 'Driver', carry: '275', shape: 'Draw',
      stats: { ...fullStats, samples: 10, carryP50: null, carryAvg: 278.6, carryP80: null, carryStd: null },
    })
    expect(line.startsWith('Driver: 279y carry (Draw, avg of 10 shots)')).toBe(true)
  })

  it('omits the shape when missing and keeps the parens valid', () => {
    const line = buildClubLine({
      club: 'Driver', carry: '275', shape: '',
      stats: { ...fullStats, samples: 10, carryP80: null, carryStd: null },
    })
    expect(line.startsWith('Driver: 275y carry (P50 of 10 shots)')).toBe(true)
  })

  it('renders only one side of dispersion when the other is null', () => {
    const line = buildClubLine({
      club: 'Driver', carry: '275', shape: 'Draw',
      stats: { ...fullStats, dispLeftP80: null },
    })
    expect(line).toContain('disp 8y R')
    expect(line).not.toContain(' L')
  })

  it('joins multiple sources with "/"', () => {
    const line = buildClubLine({
      club: 'Driver', carry: '275', shape: 'Draw',
      stats: { ...fullStats, sources: ['trackman', 'garmin'] },
    })
    expect(line).toContain('data: trackman/garmin, last 2026-05-20')
  })

  it('renders the data segment with only a date when sources are empty', () => {
    const line = buildClubLine({
      club: 'Driver', carry: '275', shape: 'Draw',
      stats: { ...fullStats, sources: [] },
    })
    expect(line).toContain('| data: last 2026-05-20')
  })

  it('survives all-null stats by falling back to the legacy head', () => {
    const line = buildClubLine({
      club: 'Driver', carry: '275', shape: 'Draw',
      stats: {
        clubKey: 'driver', samples: 5, carryAvg: null, carryP50: null,
        carryP80: null, carryStd: null, totalAvg: null, offlineBias: null,
        offlineStd: null, dispLeftP80: null, dispRightP80: null,
        ballSpeedAvg: null, launchAvg: null, spinAvg: null,
        lastSessionDate: null, sources: [],
      },
    })
    expect(line).toBe('Driver: 275y (Draw)')
  })
})

describe('buildBagSection', () => {
  it('joins club lines with ", " exactly like the original buildPrompt', () => {
    const clubs = [
      { club: 'Driver', carry: '275', shape: 'Draw' },
      { club: '7 Iron', carry: '172', shape: 'Straight', spinRate: '7000' },
    ]
    expect(buildBagSection(clubs))
      .toBe('Driver: 275y (Draw), 7 Iron: 172y (Straight) | 7000rpm spin')
  })

  it('mixes legacy and rich clubs in one section', () => {
    const clubs = [
      { club: 'Driver', carry: '275', shape: 'Draw', stats: fullStats },
      { club: 'PW', carry: '135', shape: 'Straight' },
    ]
    const out = buildBagSection(clubs)
    expect(out).toContain('Driver: 275y carry (Draw, P50 of 124 shots')
    expect(out).toContain(', PW: 135y (Straight)')
  })

  it('returns an empty string for empty or missing club lists', () => {
    expect(buildBagSection([])).toBe('')
    expect(buildBagSection(null)).toBe('')
    expect(buildBagSection(undefined)).toBe('')
  })
})
