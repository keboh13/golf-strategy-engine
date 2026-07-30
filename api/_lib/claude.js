// Shared Claude API caller — extracted from course-ai.js.
// Wraps fetch to Anthropic's Messages API with AbortController timeout.

const MODEL = 'claude-sonnet-4-6'

export { MODEL }

export async function callClaude(messages, maxTokens, useWebSearch, extraTools, modelOverride, opts = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured on server.')

  const body = {
    model: modelOverride || MODEL,
    max_tokens: maxTokens,
    messages,
  }
  const tools = []
  if (useWebSearch) {
    // max_uses caps how many search queries the model can issue in one turn.
    // Every search adds 3-6s of wall-clock, so a low ceiling keeps latency
    // predictable for callers that only need one-shot lookup (hole-design,
    // geocode). Callers can override via opts.webSearchMaxUses.
    const searchTool = { type: 'web_search_20250305', name: 'web_search' }
    if (opts.webSearchMaxUses != null) searchTool.max_uses = opts.webSearchMaxUses
    tools.push(searchTool)
  }
  if (Array.isArray(extraTools) && extraTools.length) tools.push(...extraTools)
  if (tools.length) body.tools = tools

  // Hard wall-clock cap. Anthropic requests with web_search can occasionally
  // hang on a slow search backend; without a fetch-level abort the caller
  // just waits for the platform's own timeout. Default 45s; callers who need
  // longer (large PDFs) pass their own.
  const controller = new AbortController()
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 45000
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let res
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (e) {
    clearTimeout(timer)
    if (e?.name === 'AbortError') throw new Error(`Anthropic timeout after ${timeoutMs}ms`)
    throw e
  }
  clearTimeout(timer)

  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error(`Anthropic ${res.status}: ${err}`)
  }

  const data = await res.json()
  let text = ''
  for (const block of (data.content || [])) {
    if (block.type === 'text') text += block.text
  }
  return text
}
