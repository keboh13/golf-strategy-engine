import { C, F, card, inp, lbl, btnP, btnG } from '../theme.js'
import { Badge, SectionHead } from '../components/ui.jsx'
import { deleteSavedPlan } from '../lib/supabase.js'

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

                {/* Notes for refining AI */}
                <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
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
