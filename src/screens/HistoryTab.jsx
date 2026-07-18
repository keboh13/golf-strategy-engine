import { useState } from 'react'
import { C, F, card, inp, lbl, btnP, btnG } from '../theme.js'
import { Badge, SectionHead } from '../components/ui.jsx'
import { deleteSavedPlan, saveRecQuality } from '../lib/supabase.js'

// ── Star rating widget ────────────────────────────────────────────────────────
// Renders 5 stars; hover preview, click to commit. After commit the stars are
// static (re-click to change). Only shown when the brief has a rec_log_id
// (i.e. it was generated after step 13 of the optimisation plan shipped).
function StarRating({ value, onChange, saving }) {
  const [hovered, setHovered] = useState(null)
  const display = hovered ?? value ?? 0
  return (
    <div
      style={{ display: 'flex', gap: 2, alignItems: 'center' }}
      onMouseLeave={() => setHovered(null)}
    >
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          disabled={saving}
          onClick={() => onChange(n)}
          onMouseEnter={() => setHovered(n)}
          aria-label={`Rate ${n} star${n !== 1 ? 's' : ''}`}
          style={{
            background: 'transparent',
            border: 'none',
            padding: '2px 1px',
            cursor: saving ? 'default' : 'pointer',
            fontSize: 18,
            color: n <= display ? '#f59e0b' : C.textFaint,
            lineHeight: 1,
            transition: 'color 0.1s',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          {n <= display ? '★' : '☆'}
        </button>
      ))}
    </div>
  )
}

