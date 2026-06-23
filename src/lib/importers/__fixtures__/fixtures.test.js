// Golden fixture tests for launch-monitor importers.
//
// Each fixture is committed as a tiny anonymized CSV. The parser is replayed
// and we assert against a small set of stable output properties. If a vendor
// changes their export format and breaks the parser, these tests catch it
// without needing a real account.
//
// To add a fixture: drop the .csv next to this file and add a block below.
// Keep fixtures TINY (≤ ~10 rows) so they remain readable as code.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parsers } from '../registry.js'
import { validateNormalizedSession } from '../../aiImport.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (name) => readFileSync(join(here, name), 'utf8')

const FIXTURES = [
  {
    name: 'garmin-r10-minimal.csv',
    parserId: 'garmin-r10',
    expect: {
      shots: 4,
      sessionDate: '2026-06-01',
      unitsDetected: 'yards',
      clubKeys: { driver: 2, '7i': 2 },
    },
  },
]

describe('importer fixtures', () => {
  for (const fx of FIXTURES) {
    it(`${fx.name} → ${fx.parserId} parses cleanly`, () => {
      const text = read(fx.name)
      const parser = parsers.find(p => p.id === fx.parserId)
      expect(parser, `parser ${fx.parserId} not found`).toBeTruthy()
      const session = parser.parse(text)
      expect(session.shots.length, 'shot count').toBe(fx.expect.shots)
      if (fx.expect.sessionDate) expect(session.sessionDate).toBe(fx.expect.sessionDate)
      if (fx.expect.unitsDetected) expect(session.unitsDetected).toBe(fx.expect.unitsDetected)
      if (fx.expect.clubKeys) {
        const got = {}
        for (const s of session.shots) got[s.clubKey] = (got[s.clubKey] || 0) + 1
        expect(got).toEqual(fx.expect.clubKeys)
      }
      // Round-trip through the aiImport semantic validator with source='ai-import'
      // (proves shots are within plausible ranges).
      const v = validateNormalizedSession({
        source: 'ai-import',
        sessionDate: session.sessionDate,
        unitsDetected: session.unitsDetected,
        shots: session.shots,
        warnings: session.warnings || [],
      })
      expect(v.ok, v.ok ? '' : v.error).toBe(true)
    })
  }
})
