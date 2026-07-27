import { useState, useRef, useCallback } from 'react'
import { GENERATION_PHASE_IDS, stripPhaseMarkers, findPhaseMarkers } from './generationPhases.js'
import { STEP_STATES } from './progress.js'
import { validatePlanContract } from './recommendation/planContract.js'
import { planCacheKey, getCachedPlan, putCachedPlan } from './planCache.js'
import { todayLocalIso } from './localDate.js'
import { savePlan } from './supabase.js'

const EMPTY_PROGRESS = { states: {}, startsAt: {}, endsAt: {}, errors: {} }

export function useGeneration({ session, buildPrompt, selectedModel, planStyle, course, user, setSavedBriefs, setTab, setPrepStep }) {
  const [plan, setPlan] = useState('')
  const [planLoading, setPlanLoading] = useState(false)
  const [planPhase, setPlanPhase] = useState('')
  const [planError, setPlanError] = useState('')
  const [planValidationBanner, setPlanValidationBanner] = useState('')
  const [genProgress, setGenProgress] = useState(EMPTY_PROGRESS)
  const [lastRecLogId, setLastRecLogId] = useState(null)
  const abortRef = useRef(null)

  const cancelGenerate = useCallback(() => {
    if (abortRef.current) { abortRef.current.abort(); abortRef.current = null }
    setPlanLoading(false); setPlanPhase('')
  }, [])

  const generate = useCallback(async (options = {}) => {
    const { bypassCache = false } = options
    const authToken = session?.access_token || ''
    if (!authToken) { setPlanError('Please sign in to generate a game plan.'); return }
    if (abortRef.current) abortRef.current.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setPlanLoading(true); setPlanPhase('Analyzing scoring history'); setPlanError(''); setPlanValidationBanner(''); setPlan(''); setLastRecLogId(null); setTab('prep'); setPrepStep(4)
    let capturedRecLogId = null
    const genStartedAt = Date.now()
    const seenPhases = new Set()
    setGenProgress({
      states:   { strategy: STEP_STATES.RUNNING },
      startsAt: { strategy: genStartedAt },
      endsAt:   {},
      errors:   {},
    })
    const advancePhase = (id, ts) => {
      if (seenPhases.has(id)) return
      seenPhases.add(id)
      const ids = GENERATION_PHASE_IDS
      const idx = ids.indexOf(id)
      if (idx < 1) return
      const prev = ids[idx - 1]
      setGenProgress(p => ({
        ...p,
        states:   { ...p.states, [prev]: STEP_STATES.DONE, [id]: STEP_STATES.RUNNING },
        startsAt: { ...p.startsAt, [id]: ts },
        endsAt:   { ...p.endsAt, [prev]: ts },
      }))
    }

    const promptText = buildPrompt()
    let cKey = null
    try { cKey = await planCacheKey({ prompt: promptText, model: selectedModel, style: planStyle }) } catch {}
    if (!bypassCache && cKey) {
      const hit = getCachedPlan(cKey)
      if (hit?.plan) {
        setPlan(hit.plan)
        setPlanLoading(false)
        abortRef.current = null
        const endTs = Date.now()
        setGenProgress({
          states: Object.fromEntries(GENERATION_PHASE_IDS.map(id => [id, STEP_STATES.DONE])),
          startsAt: Object.fromEntries(GENERATION_PHASE_IDS.map(id => [id, genStartedAt])),
          endsAt: Object.fromEntries(GENERATION_PHASE_IDS.map(id => [id, endTs])),
          errors: {},
        })
        if (course.name) {
          const v = validatePlanContract(hit.plan)
          setPlanValidationBanner(v.ok ? '' : (v.banner || 'Plan validation failed.'))
        }
        const entry = { course: course.name || 'Profile brief', date: todayLocalIso(), plan: hit.plan, tee: course.selectedTee || '', rec_log_id: null, cached: true }
        setSavedBriefs(prev => {
          const updated = [entry, ...prev].slice(0, 10)
          try { localStorage.setItem('golf_saved_briefs', JSON.stringify(updated)) } catch {}
          return updated
        })
        return
      }
    }

    const payload = {
      model: selectedModel,
      max_tokens: 16000,
      stream: true,
      messages: [{
        role: 'user',
        content: [{ type: 'text', text: promptText, cache_control: { type: 'ephemeral' } }],
      }],
    }
    // #147: secondary auto-timeout (180s) that races against the user abort
    const autoTimeoutCtrl = new AbortController()
    const autoTimer = setTimeout(() => autoTimeoutCtrl.abort(), 180_000)
    // Link: if either user or auto-timeout fires, cancel both
    const onUserAbort = () => { clearTimeout(autoTimer); autoTimeoutCtrl.abort() }
    const onAutoAbort = () => ctrl.abort()
    ctrl.signal.addEventListener('abort', onUserAbort, { once: true })
    autoTimeoutCtrl.signal.addEventListener('abort', onAutoAbort, { once: true })

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      })
      if (!res.ok) {
        const errText = await res.text()
        let errMsg = `API ${res.status}: ${errText}`
        try { const j = JSON.parse(errText); if (j.error) errMsg = j.error } catch {}
        throw new Error(errMsg)
      }
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      // #148: stall detection — abort if 45s pass with no data from reader.read()
      let stallTimer = null
      const resetStallTimer = () => {
        if (stallTimer) clearTimeout(stallTimer)
        stallTimer = setTimeout(() => {
          ctrl.abort()
          setPlanError('Stream stalled — no data received for 45 seconds.')
        }, 45_000)
      }
      resetStallTimer()
      while (true) {
        const { done, value } = await reader.read()
        resetStallTimer()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n'); buf = lines.pop()
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const d = line.slice(6).trim()
          if (d === '[DONE]') continue
          try {
            const j = JSON.parse(d)
            if (j.type === 'content_block_delta' && j.delta?.text) {
              setPlan(p => {
                const next = p + j.delta.text
                const ts = Date.now()
                for (const id of findPhaseMarkers(next)) advancePhase(id, ts)
                return stripPhaseMarkers(next)
              })
            }
            if (j.type === 'metadata' && j.rec_log_id) {
              capturedRecLogId = j.rec_log_id
              setLastRecLogId(j.rec_log_id)
            }
          } catch {}
        }
      }
      if (stallTimer) clearTimeout(stallTimer)
    } catch (e) {
      clearTimeout(autoTimer)
      if (e.name === 'AbortError') {
        // Distinguish auto-timeout from user cancel
        if (autoTimeoutCtrl.signal.aborted && !ctrl.signal.aborted) {
          setPlanError('Generation timed out after 180 seconds.')
        }
        return
      }
      setPlanError(e.message)
    }
    clearTimeout(autoTimer)
    setPlanLoading(false)
    abortRef.current = null
    setGenProgress(p => {
      const endTs = Date.now()
      const states = { ...p.states }
      const endsAt = { ...p.endsAt }
      for (const id of GENERATION_PHASE_IDS) {
        if (states[id] === STEP_STATES.RUNNING) states[id] = STEP_STATES.DONE
        if (states[id] === STEP_STATES.DONE && endsAt[id] == null) endsAt[id] = endTs
      }
      return { ...p, states, endsAt }
    })
    setPlan(p => {
      if (p) {
        let contractOk = true
        if (course.name) {
          const v = validatePlanContract(p)
          contractOk = v.ok
          setPlanValidationBanner(v.ok ? '' : (v.banner || 'Plan validation failed.'))
        }
        if (cKey && contractOk) {
          try { putCachedPlan(cKey, p) } catch {}
        }
        const entry = { course: course.name || 'Profile brief', date: todayLocalIso(), plan: p, tee: course.selectedTee || '', rec_log_id: capturedRecLogId || null }
        setSavedBriefs(prev => {
          const updated = [entry, ...prev].slice(0, 10)
          try { localStorage.setItem('golf_saved_briefs', JSON.stringify(updated)) } catch {}
          return updated
        })
        if (user) {
          savePlan(user.id, entry.course, p, entry.tee).catch(e => console.warn('[supabase] plan save:', e.message))
        }
      }
      return p
    })
  }, [session, buildPrompt, selectedModel, planStyle, course, user, setSavedBriefs, setTab, setPrepStep])

  return {
    plan, setPlan,
    planLoading, planPhase, planError,
    planValidationBanner,
    genProgress,
    lastRecLogId,
    generate, cancelGenerate,
  }
}
