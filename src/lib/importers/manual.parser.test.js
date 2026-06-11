import { describe, it, expect } from 'vitest'
import manual from './manual.parser.js'

const SAMPLE = [
  '7-iron, 165.4, -3.2',
  'Driver, 270, 12',
  'PW, 121',
].join('\n')

describe('manual parser — detect', () => {
  it('scores at most 0.1 when most lines look like "club, carry[, offline]"', () => {
    expect(manual.detect(SAMPLE)).toBe(0.1)
    expect(manual.detect('7i, 165')).toBe(0.1)
  })

  it('returns 0 for prose, empty input, and wide CSVs', () => {
    expect(manual.detect('')).toBe(0)
    expect(manual.detect('hello world\nthis is just prose')).toBe(0)
    expect(manual.detect('Club,Carry,Total,Ball Speed\n7i,165,172,118')).toBe(0)
  })

  it('returns 0 when fewer than 60% of lines match', () => {
    expect(manual.detect('7i, 165\nnot a shot\nstill not a shot')).toBe(0)
  })
})

describe('manual parser — parse', () => {
  it('parses club, carry, and optional offline into NormalizedShots', () => {
    const session = manual.parse(SAMPLE)
    expect(session.source).toBe('manual')
    expect(session.sessionDate).toBe(null)
    expect(session.unitsDetected).toBe('yards')
    expect(session.warnings).toEqual([])
    expect(session.shots).toHaveLength(3)

    expect(session.shots[0]).toEqual({
      clubKey: '7i', clubLabel: '7i', carryYds: 165.4, totalYds: null,
      offlineYds: -3.2, ballSpeedMph: null, clubSpeedMph: null,
      launchDeg: null, spinRpm: null, apexFt: null, timestamp: null,
    })
    expect(session.shots[1].clubKey).toBe('driver')
    expect(session.shots[1].carryYds).toBe(270)
    expect(session.shots[1].offlineYds).toBe(12)
    expect(session.shots[2].clubKey).toBe('pw')
    expect(session.shots[2].offlineYds).toBe(null)
  })

  it('skips unparseable lines (e.g. headers) with a warning', () => {
    const session = manual.parse('club, carry\n7i, 165\n\nDriver, 270')
    expect(session.shots).toHaveLength(2)
    expect(session.warnings).toHaveLength(1)
    expect(session.warnings[0]).toMatch(/Skipped 1 line/)
  })

  it("throws 'No shots found' when nothing parses", () => {
    expect(() => manual.parse('no shot data here')).toThrow('No shots found')
    expect(() => manual.parse('')).toThrow('No shots found')
  })
})
