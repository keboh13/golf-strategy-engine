// Generation phase tokens (Part 0.2 + 0.3 of the optimization plan).
// The recommendation prompt instructs the model to emit `[[PHASE: <id>]]` on
// a line of its own immediately before each top-level section. Both client
// (UI progress) and server (rec_log telemetry) parse the same markers — the
// client also strips them out so the user never sees the markers in the
// rendered brief.

// Ordered list of phase ids. `strategy` is the implicit starting phase: the
// model is in it from message_start until the first PHASE marker arrives.
export const GENERATION_PHASE_IDS = ['strategy', 'roadmap', 'holes', 'finalize']

// Step list consumed by ProgressTracker. expectedMs comes from rough p50s
// observed in dev — they'll be tightened once rec_log.phase_durations has
// real samples to median.
export const GENERATION_STEPS = Object.freeze([
  { id: 'strategy', label: 'Drafting round strategy',  expectedMs: 4000 },
  { id: 'roadmap',  label: 'Scoring roadmap',          expectedMs: 5000 },
  { id: 'holes',    label: 'Hole-by-hole',             expectedMs: 12000 },
  { id: 'finalize', label: 'Finalizing adjustments',   expectedMs: 4000 },
])

// Match a single phase marker. Tolerates spaces around the colon + id and an
// optional trailing newline so the marker line vanishes cleanly when stripped.
const PHASE_MARKER_RE = /\[\[\s*PHASE\s*:\s*([a-zA-Z_-]+)\s*\]\]\s*\n?/g

// Strip every marker from a chunk of streamed text. Pure; safe to call on
// every render of the partial plan.
export function stripPhaseMarkers(text) {
  if (!text) return text
  return text.replace(PHASE_MARKER_RE, '')
}

// Structured green-json fenced block that the model emits inside each Hole
// section. It's parsed out of the finished plan by the extractor, but during
// streaming the closing fence isn't there yet, so the raw JSON leaks into the
// rendered brief. Match both closed and unclosed forms so we can drop them
// from the streaming view.
const GREEN_JSON_CLOSED   = /```green-json\s*\n[\s\S]*?\n```\s*\n?/g
const GREEN_JSON_UNCLOSED = /```green-json\s*\n[\s\S]*$/

// Strip streaming artifacts from a partial (or complete) plan chunk so the
// rendered brief never shows raw JSON or phase markers to the user. Applied
// on every render — must be pure and cheap.
export function stripStreamingArtifacts(text) {
  if (!text) return text
  return stripPhaseMarkers(text)
    .replace(GREEN_JSON_CLOSED, '')
    .replace(GREEN_JSON_UNCLOSED, '')
}

// Find every phase marker present in `text` and return the matched ids in
// order. Used by the client to advance the step machine and by the server to
// timestamp first-appearance of each phase.
export function findPhaseMarkers(text) {
  if (!text) return []
  const out = []
  // Reset regex state so this is safe to call repeatedly.
  PHASE_MARKER_RE.lastIndex = 0
  let m
  while ((m = PHASE_MARKER_RE.exec(text)) !== null) out.push(m[1])
  return out
}

// Given a list of (id, ts) pairs where ts is the wall-clock when each phase
// first appeared, plus a startTs (when streaming began) and endTs (when the
// stream closed), compute per-phase durations as `{ id: durationMs }`. The
// implicit `strategy` phase always covers [start → first marker].
//
//   recordPhaseDurations({
//     startedAt: 1000,
//     endedAt: 30000,
//     markers: [
//       { id: 'roadmap',  ts: 5000 },
//       { id: 'holes',    ts: 10000 },
//       { id: 'finalize', ts: 26000 },
//     ],
//   })
//   → { strategy: 4000, roadmap: 5000, holes: 16000, finalize: 4000 }
export function recordPhaseDurations({ startedAt, endedAt, markers = [] }) {
  if (typeof startedAt !== 'number' || typeof endedAt !== 'number' || endedAt < startedAt) return {}
  const out = {}
  let prevTs = startedAt
  let prevId = 'strategy'
  for (const m of markers) {
    if (!m || typeof m.ts !== 'number' || m.ts < prevTs) continue
    out[prevId] = m.ts - prevTs
    prevTs = m.ts
    prevId = m.id
  }
  // Tail phase runs to the end of the stream.
  out[prevId] = Math.max(0, endedAt - prevTs)
  return out
}
