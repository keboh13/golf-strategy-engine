import { describe, it, expect } from 'vitest'
import { normalizeDate, parseScorePaste } from './scoreImport.js'

describe('normalizeDate', () => {
  it('passes through ISO dates', () => {
    expect(normalizeDate('2026-06-01')).toBe('2026-06-01')
    expect(normalizeDate('2026/6/1')).toBe('2026-06-01')
  })

  it('parses US M/D/YYYY', () => {
    expect(normalizeDate('6/8/2026')).toBe('2026-06-08')
    expect(normalizeDate('12/31/2025')).toBe('2025-12-31')
    expect(normalizeDate('06-03-2020')).toBe('2020-06-03')
  })

  it('handles 2-digit years with a 1970 pivot', () => {
    expect(normalizeDate('6/8/26')).toBe('2026-06-08')
    expect(normalizeDate('6/8/99')).toBe('1999-06-08')
  })

  it('tolerates D/M/YYYY when month slot is impossible', () => {
    expect(normalizeDate('31/12/2025')).toBe('2025-12-31')
  })

  it('parses month-name formats', () => {
    expect(normalizeDate('8 Jun 2026')).toBe('2026-06-08')
    expect(normalizeDate('8 June 2026')).toBe('2026-06-08')
    expect(normalizeDate('Jun 8, 2026')).toBe('2026-06-08')
    expect(normalizeDate('June 8 2026')).toBe('2026-06-08')
    expect(normalizeDate('Sep. 1, 2025')).toBe('2025-09-01')
  })

  it('rejects garbage', () => {
    expect(normalizeDate('not a date')).toBeNull()
    expect(normalizeDate('13/13/2025')).toBeNull()
    expect(normalizeDate('6/45/2026')).toBeNull()
    expect(normalizeDate('')).toBeNull()
    expect(normalizeDate('2026-06')).toBeNull()
  })
})

describe('parseScorePaste — GHIN format', () => {
  it('parses tab-separated GHIN Score History rows', () => {
    const text = [
      'Score History',
      'Total Score\tDate\tC.R./Slope\tPCC\tDifferential\tCourse',
      '76 A\t06/03/2020\t74.7/133\t-\t1.1\tStreamsong Resort BLACK\tNo Stats',
      '81 H\t05/28/2020\t70.6/128\t-\t9.2\tRhodes Ranch GC\tNo Stats',
    ].join('\n')
    const { rounds, warnings } = parseScorePaste(text)
    expect(warnings).toEqual([])
    expect(rounds).toHaveLength(2)
    expect(rounds[0]).toMatchObject({
      course: 'Streamsong Resort BLACK',
      date: '2020-06-03',
      score: 76,
      par: 72,
      toPar: '+4',
      roundType: 'Casual',
      conditions: 'Normal',
    })
    expect(rounds[0].notes).toContain('74.7/133')
    expect(rounds[1].course).toBe('Rhodes Ranch GC')
    expect(rounds[1].toPar).toBe('+9')
  })

  it('parses space-separated GHIN rows and maps T/C to Tournament', () => {
    const text = '72 T   06/03/2020   74.7/133   -   1.1   Streamsong Resort BLACK   No Stats'
    const { rounds } = parseScorePaste(text)
    expect(rounds[0].roundType).toBe('Tournament')
    expect(rounds[0].toPar).toBe('E')
    expect(rounds[0].course).toBe('Streamsong Resort BLACK')
  })

  it('handles GHIN rows without rating/slope', () => {
    const { rounds } = parseScorePaste('85 H 06/03/2020 Desert Pines GC')
    expect(rounds[0]).toMatchObject({ course: 'Desert Pines GC', score: 85, date: '2020-06-03' })
    expect(rounds[0].notes).toBe('Imported from GHIN paste')
  })

  it('skips GHIN UI chrome lines without warnings', () => {
    const text = [
      'Score History',
      'Graph View',
      '20 most recent scores',
      '76 A\t06/03/2020\t74.7/133\t-\t1.1\tStreamsong Resort BLACK',
    ].join('\n')
    const { rounds, warnings } = parseScorePaste(text)
    expect(rounds).toHaveLength(1)
    expect(warnings).toEqual([])
  })
})

describe('parseScorePaste — CSV/TSV', () => {
  it('parses date,course,score,par CSV', () => {
    const { rounds } = parseScorePaste('2026-06-01,Rhodes Ranch GC,68,72')
    expect(rounds[0]).toMatchObject({
      course: 'Rhodes Ranch GC', date: '2026-06-01', score: 68, par: 72, toPar: '-4',
    })
  })

  it('parses TSV with course before date', () => {
    const { rounds } = parseScorePaste('TPC Summerlin\t6/3/2026\t74')
    expect(rounds[0]).toMatchObject({ course: 'TPC Summerlin', date: '2026-06-03', score: 74 })
  })

  it('respects an explicit par column', () => {
    const { rounds } = parseScorePaste('2026-06-01,Wolf Creek,70,71')
    expect(rounds[0].par).toBe(71)
    expect(rounds[0].toPar).toBe('-1')
  })

  it('captures round type and extra text as location', () => {
    const { rounds } = parseScorePaste('6/1/2026,Bali Hai GC,Las Vegas NV,73,Tournament')
    expect(rounds[0]).toMatchObject({
      course: 'Bali Hai GC', location: 'Las Vegas NV', score: 73, roundType: 'Tournament',
    })
  })

  it('does not split a "MMM D, YYYY" date on its comma', () => {
    const { rounds } = parseScorePaste('Jun 8, 2026,Paiute Snow Mountain,69')
    expect(rounds[0]).toMatchObject({ date: '2026-06-08', course: 'Paiute Snow Mountain', score: 69 })
  })

  it('skips a header row with a warning but parses data rows', () => {
    const text = 'Date,Course,Score\n2026-06-01,Rhodes Ranch GC,68'
    const { rounds, warnings } = parseScorePaste(text)
    expect(rounds).toHaveLength(1)
    expect(warnings).toEqual([])
  })
})

