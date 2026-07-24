// Node-environment tests for the admin PDF-upload client helper.
// No jsdom, no real network — fetch is stubbed.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { adminUploadScorecardPdf } from './courseApi.js'

describe('adminUploadScorecardPdf', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubFetch(status, body) {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(body),
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('POSTs the parse-yardage-book-pdf action with courseName, location, pdf_url, and course_key', async () => {
    const fetchMock = stubFetch(200, { result: { holes: [] } })
    await adminUploadScorecardPdf('tok-123', {
      courseName: 'Ravines Golf Club',
      location: 'Saugatuck, MI',
      pdfUrl: 'https://example.com/book.pdf',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/course-ai')
    const body = JSON.parse(init.body)
    expect(body.action).toBe('parse-yardage-book-pdf')
    expect(body.courseName).toBe('Ravines Golf Club')
    expect(body.location).toBe('Saugatuck, MI')
    expect(body.pdf_url).toBe('https://example.com/book.pdf')
    expect(body.course_key).toBe('ravines golf club|saugatuck, mi')
  })

  it('returns the hazardCoverage the server reports, unmodified', async () => {
    stubFetch(200, {
      result: {
        holes: [],
        hazardCoverage: { covered: 14, total: 18, missingHoles: [3, 4, 6, 15] },
      },
    })
    const result = await adminUploadScorecardPdf('tok-123', {
      courseName: 'Ravines Golf Club',
      location: 'Saugatuck, MI',
      pdfUrl: 'https://example.com/book.pdf',
    })
    expect(result.hazardCoverage).toEqual({ covered: 14, total: 18, missingHoles: [3, 4, 6, 15] })
  })

  it('surfaces a timeout-specific error message on a non-JSON 504 response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 504,
      text: async () => 'Gateway Timeout',
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(adminUploadScorecardPdf('tok-123', {
      courseName: 'Ravines Golf Club',
      location: 'Saugatuck, MI',
      pdfUrl: 'https://example.com/book.pdf',
    })).rejects.toThrow(/timed out/)
  })
})
