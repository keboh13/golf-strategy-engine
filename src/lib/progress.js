// Helpers for the shared <ProgressTracker> UI. Kept pure so they can be
// unit-tested without a DOM env. The component layer (React, intervals,
// formatting elapsed time on a ticking clock) lives in ProgressTracker.jsx.

// Step states drive the visual treatment of each row:
//   pending  → grey dot + label
//   running  → spinner + elapsed time + expected band
//   done     → ✓ + final duration
//   skipped  → "—" dim row (e.g. opt-in step the user did not enable)
//   error    → red label + message
export const STEP_STATES = Object.freeze({
  PENDING: 'pending',
  RUNNING: 'running',
  DONE:    'done',
  SKIPPED: 'skipped',
  ERROR:   'error',
})

// Render an elapsed millisecond count as a compact human string.
//   < 1s   → ''           (hide — Part 0.3: only show after 1s)
//   <1min  → '3.4s'
//   ≥1min  → '1m 12s'
export function formatElapsed(ms) {
  if (ms == null || ms < 1000) return ''
  if (ms < 60_000) {
    const s = ms / 1000
    // Whole seconds for ≥10s, one decimal under 10s — keeps the value calm but
    // honest while a fast step is still running.
    return s >= 10 ? `${Math.round(s)}s` : `${s.toFixed(1)}s`
  }
  const m = Math.floor(ms / 60_000)
  const s = Math.round((ms % 60_000) / 1000)
  return s === 0 ? `${m}m` : `${m}m ${s}s`
}

// Render the "~ 8s typically" hint shown next to a running step.
// Returns '' when no expectation is known so the UI stays quiet rather than
// inventing numbers.
export function formatExpected(expectedMs) {
  if (expectedMs == null || expectedMs <= 0) return ''
  if (expectedMs < 1000) return '~ <1s'
  if (expectedMs < 60_000) return `~ ${Math.round(expectedMs / 1000)}s typically`
  const m = Math.round(expectedMs / 60_000)
  return `~ ${m}m typically`
}

// Decide whether to switch the running-step label to the "taking longer than
// usual" copy. Trips when elapsed has crossed the p90 band (or 2× expected
// when only a single number is known) — Part 0.3 honest-progress rule.
export function isOverdue({ elapsedMs, expectedMs, p90Ms }) {
  if (elapsedMs == null) return false
  if (p90Ms != null && p90Ms > 0) return elapsedMs > p90Ms
  if (expectedMs != null && expectedMs > 0) return elapsedMs > expectedMs * 2
  return false
}

// Summarize phase durations from a finished run so the server can persist them
// to rec_log.phase_durations. Strips any in-flight (running/pending) entries
// because partial timings would confuse the telemetry view.
//   steps:    [{ id, label, expectedMs }]
//   startsAt: { [id]: epochMs } when each step began
//   endsAt:   { [id]: epochMs } when each step ended
// Returns: { [id]: durationMs } for every step that has both timestamps.
export function summarizeDurations(steps, startsAt, endsAt) {
  const out = {}
  for (const s of steps || []) {
    const start = startsAt?.[s.id]
    const end = endsAt?.[s.id]
    if (typeof start === 'number' && typeof end === 'number' && end >= start) {
      out[s.id] = end - start
    }
  }
  return out
}
