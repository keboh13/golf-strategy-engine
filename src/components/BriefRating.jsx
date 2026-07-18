import { useState } from 'react'
import { C, F, btnG } from '../theme.js'
import { saveRecQuality } from '../lib/supabase.js'

// In-flow rating widget shown immediately after the brief renders. Two-tap
// affordance: thumbs up / down, plus an optional "what was off" field that
// only appears after a down vote (per the audit ask — capture the reason at
// the moment, not later). Persists via saveRecQuality with dimension:'quick'
// so the History star ratings (dimension:'overall') stay independent.

export default function BriefRating({ user, recLogId }) {
  const [choice, setChoice]   = useState(null)   // 1 (down) | 5 (up) | null
  const [saving, setSaving]   = useState(false)
  const [saved,  setSaved]    = useState(false)
  const [error,  setError]    = useState('')
  const [notes,  setNotes]    = useState('')
  const [notesSaving, setNotesSaving] = useState(false)
  const [notesSaved,  setNotesSaved]  = useState(false)

  if (!user || !recLogId) return null

  async function pick(value) {
    if (saving) return
    setChoice(value); setSaving(true); setSaved(false); setError('')
    try {
      await saveRecQuality(recLogId, user.id, value, 'quick', null)
      setSaved(true)
    } catch (e) {
      setError(e.message || 'Save failed')
      setChoice(null)
    } finally {
      setSaving(false)
    }
  }

  async function submitNotes() {
    if (!notes.trim() || notesSaving) return
    setNotesSaving(true); setNotesSaved(false)
    try {
      await saveRecQuality(recLogId, user.id, choice || 3, 'quick', notes.trim())
      setNotesSaved(true)
    } catch (e) {
      setError(e.message || 'Save failed')
    } finally {
      setNotesSaving(false)
    }
  }

  const chip = (value, label, activeBg) => {
    const active = choice === value
    return (
      <button
        key={value}
        onClick={() => pick(value)}
        disabled={saving}
        aria-label={value === 5 ? 'Helpful' : 'Not helpful'}
        aria-pressed={active}
        style={{
          minWidth: 44, height: 36, padding: '0 12px', borderRadius: 8,
          border: `1px solid ${active ? activeBg : C.border}`,
          background: active ? activeBg : C.bgInput,
          color: active ? '#fff' : C.text,
          fontSize: 14, fontWeight: 600, fontFamily: F,
          cursor: saving ? 'default' : 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: 6,
          transition: 'all 0.15s',
        }}
      >{label}</button>
    )
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 8,
      padding: '10px 14px', borderRadius: 8,
      background: C.bgInput, border: `1px solid ${C.border}`,
      marginBottom: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: C.textMuted, fontWeight: 500 }}>
          {saved ? 'Thanks — logged.' : 'How useful was this brief?'}
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          {chip(5, '👍 Helpful',  C.green)}
          {chip(1, '👎 Off',      C.red)}
        </div>
      </div>
      {choice === 1 && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            value={notes}
            onChange={e => { setNotes(e.target.value); setNotesSaved(false) }}
            placeholder="What was off? (aim points, distances, weather…)"
            aria-label="What was off"
            disabled={notesSaving}
            style={{
              flex: 1, minWidth: 240, height: 32, borderRadius: 6,
              border: `1px solid ${C.border}`, background: C.bg,
              padding: '0 10px', color: C.text, fontSize: 12, fontFamily: F,
            }}
            onKeyDown={e => { if (e.key === 'Enter') submitNotes() }}
          />
          <button
            style={{ ...btnG, height: 32, padding: '0 12px', fontSize: 12 }}
            disabled={!notes.trim() || notesSaving}
            onClick={submitNotes}
          >{notesSaved ? '✓ Sent' : notesSaving ? 'Saving…' : 'Send'}</button>
        </div>
      )}
      {error && <span style={{ fontSize: 11, color: C.red }}>{error}</span>}
    </div>
  )
}