// ── History tab ───────────────────────────────────────────────────────────────
export default function HistoryTab({
  user,
  savedBriefs,
  setSavedBriefs,
  expandedBrief,
  setExpandedBrief,
  briefNotes,
  setBriefNotes,
  deleteConfirm,
  setDeleteConfirm,
  copied,
  setCopied,
  setTab,
  setPrepStep,
  setPlan,
  renderPlan,
}) {
  // Per-brief rating state: { [rec_log_id]: { value: 1-5, saving: bool, saved: bool, error: '' } }
  const [ratings, setRatings] = useState({})

  async function handleRate(recLogId, stars) {
    if (!user || !recLogId) return
    setRatings(r => ({ ...r, [recLogId]: { ...r[recLogId], value: stars, saving: true, error: '' } }))
    try {
      await saveRecQuality(recLogId, user.id, stars, 'overall')
      setRatings(r => ({ ...r, [recLogId]: { value: stars, saving: false, saved: true, error: '' } }))
    } catch (e) {
      setRatings(r => ({ ...r, [recLogId]: { ...r[recLogId], saving: false, error: e.message || 'Save failed' } }))
    }
  }

  return (
    <div>
      <SectionHead title="History" sub="Your saved round prep reports and notes" />

      {savedBriefs.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', padding: '3rem 2rem' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
          <p style={{ fontSize: 16, color: C.textMuted, margin: '0 0 8px' }}>No saved reports yet</p>
          <p style={{ fontSize: 12, color: C.textFaint, margin: '0 0 20px' }}>Round prep reports are saved automatically when generated.</p>
          <button style={btnP} onClick={() => { setTab('prep'); setPrepStep(1) }}>Start Round Prep →</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {savedBriefs.map((b, i) => {
            const confirmState = deleteConfirm[i]
            const noteKey = b.id || `local-${i}`
            const note = briefNotes[noteKey] ?? (b.notes || '')
            const ratingState = b.rec_log_id ? (ratings[b.rec_log_id] || {}) : null
            return (
              <div key={b.id || i} style={{ ...card, borderColor: expandedBrief === i ? C.accent : C.border }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 15, fontWeight: 600, color: C.text }}>{b.course}</span>
                      {b.tee && <Badge label={b.tee} bg={C.accentMuted} fg={C.accent} />}
                    </div>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12, color: C.textMuted }}>Generated: {b.date || 'Unknown date'}</span>
                      {b.plan && <span style={{ fontSize: 11, color: C.textFaint }}>{(b.plan.match(/###?\s*Hole/gi) || []).length} holes covered</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button style={{ ...btnP, padding: '6px 14px', fontSize: 12 }}
                      onClick={() => setExpandedBrief(expandedBrief === i ? null : i)}>
                      {expandedBrief === i ? 'Collapse' : 'View Report'}
                    </button>
                    {/* Multi-step delete */}
                    {!confirmState ? (
                      <button style={{ ...btnG, color: C.red, borderColor: C.red, padding: '6px 14px', fontSize: 12 }}
                        onClick={() => setDeleteConfirm(prev => ({ ...prev, [i]: 'first' }))}>
                        Delete
                      </button>
                    ) : confirmState === 'first' ? (
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        <span style={{ fontSize: 11, color: C.red, fontWeight: 600 }}>Are you sure?</span>
                        <button style={{ ...btnG, color: C.red, borderColor: C.red, padding: '4px 10px', fontSize: 11 }}
                          onClick={() => setDeleteConfirm(prev => ({ ...prev, [i]: 'final' }))}>
                          Yes, delete
                        </button>
                        <button style={{ ...btnG, padding: '4px 10px', fontSize: 11 }}
                          onClick={() => setDeleteConfirm(prev => { const n = { ...prev }; delete n[i]; return n })}>
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        <span style={{ fontSize: 11, color: C.red, fontWeight: 600 }}>This cannot be undone!</span>
                        <button style={{ background: C.red, color: '#fff', border: 'none', borderRadius: 6, padding: '4px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: F }}
                          onClick={() => {
                            setSavedBriefs(prev => prev.filter((_, j) => j !== i))
                            if (b.id && user) deleteSavedPlan(b.id).catch(() => {})
                            try { const ls = JSON.parse(localStorage.getItem('golf_saved_briefs') || '[]'); ls.splice(i, 1); localStorage.setItem('golf_saved_briefs', JSON.stringify(ls)) } catch {}
                            setDeleteConfirm(prev => { const n = { ...prev }; delete n[i]; return n })
                          }}>
                          Permanently delete
                        </button>
                        <button style={{ ...btnG, padding: '4px 10px', fontSize: 11 }}
                          onClick={() => setDeleteConfirm(prev => { const n = { ...prev }; delete n[i]; return n })}>
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Expanded report view */}
                {expandedBrief === i && b.plan && (
                  <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 12, marginBottom: 12 }}>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                      <button style={btnG} onClick={() => { navigator.clipboard.writeText(b.plan); setCopied(true); setTimeout(() => setCopied(false), 2000) }}>{copied ? '✓ Copied' : 'Copy text'}</button>
                      <button style={btnG} onClick={() => { setPlan(b.plan); setTab('prep'); setPrepStep(4) }}>Open in Prep →</button>
                    </div>
                    <div style={{ background: C.bgInput, borderRadius: 10, padding: '16px 20px', maxHeight: 500, overflowY: 'auto' }}>
                      {renderPlan(b.plan)}
                    </div>
                  </div>
                )}

                {/* ── Rating ───────────────────────────────────────────── */}
                {ratingState !== null && (
                  <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 10, marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12, color: C.textMuted, fontWeight: 500 }}>Rate this brief</span>
                      <StarRating
                        value={ratingState.value ?? null}
                        onChange={stars => handleRate(b.rec_log_id, stars)}
                        saving={ratingState.saving}
                      />
                      {ratingState.saving && (
                        <span style={{ fontSize: 11, color: C.textFaint }}>Saving…</span>
                      )}
                      {ratingState.saved && !ratingState.saving && (
                        <span style={{ fontSize: 11, color: C.green }}>✓ Saved</span>
                      )}
                      {ratingState.error && (
                        <span style={{ fontSize: 11, color: C.red }}>{ratingState.error}</span>
                      )}
                    </div>
                    {!ratingState.value && !ratingState.saving && (
                      <p style={{ fontSize: 10, color: C.textFaint, margin: '4px 0 0' }}>
                        Helps improve future recommendations for this course.
                      </p>
                    )}
                  </div>
                )}

                {/* Post-round capture — per-hole score + one-line "what went wrong".
                    This feeds getLatestPostRoundForCourse → prompt so the next
                    brief for this course can reference the miss concretely. */}
                <PostRoundEditor
                  brief={b}
                  index={i}
                  setSavedBriefs={setSavedBriefs}
                />

                {/* Freeform notes for AI refinement (legacy field — still surfaced) */}
                <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 10, marginTop: 10 }}>
                  <label style={{ ...lbl, marginBottom: 6 }}>Notes for AI refinement</label>
                  <textarea
                    style={{ ...inp, height: 48, resize: 'vertical', fontSize: 12 }}
                    value={note}
                    onChange={e => {
                      const val = e.target.value
                      setBriefNotes(prev => ({ ...prev, [noteKey]: val }))
                    }}
                    onBlur={() => {
                      setSavedBriefs(prev => prev.map((bb, j) => j === i ? { ...bb, notes: note } : bb))
                      try { const ls = JSON.parse(localStorage.getItem('golf_saved_briefs') || '[]'); if (ls[i]) { ls[i].notes = note; localStorage.setItem('golf_saved_briefs', JSON.stringify(ls)) } } catch {}
                    }}
                    placeholder="e.g. Strategy on hole 7 was wrong — there's water short left. The wind was stronger than forecasted. Club suggestions were one club too long..."
                  />
                  <p style={{ fontSize: 10, color: C.textFaint, margin: '4px 0 0' }}>
                    These notes help refine future recommendations for this course.
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Structured per-hole capture. 18 tiny score inputs + optional one-line
// "what went wrong" per hole, plus a general-notes field. Persisted to
// savedBriefs[index].postRound so getLatestPostRoundForCourse can find it
// on the next Round Prep for the same course.
function PostRoundEditor({ brief, index, setSavedBriefs }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(() => ({
    scores: brief.postRound?.scores || {},
    notes:  brief.postRound?.notes  || {},
    generalNotes: brief.postRound?.generalNotes || '',
  }))
  const holesLogged = Object.keys(draft.scores).filter(k => Number.isFinite(draft.scores[k])).length
  const notesLogged = Object.values(draft.notes).filter(Boolean).length

  function persist(next) {
    setDraft(next)
    setSavedBriefs(prev => prev.map((bb, j) => j === index ? { ...bb, postRound: next } : bb))
    try {
      const ls = JSON.parse(localStorage.getItem('golf_saved_briefs') || '[]')
      if (ls[index]) { ls[index].postRound = next; localStorage.setItem('golf_saved_briefs', JSON.stringify(ls)) }
    } catch {}
  }

  return (
    <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 6, fontFamily: F, color: C.text,
        }}
      >
        <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: C.textMuted }}>
          Post-round
        </span>
        {(holesLogged > 0 || notesLogged > 0) && (
          <Badge label={`${holesLogged}/18 · ${notesLogged} note${notesLogged === 1 ? '' : 's'}`} bg={C.accentMuted} fg={C.accent} />
        )}
        <span style={{ fontSize: 12, color: C.textMuted }}>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div style={{ marginTop: 10 }}>
          <p style={{ fontSize: 11, color: C.textFaint, margin: '0 0 8px' }}>
            Log actual scores per hole and what went wrong. The next brief for {brief.course} will reference these directly.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
            {Array.from({ length: 18 }, (_, k) => k + 1).map(n => (
              <div key={n} style={{ background: C.bgInput, borderRadius: 6, padding: '6px 8px', border: `1px solid ${C.border}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, color: C.textMuted, minWidth: 22, fontWeight: 600 }}>H{n}</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    aria-label={`Hole ${n} score`}
                    value={Number.isFinite(draft.scores[n]) ? draft.scores[n] : ''}
                    onChange={e => {
                      const v = e.target.value === '' ? undefined : parseInt(e.target.value, 10)
                      const scores = { ...draft.scores }
                      if (Number.isFinite(v)) scores[n] = v
                      else delete scores[n]
                      persist({ ...draft, scores })
                    }}
                    style={{ width: 42, height: 24, background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: 4, padding: '0 4px', fontSize: 12, fontFamily: F, textAlign: 'center' }}
                  />
                </div>
                <input
                  aria-label={`Hole ${n} note`}
                  value={draft.notes[n] || ''}
                  onChange={e => {
                    const notes = { ...draft.notes }
                    if (e.target.value) notes[n] = e.target.value
                    else delete notes[n]
                    persist({ ...draft, notes })
                  }}
                  placeholder="what went wrong…"
                  style={{ width: '100%', boxSizing: 'border-box', marginTop: 4, height: 22, background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: 4, padding: '0 6px', fontSize: 11, fontFamily: F }}
                />
              </div>
            ))}
          </div>
          <label style={{ ...lbl, marginTop: 10, marginBottom: 4, display: 'block' }}>General round notes</label>
          <textarea
            style={{ ...inp, height: 40, resize: 'vertical', fontSize: 12 }}
            value={draft.generalNotes}
            onChange={e => persist({ ...draft, generalNotes: e.target.value })}
            placeholder="Overall — wind was stronger than forecast; putts felt fast."
          />
        </div>
      )}
    </div>
  )
}