describe('parseScorePaste — freeform lines', () => {
  it('parses "date - course - score" lines', () => {
    const { rounds } = parseScorePaste('6/8/2026 - Rhodes Ranch GC - 68')
    expect(rounds[0]).toMatchObject({ course: 'Rhodes Ranch GC', date: '2026-06-08', score: 68 })
  })

  it('parses undelimited "date course score" lines', () => {
    const { rounds } = parseScorePaste('6/8/2026 Rhodes Ranch GC 68')
    expect(rounds[0]).toMatchObject({ course: 'Rhodes Ranch GC', date: '2026-06-08', score: 68 })
  })

  it('parses score followed by par in loose lines', () => {
    const { rounds } = parseScorePaste('Jun 8, 2026 Wolf Creek 75 71')
    expect(rounds[0]).toMatchObject({ course: 'Wolf Creek', score: 75, par: 71, toPar: '+4' })
  })

  it('rejects loose lines with ambiguous numbers', () => {
    const text = ['6/8/2026 Hole 9 Course 68 71 75', '6/8/2026 Rhodes Ranch GC 68'].join('\n')
    const { rounds, warnings } = parseScorePaste(text)
    expect(rounds).toHaveLength(1)
    expect(warnings).toHaveLength(1)
  })

  it('does not treat course names with digits as scores', () => {
    const { rounds } = parseScorePaste('2026-06-01,Course 18 at Lakes,68')
    expect(rounds[0].score).toBe(68)
    expect(rounds[0].course).toBe('Course 18 at Lakes')
  })
})

describe('parseScorePaste — dedupe', () => {
  it('drops exact duplicates within a paste', () => {
    const text = [
      '2026-06-01,Rhodes Ranch GC,68',
      '2026-06-01,rhodes ranch gc,68',
      '2026-06-01,Rhodes Ranch GC,71',
    ].join('\n')
    const { rounds, warnings } = parseScorePaste(text)
    expect(rounds).toHaveLength(2)
    expect(warnings.some(w => w.includes('duplicate'))).toBe(true)
  })

  it('skips rounds already in existing history', () => {
    const existing = [{ course: 'Rhodes Ranch GC', date: '2026-06-01', score: 68 }]
    const text = ['2026-06-01,Rhodes Ranch GC,68', '2026-06-02,Rhodes Ranch GC,70'].join('\n')
    const { rounds, warnings } = parseScorePaste(text, existing)
    expect(rounds).toHaveLength(1)
    expect(rounds[0].date).toBe('2026-06-02')
    expect(warnings).toHaveLength(1)
  })

  it('tolerates blank/partial existing rows (the app default empty row)', () => {
    const existing = [{ course: '', location: '', date: '', score: '', par: 72, toPar: '', roundType: 'Tournament', conditions: '', notes: '' }]
    const { rounds } = parseScorePaste('2026-06-01,Rhodes Ranch GC,68', existing)
    expect(rounds).toHaveLength(1)
  })
})

describe('parseScorePaste — failure behavior', () => {
  it('throws on pure garbage', () => {
    expect(() => parseScorePaste('hello world\nthis is not golf data')).toThrow(/no rounds found/i)
  })

  it('throws on empty / null input', () => {
    expect(() => parseScorePaste('')).toThrow(/no rounds found/i)
    expect(() => parseScorePaste(null)).toThrow(/no rounds found/i)
    expect(() => parseScorePaste('   \n  \n')).toThrow(/no rounds found/i)
  })

  it('returns warnings for unparseable lines mixed with good ones', () => {
    const text = ['random note to self', '2026-06-01,Rhodes Ranch GC,68'].join('\n')
    const { rounds, warnings } = parseScorePaste(text)
    expect(rounds).toHaveLength(1)
    expect(warnings).toEqual(['Could not parse line: "random note to self"'])
  })

  it('rejects implausible scores', () => {
    expect(() => parseScorePaste('2026-06-01,Rhodes Ranch GC,250')).toThrow(/no rounds found/i)
    expect(() => parseScorePaste('2026-06-01,Rhodes Ranch GC,12')).toThrow(/no rounds found/i)
  })

  it('handles CRLF and surrounding whitespace', () => {
    const { rounds } = parseScorePaste('\r\n  2026-06-01,Rhodes Ranch GC,68  \r\n\r\n')
    expect(rounds).toHaveLength(1)
  })
})

describe('round shape', () => {
  it('matches the app scoring-history row shape', () => {
    const { rounds } = parseScorePaste('2026-06-01,Rhodes Ranch GC,68')
    expect(Object.keys(rounds[0]).sort()).toEqual(
      ['conditions', 'course', 'date', 'location', 'notes', 'par', 'roundType', 'score', 'toPar'].sort()
    )
    expect(rounds[0].conditions).toBe('Normal')
  })
})
