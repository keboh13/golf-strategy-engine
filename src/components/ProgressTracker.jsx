import { useEffect, useState } from 'react'
import { C, F, btnG } from '../theme.js'
import { Spin } from './ui.jsx'
import { STEP_STATES, formatElapsed, formatExpected, isOverdue } from '../lib/progress.js'

// Shared progress display per Part 0.3 of the optimization plan. Three rules:
//   1. Never a bare spinner — every step has a plain-English label.
//   2. Show elapsed time + an expected band once a step has been running > 1s.
//   3. The cancel button is always reachable when one is provided.
//
// The component is presentational: callers own the state machine (which step is
// running, when each started/ended). progress.js holds the pure helpers.
//
// Props:
//   steps:    [{ id, label, expectedMs?, p90Ms? }]
//   states:   { [id]: 'pending' | 'running' | 'done' | 'skipped' | 'error' }
//   startsAt: { [id]: epochMs }  — when each step began (used for live timer)
//   endsAt:   { [id]: epochMs }  — when each step finished (final duration)
//   errors:   { [id]: string }   — optional per-step error copy
//   onCancel: () => void         — omit to hide cancel
//   cancelLabel: string          — defaults to "Cancel"
//   compact: boolean             — inline horizontal row (for tight UI strips)
export default function ProgressTracker({
  steps = [],
  states = {},
  startsAt = {},
  endsAt = {},
  errors = {},
  onCancel,
  cancelLabel = 'Cancel',
  compact = false,
}) {
  // Tick once a second so running steps' elapsed time advances. Stops when
  // nothing is running so we don't burn CPU on an idle panel.
  const anyRunning = Object.values(states).some(s => s === STEP_STATES.RUNNING)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!anyRunning) return
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [anyRunning])

  if (!steps.length) return null

  return (
    <div role="status" aria-live="polite" style={{
      background: C.bgInput, border: `1px solid ${C.border}`, borderRadius: 10,
      padding: compact ? '8px 12px' : '12px 14px', fontFamily: F,
    }}>
      <div style={{
        display: 'flex',
        flexDirection: compact ? 'row' : 'column',
        gap: compact ? 12 : 6,
        flexWrap: compact ? 'wrap' : 'nowrap',
      }}>
        {steps.map(s => (
          <StepRow
            key={s.id}
            step={s}
            state={states[s.id] || STEP_STATES.PENDING}
            startedAt={startsAt[s.id]}
            endedAt={endsAt[s.id]}
            errorMsg={errors[s.id]}
            now={now}
            compact={compact}
          />
        ))}
      </div>
      {onCancel && anyRunning && (
        <div style={{ marginTop: compact ? 8 : 10, display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onCancel}
            style={{ ...btnG, padding: '4px 12px', fontSize: 11, minHeight: 32 }}
            aria-label={cancelLabel}
          >
            {cancelLabel}
          </button>
        </div>
      )}
    </div>
  )
}

function StepRow({ step, state, startedAt, endedAt, errorMsg, now, compact }) {
  const isRunning = state === STEP_STATES.RUNNING
  const isDone    = state === STEP_STATES.DONE
  const isErr     = state === STEP_STATES.ERROR
  const isSkip    = state === STEP_STATES.SKIPPED

  // Elapsed: live for running steps, fixed for finished ones.
  let elapsedMs = null
  if (isRunning && typeof startedAt === 'number') elapsedMs = now - startedAt
  else if ((isDone || isErr) && typeof startedAt === 'number' && typeof endedAt === 'number') {
    elapsedMs = endedAt - startedAt
  }

  const overdue = isRunning && isOverdue({ elapsedMs, expectedMs: step.expectedMs, p90Ms: step.p90Ms })
  const elapsedStr = formatElapsed(elapsedMs)
  const expectedStr = isRunning && !overdue ? formatExpected(step.expectedMs) : ''

  const labelColor =
    isErr  ? C.red :
    isSkip ? C.textFaint :
    isDone ? C.textMuted :
    isRunning ? C.text : C.textMuted

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      minWidth: compact ? 0 : undefined, flex: compact ? '1 1 auto' : 'unset',
      opacity: isSkip ? 0.5 : 1,
    }}>
      <Glyph state={state} />
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: isRunning ? 600 : 500, color: labelColor }}>
            {step.label}
          </span>
          {elapsedStr && (
            <span style={{ fontSize: 11, color: overdue ? C.amber : C.textFaint, fontVariantNumeric: 'tabular-nums' }}>
              {elapsedStr}
            </span>
          )}
          {expectedStr && (
            <span style={{ fontSize: 11, color: C.textFaint }}>· {expectedStr}</span>
          )}
          {overdue && (
            <span style={{ fontSize: 11, color: C.amber }}>· taking longer than usual</span>
          )}
          {isSkip && (
            <span style={{ fontSize: 11, color: C.textFaint }}>· skipped</span>
          )}
        </div>
        {isErr && errorMsg && (
          <span style={{ fontSize: 11, color: C.red, marginTop: 2 }}>{errorMsg}</span>
        )}
      </div>
    </div>
  )
}

function Glyph({ state }) {
  if (state === STEP_STATES.RUNNING) return <Spin />
  const common = { width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 11, fontWeight: 700, borderRadius: '50%' }
  if (state === STEP_STATES.DONE) {
    return <span aria-hidden style={{ ...common, background: C.greenMuted, color: C.green }}>✓</span>
  }
  if (state === STEP_STATES.ERROR) {
    return <span aria-hidden style={{ ...common, background: C.redMuted, color: C.red }}>!</span>
  }
  if (state === STEP_STATES.SKIPPED) {
    return <span aria-hidden style={{ ...common, color: C.textFaint }}>—</span>
  }
  // pending
  return <span aria-hidden style={{ ...common, border: `1px solid ${C.border}`, background: 'transparent' }} />
}
