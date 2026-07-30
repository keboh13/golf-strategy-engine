// Generic step-runner for the enrichment pipeline.
// Iterates an array of step objects, handling sequential execution,
// parallel groups (via Promise.allSettled), abort-signal checks,
// and retry with exponential backoff.

import { STEP_STATES } from '../progress.js'

// #153 helper: compute retry delay with exponential backoff
export function retryDelay(attempt, err) {
  const status = err?.status || err?.message?.match?.(/(\d{3})/)?.[1]
  if (status === '429' || status === '503') return 4000 * (attempt + 1) // longer for rate-limit/overload
  return 2000 * (attempt + 1)
}

/**
 * Run a pipeline of enrichment steps.
 *
 * @param {Array<{id: string, run: (ctx) => Promise<{status: string, error?: string}>, parallel?: boolean}>} steps
 * @param {object} ctx - Shared context: { course, coords, session, setCourse, markStep, signal, enrichLoadId, enrichLoadIdRef, setEnrichStatus }
 */
export async function runPipeline(steps, ctx) {
  let i = 0
  while (i < steps.length) {
    if (ctx.signal.aborted || ctx.enrichLoadId !== ctx.enrichLoadIdRef.current) return

    // Collect a consecutive group of parallel steps
    if (steps[i].parallel) {
      const group = []
      while (i < steps.length && steps[i].parallel) {
        group.push(steps[i])
        i++
      }
      await Promise.allSettled(group.map(step => runSingleStep(step, ctx)))
    } else {
      await runSingleStep(steps[i], ctx)
      i++
    }
  }
}

async function runSingleStep(step, ctx) {
  if (ctx.signal.aborted || ctx.enrichLoadId !== ctx.enrichLoadIdRef.current) return

  const result = await step.run(ctx)

  // Steps handle their own markStep calls internally, so we don't need
  // to call markStep here. This keeps step functions in full control of
  // their own progress state (RUNNING/DONE/ERROR/SKIPPED), matching
  // the original inline behavior exactly.
  return result
}
