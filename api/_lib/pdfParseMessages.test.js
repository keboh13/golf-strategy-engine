import { describe, it, expect } from 'vitest'
import { buildScorecardTeesMessages, buildHazardDesignMessages } from './pdfParseMessages.js'

describe('buildScorecardTeesMessages', () => {
  it('sends the PDF as a document block pointing at the given URL', () => {
    const messages = buildScorecardTeesMessages('https://example.com/book.pdf', 'Ravines Golf Club', 'Saugatuck, MI')
    expect(messages).toHaveLength(1)
    expect(messages[0].role).toBe('user')
    const docBlock = messages[0].content.find(b => b.type === 'document')
    expect(docBlock.source).toEqual({ type: 'url', url: 'https://example.com/book.pdf' })
  })

  it('names the course and location in the instruction text', () => {
    const messages = buildScorecardTeesMessages('https://example.com/book.pdf', 'Ravines Golf Club', 'Saugatuck, MI')
    const textBlock = messages[0].content.find(b => b.type === 'text')
    expect(textBlock.text).toContain('Ravines Golf Club')
    expect(textBlock.text).toContain('Saugatuck, MI')
  })

  it('asks for tees and per-tee holes, but not hazards/description/visual analysis', () => {
    const messages = buildScorecardTeesMessages('https://example.com/book.pdf', 'Ravines Golf Club', 'Saugatuck, MI')
    const text = messages[0].content.find(b => b.type === 'text').text
    expect(text).toMatch(/tees/i)
    expect(text).toMatch(/selectedTee/)
    expect(text).not.toMatch(/hazardsByHole/)
    expect(text).not.toMatch(/visualNotes/)
    expect(text).not.toMatch(/distanceMarkers/)
  })
})

describe('buildHazardDesignMessages', () => {
  it('sends the PDF as a document block pointing at the given URL', () => {
    const messages = buildHazardDesignMessages('https://example.com/book.pdf', 'Ravines Golf Club', 'Saugatuck, MI')
    expect(messages).toHaveLength(1)
    expect(messages[0].role).toBe('user')
    const docBlock = messages[0].content.find(b => b.type === 'document')
    expect(docBlock.source).toEqual({ type: 'url', url: 'https://example.com/book.pdf' })
  })

  it('asks for hazards, descriptions, and visual-diagram analysis, but not the scorecard/tees table', () => {
    const messages = buildHazardDesignMessages('https://example.com/book.pdf', 'Ravines Golf Club', 'Saugatuck, MI')
    const text = messages[0].content.find(b => b.type === 'text').text
    expect(text).toMatch(/hazardsByHole/)
    expect(text).toMatch(/visualNotes/)
    expect(text).toMatch(/distanceMarkers/)
    expect(text).toMatch(/description/)
    expect(text).not.toMatch(/selectedTee/)
    expect(text).not.toMatch(/"tees"/)
  })

  it('names the course and location in the instruction text', () => {
    const messages = buildHazardDesignMessages('https://example.com/book.pdf', 'Ravines Golf Club', 'Saugatuck, MI')
    const text = messages[0].content.find(b => b.type === 'text').text
    expect(text).toContain('Ravines Golf Club')
    expect(text).toContain('Saugatuck, MI')
  })
})
