import { describe, it, expect } from 'vitest'
import { parsers, detectParser } from './registry.js'

describe('parser registry', () => {
  it('auto-registers *.parser.js default exports', () => {
    expect(parsers.length).toBeGreaterThanOrEqual(1)
    const manual = parsers.find(p => p.id === 'manual')
    expect(manual).toBeTruthy()
    expect(typeof manual.label).toBe('string')
    expect(typeof manual.detect).toBe('function')
    expect(typeof manual.parse).toBe('function')
  })

  it('detectParser picks the highest-scoring parser', () => {
    const picked = detectParser('7i, 165\nDriver, 272, -8')
    expect(picked).toBeTruthy()
    expect(picked.id).toBe('manual')
  })

  it('detectParser returns null when every score is ≤ 0', () => {
    expect(detectParser('completely unrelated prose without shot lines')).toBe(null)
    expect(detectParser('')).toBe(null)
  })
})
