import { describe, it, expect } from 'vitest'
import { extractJson, parseJsonFromText, stripJsonFences } from './extractJson.js'

describe('extractJson', () => {
  it('extracts a single fenced JSON object', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}')
  })

  it('returns first balanced object, ignoring trailing prose', () => {
    expect(extractJson('Here you go: {"a":1} — but also note {"b":2}'))
      .toBe('{"a":1}')
  })

  it('handles nested objects', () => {
    expect(extractJson('{"a":{"b":{"c":1}},"d":2}'))
      .toBe('{"a":{"b":{"c":1}},"d":2}')
  })

  it('ignores braces inside strings', () => {
    expect(extractJson('{"note":"} not a real brace {"}'))
      .toBe('{"note":"} not a real brace {"}')
  })

  it('respects escaped quotes', () => {
    const src = '{"a":"he said \\"hi\\"","b":1}'
    expect(extractJson(src)).toBe(src)
  })

  it('returns null on no JSON', () => {
    expect(extractJson('no json here')).toBeNull()
  })

  it('returns null on unbalanced object', () => {
    expect(extractJson('{"a":1, "b":')).toBeNull()
  })

  it('skips preamble before first {', () => {
    expect(extractJson('Sure!\n```\n{"x":1}\n```'))
      .toBe('{"x":1}')
  })
})

describe('parseJsonFromText', () => {
  it('returns ok with value', () => {
    const r = parseJsonFromText('```json\n{"hello":"world"}\n```')
    expect(r.ok).toBe(true)
    expect(r.value).toEqual({ hello: 'world' })
  })
  it('returns ok=false on missing JSON', () => {
    const r = parseJsonFromText('garbage')
    expect(r.ok).toBe(false)
    expect(r.error).toBe('no_balanced_json')
  })
  it('returns ok=false on bad JSON', () => {
    const r = parseJsonFromText('{"a":})')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/parse_failed/)
  })
})

describe('stripJsonFences', () => {
  it('strips ```json fences', () => {
    expect(stripJsonFences('```json\n{"a":1}\n```')).toBe('{"a":1}')
  })
  it('strips bare ``` fences', () => {
    expect(stripJsonFences('```\n{"a":1}\n```')).toBe('{"a":1}')
  })
})
