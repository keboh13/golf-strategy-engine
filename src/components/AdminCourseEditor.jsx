import { useState, useMemo } from 'react'
import { C, card, inp, lbl, btnP, btnG } from '../theme.js'
import { adminUpdateMetadata, adminRenameCourse, adminReparsePdf } from '../lib/courseApi.js'

// Modal editor for course metadata. Mounts over the admin tab; closes on
// Cancel or after a successful save. All edits go through the server, which
// gates on the admins table and bumps edit_version so every client lazily
// refreshes its localStorage cache.
//
// Props:
//   course       — full cached course object (must include _cacheKey)
//   authToken    — session access_token
//   onClose()    — called on cancel
//   onSaved(res) — called after a successful save/rename with the server response
export default function AdminCourseEditor({ course, authToken, onClose, onSaved }) {
  const oldKey = course._cacheKey

  const [draft, setDraft] = useState(() => ({
    name: course.name || '',
    location: course.location || '',
    yardage: course.yardage || '',
    rating: course.rating || '',
    slope: course.slope || '',
    par: course.par || '',
    selectedTee: course.selectedTee || '',
    architect: course.architect || '',
    greensType: course.greensType || '',
    region: course.region || '',
    defaultConditions: course.defaultConditions || '',
    tags: Array.isArray(course.tags) ? course.tags.join(', ') : (course.tags || ''),
    notes: course.notes || '',
  }))

  const [holes, setHoles] = useState(() => {
    const src = Array.isArray(course.holes) ? course.holes : []
    const arr = []
    for (let i = 0; i < 18; i++) {
      const h = src[i] || {}
      arr.push({
        par: h.par || 4,
        yardage: h.yardage || '',
        handicap: h.handicap || i + 1,
        elevation: h.elevation || '',
        notes: h.notes || '',
        hzDesign: h.hzDesign || null,
      })
    }
    return arr
  })

  const [tees, setTees] = useState(() => Array.isArray(course.tees) ? [...course.tees] : [])
  const [hazardOpen, setHazardOpen] = useState(null) // hole index when open
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [reparse, setReparse] = useState(null) // { diff, parsed } when re-parse run

  const nameChanged = draft.name.trim().toLowerCase() !== (course.name || '').trim().toLowerCase()
  const locationChanged = draft.location.trim().toLowerCase() !== (course.location || '').trim().toLowerCase()
  const isRename = nameChanged || locationChanged

  // ── Validation mirrors api/course-ai.js validateScorecardJson ─────────────
  const validationIssues = useMemo(() => {
    const issues = []
    const parTotal = holes.reduce((s, h) => s + (parseInt(h.par) || 0), 0)
    if (parTotal < 68 || parTotal > 74) issues.push(`par total ${parTotal} outside 68–74`)
    const yardTotal = holes.reduce((s, h) => s + (parseInt(h.yardage) || 0), 0)
    if (yardTotal && (yardTotal < 4500 || yardTotal > 8200)) issues.push(`yardage total ${yardTotal} outside 4500–8200`)
    for (let i = 0; i < holes.length; i++) {
      const y = parseInt(holes[i].yardage) || 0
      if (y && (y < 80 || y > 700)) { issues.push(`hole ${i + 1} yardage ${y} outside 80–700`); break }
    }
    if (!draft.name.trim()) issues.push('course name is required')
    return issues
  }, [holes, draft.name])

  function updateHole(i, patch) {
    setHoles(prev => prev.map((h, idx) => idx === i ? { ...h, ...patch } : h))
  }

  function updateHazard(i, patch) {
    setHoles(prev => prev.map((h, idx) => {
      if (idx !== i) return h
      const hz = { ...(h.hzDesign || { hole: i + 1, dogleg: 'straight', hazards: [], green_notes: '', recommended_line: '' }), ...patch }
      hz.hole = i + 1
      return { ...h, hzDesign: hz }
    }))
  }

  function addHazardItem(i) {
    const cur = holes[i].hzDesign?.hazards || []
    updateHazard(i, { hazards: [...cur, { type: 'bunker', side: 'R', carry_yards: null, notes: '' }] })
  }

  function updateHazardItem(i, j, patch) {
    const cur = holes[i].hzDesign?.hazards || []
    const next = cur.map((x, idx) => idx === j ? { ...x, ...patch } : x)
    updateHazard(i, { hazards: next })
  }

  function removeHazardItem(i, j) {
    const cur = holes[i].hzDesign?.hazards || []
    updateHazard(i, { hazards: cur.filter((_, idx) => idx !== j) })
  }

  function updateTee(i, patch) {
    setTees(prev => prev.map((t, idx) => idx === i ? { ...t, ...patch } : t))
  }

  function addTee() {
    setTees(prev => [...prev, { name: '', yardage: '', rating: '', slope: '', par: '' }])
  }

  function removeTee(i) {
    setTees(prev => prev.filter((_, idx) => idx !== i))
  }

  function buildPatch() {
    const tagList = String(draft.tags || '')
      .split(',').map(s => s.trim()).filter(Boolean)
    return {
      // course-level
      yardage: draft.yardage,
      rating: draft.rating,
      slope: draft.slope,
      par: parseInt(draft.par) || holes.reduce((s, h) => s + (parseInt(h.par) || 0), 0),
      selectedTee: draft.selectedTee,
      architect: draft.architect || null,
      greensType: draft.greensType || null,
      region: draft.region || null,
      defaultConditions: draft.defaultConditions || null,
      tags: tagList,
      notes: draft.notes,
      tees,
      // per-hole (par/yardage/handicap/elevation/notes go into course_data;
      // hzDesign is also persisted into course_data.holes for fast reads, and
      // additionally upserted into course_hole_hazards by the server)
      holes: holes.map((h, i) => ({
        par: parseInt(h.par) || 4,
        yardage: h.yardage,
        handicap: parseInt(h.handicap) || i + 1,
        elevation: h.elevation,
        notes: h.notes,
        hzDesign: h.hzDesign || null,
      })),
    }
  }

  async function handleSave() {
    if (validationIssues.length) { setMsg(`Fix validation issues first: ${validationIssues[0]}`); return }
    setBusy(true); setMsg('')
    try {
      const patch = buildPatch()
      const hazardsByHole = holes
        .map((h, i) => h.hzDesign ? { ...h.hzDesign, hole: i + 1 } : null)
        .filter(Boolean)

      let result
      if (isRename) {
        const confirmed = window.confirm(
          `Rename will migrate this course across:\n` +
          `  • course_cache row\n` +
          `  • course_hole_hazards (all 18 holes)\n` +
          `  • course_geo geometry\n` +
          `  • course_hole_contrib user-tee/pin contributions\n` +
          `  • PDF storage objects under coursepdfs/<key>/\n` +
          `An alias row will be added so old-name searches still resolve.\n\n` +
          `Old key: ${oldKey}\n` +
          `New key: ${draft.name.toLowerCase().trim()}|${draft.location.toLowerCase().trim()}\n\n` +
          `Proceed?`
        )
        if (!confirmed) { setBusy(false); return }

        result = await adminRenameCourse(authToken, {
          old_key: oldKey,
          new_name: draft.name,
          new_location: draft.location,
          new_course_data: { ...patch, name: draft.name, location: draft.location },
        })
        // Hazards still need a separate upsert after rename (server's rename
        // RPC only re-keys existing rows, doesn't merge editor changes).
        if (hazardsByHole.length) {
          await adminUpdateMetadata(authToken, {
            course_key: result.new_key,
            patch: {}, // no further course_data change
            hazardsByHole,
          }).catch(e => console.warn('[admin editor] post-rename hazard upsert failed:', e.message))
        }
      } else {
        result = await adminUpdateMetadata(authToken, {
          course_key: oldKey,
          patch,
          hazardsByHole,
        })
      }

      setMsg('✓ Saved. Visible to all users on next lookup.')
      onSaved?.(result)
    } catch (e) {
      setMsg(`Error: ${e.message}`)
    }
    setBusy(false)
  }

  async function handleReparse() {
    setBusy(true); setMsg('Re-parsing stored PDF…')
    try {
      const res = await adminReparsePdf(authToken, { course_key: oldKey })
      setReparse(res)
      setMsg('')
    } catch (e) {
      setMsg(`Error: ${e.message}`)
    }
    setBusy(false)
  }

  function acceptReparseField(field, value) {
    if (field === 'holes' && Array.isArray(value)) {
      // value is the holesDiff list — accept all
      setHoles(prev => prev.map((h, i) => {
        const change = value.find(d => d.hole === i + 1)
        if (!change) return h
        const merged = { ...h }
        for (const k of Object.keys(change.fields || {})) merged[k] = change.fields[k].parsed
        return merged
      }))
    } else {
      setDraft(prev => ({ ...prev, [field]: value }))
    }
  }

  function acceptAllReparse() {
    if (!reparse?.diff) return
    for (const [field, val] of Object.entries(reparse.diff)) {
      if (field === 'holes') acceptReparseField('holes', val)
      else acceptReparseField(field, val.parsed)
    }
    setReparse(null)
    setMsg('Re-parse diff applied to form. Click Save to commit.')
  }

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div style={overlay}>
      <div style={modal}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
          <h2 style={{ margin: 0, fontSize: 18, color: C.text }}>
            Edit course metadata
            {isRename && <span style={{ marginLeft: 10, color: C.amber, fontSize: 12 }}>RENAME</span>}
          </h2>
          <button style={btnG} onClick={onClose} disabled={busy}>Close</button>
        </div>

        {validationIssues.length > 0 && (
          <div style={{ ...card, padding: 10, marginBottom: 12, borderColor: C.red, background: C.redMuted, color: C.red, fontSize: 12 }}>
            <strong>Validation:</strong>
            <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>
              {validationIssues.map((v, i) => <li key={i}>{v}</li>)}
            </ul>
          </div>
        )}

        {/* ── Course-level fields ────────────────────────────────────────── */}
        <div style={{ ...card, marginBottom: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Name *" value={draft.name} onChange={v => setDraft({ ...draft, name: v })} />
            <Field label="Location" value={draft.location} onChange={v => setDraft({ ...draft, location: v })} />
            <Field label="Total yardage" value={draft.yardage} onChange={v => setDraft({ ...draft, yardage: v })} />
            <Field label="Rating" value={draft.rating} onChange={v => setDraft({ ...draft, rating: v })} />
            <Field label="Slope" value={draft.slope} onChange={v => setDraft({ ...draft, slope: v })} />
            <Field label="Par" value={draft.par} onChange={v => setDraft({ ...draft, par: v })} />
            <Field label="Selected tee" value={draft.selectedTee} onChange={v => setDraft({ ...draft, selectedTee: v })} />
            <Field label="Architect" value={draft.architect} onChange={v => setDraft({ ...draft, architect: v })} />
            <Field label="Greens type" value={draft.greensType} onChange={v => setDraft({ ...draft, greensType: v })} placeholder="Bermuda / Bentgrass / Poa…" />
            <Field label="Region" value={draft.region} onChange={v => setDraft({ ...draft, region: v })} placeholder="Pacific NW, Sandbelt…" />
            <Field label="Default conditions" value={draft.defaultConditions} onChange={v => setDraft({ ...draft, defaultConditions: v })} placeholder="Firm & fast, Wet, Normal…" />
            <Field label="Tags (comma-separated)" value={draft.tags} onChange={v => setDraft({ ...draft, tags: v })} placeholder="links, mountain, walkable" />
          </div>
          <div style={{ marginTop: 10 }}>
            <label style={lbl}>Notes</label>
            <textarea style={{ ...inp, minHeight: 60 }} value={draft.notes} onChange={e => setDraft({ ...draft, notes: e.target.value })} />
          </div>
        </div>

        {/* ── Tees ──────────────────────────────────────────────────────── */}
        <div style={{ ...card, marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <h3 style={{ margin: 0, fontSize: 14, color: C.text }}>Tees</h3>
            <button style={btnG} onClick={addTee}>+ Add tee</button>
          </div>
          {tees.length === 0 && <p style={{ color: C.textMuted, fontSize: 12, margin: 0 }}>No tees defined.</p>}
          {tees.map((t, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr auto', gap: 6, marginBottom: 6 }}>
              <input style={inp} placeholder="Tee name" value={t.name || ''} onChange={e => updateTee(i, { name: e.target.value })} />
              <input style={inp} placeholder="Yds" value={t.yardage || ''} onChange={e => updateTee(i, { yardage: e.target.value })} />
              <input style={inp} placeholder="Rating" value={t.rating || ''} onChange={e => updateTee(i, { rating: e.target.value })} />
              <input style={inp} placeholder="Slope" value={t.slope || ''} onChange={e => updateTee(i, { slope: e.target.value })} />
              <input style={inp} placeholder="Par" value={t.par || ''} onChange={e => updateTee(i, { par: e.target.value })} />
              <button style={{ ...btnG, color: C.red, borderColor: C.red }} onClick={() => removeTee(i)}>×</button>
            </div>
          ))}
        </div>

        {/* ── Holes table ───────────────────────────────────────────────── */}
        <div style={{ ...card, marginBottom: 12 }}>
          <h3 style={{ margin: '0 0 10px', fontSize: 14, color: C.text }}>Holes</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '36px 50px 70px 50px 60px 1fr 80px', gap: 6, color: C.textMuted, fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>
            <div>#</div><div>Par</div><div>Yds</div><div>HCP</div><div>Elev</div><div>Notes</div><div>Hazards</div>
          </div>
          {holes.map((h, i) => (
            <div key={i}>
              <div style={{ display: 'grid', gridTemplateColumns: '36px 50px 70px 50px 60px 1fr 80px', gap: 6, marginBottom: 4 }}>
                <div style={{ alignSelf: 'center', color: C.textMuted, fontSize: 12 }}>{i + 1}</div>
                <input style={inp} value={h.par} onChange={e => updateHole(i, { par: e.target.value })} />
                <input style={inp} value={h.yardage} onChange={e => updateHole(i, { yardage: e.target.value })} />
                <input style={inp} value={h.handicap} onChange={e => updateHole(i, { handicap: e.target.value })} />
                <input style={inp} value={h.elevation || ''} onChange={e => updateHole(i, { elevation: e.target.value })} />
                <input style={inp} value={h.notes || ''} onChange={e => updateHole(i, { notes: e.target.value })} />
                <button style={btnG} onClick={() => setHazardOpen(hazardOpen === i ? null : i)}>
                  {hazardOpen === i ? 'Hide' : (h.hzDesign?.hazards?.length ? `Edit (${h.hzDesign.hazards.length})` : 'Edit')}
                </button>
              </div>
              {hazardOpen === i && <HazardEditor
                hole={i + 1}
                hz={h.hzDesign || { hole: i + 1, dogleg: 'straight', hazards: [], green_notes: '', recommended_line: '' }}
                onChange={patch => updateHazard(i, patch)}
                onAdd={() => addHazardItem(i)}
                onUpdateItem={(j, patch) => updateHazardItem(i, j, patch)}
                onRemoveItem={j => removeHazardItem(i, j)}
              />}
            </div>
          ))}
        </div>

        {/* ── Footer actions ────────────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button style={btnP} onClick={handleSave} disabled={busy || validationIssues.length > 0}>
            {busy ? 'Saving…' : (isRename ? 'Rename & Save' : 'Save')}
          </button>
          <button style={btnG} onClick={onClose} disabled={busy}>Cancel</button>
          {course._sourcePdf && (
            <button style={btnG} onClick={handleReparse} disabled={busy}>Re-parse stored PDF</button>
          )}
          {msg && <span style={{ marginLeft: 'auto', fontSize: 12, color: msg.startsWith('Error') ? C.red : C.green }}>{msg}</span>}
        </div>

        {/* ── Re-parse diff modal ───────────────────────────────────────── */}
        {reparse && (
          <ReparseDiffPanel
            diff={reparse.diff}
            onAcceptField={acceptReparseField}
            onAcceptAll={acceptAllReparse}
            onDismiss={() => setReparse(null)}
          />
        )}
      </div>
    </div>
  )
}

function Field({ label, value, onChange, placeholder }) {
  return (
    <div>
      <label style={lbl}>{label}</label>
      <input style={inp} value={value || ''} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
    </div>
  )
}

function HazardEditor({ hole, hz, onChange, onAdd, onUpdateItem, onRemoveItem }) {
  return (
    <div style={{ background: C.bgInput, border: `1px solid ${C.border}`, borderRadius: 7, padding: 10, marginBottom: 8 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr', gap: 8, marginBottom: 8 }}>
        <div>
          <label style={lbl}>Dogleg</label>
          <select style={inp} value={hz.dogleg || 'straight'} onChange={e => onChange({ dogleg: e.target.value })}>
            <option value="straight">straight</option>
            <option value="left">left</option>
            <option value="right">right</option>
          </select>
        </div>
        <div>
          <label style={lbl}>Green notes</label>
          <input style={inp} value={hz.green_notes || ''} onChange={e => onChange({ green_notes: e.target.value })} />
        </div>
        <div>
          <label style={lbl}>Recommended line</label>
          <input style={inp} value={hz.recommended_line || ''} onChange={e => onChange({ recommended_line: e.target.value })} />
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <strong style={{ fontSize: 11, color: C.textMuted }}>Hazards on hole {hole}</strong>
        <button style={btnG} onClick={onAdd}>+ Add hazard</button>
      </div>
      {(hz.hazards || []).map((hz2, j) => (
        <div key={j} style={{ display: 'grid', gridTemplateColumns: '110px 90px 90px 1fr auto', gap: 6, marginBottom: 4 }}>
          <select style={inp} value={hz2.type || 'bunker'} onChange={e => onUpdateItem(j, { type: e.target.value })}>
            <option value="bunker">bunker</option>
            <option value="water">water</option>
            <option value="creek">creek</option>
            <option value="native">native</option>
            <option value="OB">OB</option>
            <option value="trees">trees</option>
          </select>
          <select style={inp} value={hz2.side || 'C'} onChange={e => onUpdateItem(j, { side: e.target.value })}>
            <option value="L">L</option><option value="R">R</option><option value="C">C</option>
            <option value="front">front</option><option value="back">back</option>
          </select>
          <input style={inp} placeholder="carry yds" value={hz2.carry_yards ?? ''} onChange={e => onUpdateItem(j, { carry_yards: e.target.value ? Number(e.target.value) : null })} />
          <input style={inp} placeholder="notes" value={hz2.notes || ''} onChange={e => onUpdateItem(j, { notes: e.target.value })} />
          <button style={{ ...btnG, color: C.red, borderColor: C.red }} onClick={() => onRemoveItem(j)}>×</button>
        </div>
      ))}
    </div>
  )
}

function ReparseDiffPanel({ diff, onAcceptField, onAcceptAll, onDismiss }) {
  const fieldEntries = Object.entries(diff).filter(([k]) => k !== 'holes')
  const holesDiff = diff.holes || []
  const isEmpty = fieldEntries.length === 0 && holesDiff.length === 0
  return (
    <div style={{ ...card, marginTop: 14, borderColor: C.blue, background: C.blueMuted }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: 14, color: C.text }}>PDF re-parse diff</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          {!isEmpty && <button style={btnG} onClick={onAcceptAll}>Accept all</button>}
          <button style={btnG} onClick={onDismiss}>Dismiss</button>
        </div>
      </div>
      {isEmpty && <p style={{ color: C.textMuted, fontSize: 12, margin: 0 }}>No differences — stored values match the parse.</p>}
      {fieldEntries.map(([field, val]) => (
        <div key={field} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr auto', gap: 8, alignItems: 'center', marginBottom: 4, fontSize: 12 }}>
          <strong style={{ color: C.text }}>{field}</strong>
          <span style={{ color: C.textMuted }}>current: {String(val.current ?? '—')}</span>
          <span style={{ color: C.blue }}>parsed: {String(val.parsed ?? '—')}</span>
          <button style={btnG} onClick={() => onAcceptField(field, val.parsed)}>Accept</button>
        </div>
      ))}
      {holesDiff.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary style={{ cursor: 'pointer', color: C.text, fontSize: 12 }}>
            Per-hole diff ({holesDiff.length} hole{holesDiff.length === 1 ? '' : 's'})
          </summary>
          <div style={{ marginTop: 6 }}>
            {holesDiff.map(d => (
              <div key={d.hole} style={{ fontSize: 11, color: C.textMuted, marginBottom: 2 }}>
                Hole {d.hole}: {Object.entries(d.fields).map(([k, v]) => `${k} ${v.current ?? '—'}→${v.parsed}`).join(', ')}
              </div>
            ))}
            <button style={{ ...btnG, marginTop: 6 }} onClick={() => onAcceptField('holes', holesDiff)}>Accept all hole changes</button>
          </div>
        </details>
      )}
    </div>
  )
}

const overlay = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000,
  display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 20, overflowY: 'auto',
}

const modal = {
  background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20,
  maxWidth: 980, width: '100%', maxHeight: '92vh', overflowY: 'auto',
}
