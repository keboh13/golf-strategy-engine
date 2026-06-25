import { describe, it, expect } from 'vitest'
import {
  GENERATION_PHASE_IDS,
  GENERATION_STEPS,
  stripPhaseMarkers,
  findPhaseMarkers,
  recordPhaseDurations,
} from './generationPhases.js'

describe('GENERATION_STEPS', () => {
  it('covers the canonical four phases in order', () => {
    expect(GENERATION_STEPS.map(s => s.id)).toEqual(GENERATION_PHASE_IDS)
  })
})

describe('stripPhaseMarkers', () => {
  it('removes a single marker without touching surrounding text', () => {
    const inp = 'plain prose\n[[PHASE: roadmap]]\n## Scoring roadmap\nbody'
    expect(stripPhaseMarkers(inp)).toBe('plain prose\n## Scoring roadmap\nbody')
  })
  it('tolerates whitespace inside the marker', () => {
    expect(stripPhaseMarkers('a [[ PHASE : holes ]] b')).toBe('a b')
  })
  it('removes multiple markers in one pass', () => {
    const inp = '[[PHASE: roadmap]]\nfoo\n[[PHASE: holes]]\nbar\n[[PHASE: finalize]]\nbaz'
    expect(stripPhaseMarkers(inp)).toBe('foo\nbar\nbaz')
  })
  it('passes through unchanged when no markers are present', () => {
    expect(stripPhaseMarkers('## Scoring roadmap\nstuff')).toBe('## Scoring roadmap\nstuff')
  })
  it('handles null / empty gracefully', () => {
    expect(stripPhaseMarkers('')).toBe('')
    expect(stripPhaseMarkers(null)).toBe(null)
  })
})

describe('findPhaseMarkers', () => {
  it('returns markers in the order they appear', () => {
    const inp = 'header\n[[PHASE: roadmap]]\nbody\n[[PHASE: holes]]\nmore'
    expect(findPhaseMarkers(inp)).toEqual(['roadmap', 'holes'])
  })
  it('returns an empty array when there are no markers', () => {
    expect(findPhaseMarkers('plain text')).toEqual([])
  })
  it('can be called repeatedly (regex lastIndex reset)', () => {
    const inp = '[[PHASE: holes]]'
    expect(findPhaseMarkers(inp)).toEqual(['holes'])
    expect(findPhaseMarkers(inp)).toEqual(['holes'])
  })
})

describe('recordPhaseDurations', () => {
  it('charges the implicit strategy phase from start to the first marker', () => {
    const out = recordPhaseDurations({
      startedAt: 0,
      endedAt: 1000,
      markers: [{ id: 'roadmap', ts: 400 }],
    })
    expect(out.strategy).toBe(400)
    expect(out.roadmap).toBe(600)
  })
  it('chains marker-to-marker correctly', () => {
    const out = recordPhaseDurations({
      startedAt: 1000,
      endedAt: 30000,
      markers: [
        { id: 'roadmap',  ts: 5000 },
        { id: 'holes',    ts: 10000 },
        { id: 'finalize', ts: 26000 },
      ],
    })
    expect(out).toEqual({ strategy: 4000, roadmap: 5000, holes: 16000, finalize: 4000 })
  })
  it('attributes all wall-clock to strategy when no markers landed', () => {
    expect(recordPhaseDurations({ startedAt: 0, endedAt: 1500, markers: [] })).toEqual({ strategy: 1500 })
  })
  it('returns {} when the timestamps are bogus', () => {
    expect(recordPhaseDurations({ startedAt: 'x', endedAt: 1000 })).toEqual({})
    expect(recordPhaseDurations({ startedAt: 1000, endedAt: 500 })).toEqual({})
  })
  it('ignores markers whose ts goes backwards (defends against clock skew)', () => {
    const out = recordPhaseDurations({
      startedAt: 0,
      endedAt: 1000,
      markers: [
        { id: 'roadmap', ts: 400 },
        { id: 'holes',   ts: 200 }, // earlier than the previous — skip
        { id: 'finalize', ts: 800 },
      ],
    })
    expect(out.strategy).toBe(400)
    expect(out.roadmap).toBe(400)
    expect(out.finalize).toBe(200)
  })
})
