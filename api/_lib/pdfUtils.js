// PDF URL validation utility.
// Extracted from course-ai.js.

// Confirm a URL actually serves a PDF. Many "official" yardage-book links
// have rotted and 302-redirect to an HTML homepage; handing those to
// Anthropic's document fetcher produces an opaque base64/format error.
export async function urlServesPdf(url) {
  try {
    // #152: 5s timeout for the PDF probe
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5_000)
    // Range-GET the first few bytes — HEAD lies on a lot of CDNs (returns
    // 200 + text/html for the redirect target instead of the asset).
    let res
    try {
      res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        headers: { Range: 'bytes=0-7' },
        signal: controller.signal,
      })
    } catch (e) {
      clearTimeout(timer)
      return false
    }
    clearTimeout(timer)
    if (!res.ok && res.status !== 206) return false
    const ct = (res.headers.get('content-type') || '').toLowerCase()
    if (ct.includes('application/pdf')) return true
    if (ct.includes('text/html')) return false
    // Content-type missing/ambiguous — sniff the magic bytes.
    const buf = new Uint8Array(await res.arrayBuffer())
    return buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46 // %PDF
  } catch {
    return false
  }
}
