import { useRef, useState } from 'react'
import { parsers, detectParser } from '../lib/importers/registry.js'
import { normalizeClubName, computeClubStats } from '../lib/golfdata/stats.js'

// Mirrors the matchedRows .length in the body; needed by applyDisabled.
function matchedRowsCount(result) {
  if (!result) return 0
  return result.stats.length
}

// Import surface: paste or upload a launch-monitor export (or a manual
// club/carry list), preview per-club stats, then apply them to the bag.
// Design tokens + shared styles are passed in from App.jsx as props.
export default function ImportTab({ clubs, setClubs, C, card, inp, lbl, btnP, btnG }) {
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState('')
  const [parserId, setParserId] = useState('auto')
  const [result, setResult] = useState(null)  // { parser, session, stats }
  const [error, setError] = useState('')
  const [appliedMsg, setAppliedMsg] = useState('')
  // User-confirmed unit when the importer couldn't detect one. Required
  // before applying to bag — prevents silently treating a metric export as
  // yards.
  const [confirmedUnit, setConfirmedUnit] = useState(null)  // 'yards' | 'meters' | null
  const fileRef = useRef(null)

  const resetOutput = () => { setResult(null); setError(''); setAppliedMsg(''); setConfirmedUnit(null) }
  const needsUnitConfirm = result?.session?.unitsDetected === 'unknown' && !confirmedUnit
  const applyDisabled = matchedRowsCount(result) === 0 || needsUnitConfirm

  const handleFile = (e) => {
    const file = e.target.files && e.target.files[0]
    e.target.value = ''  // allow re-selecting the same file
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => { setText(String(reader.result || '')); setFileName(file.name); resetOutput() }
    reader.onerror = () => { setFileName(''); setError(`Could not read file "${file.name}"`) }
    reader.readAsText(file)
  }

  const runParse = () => {
    resetOutput()
    if (!text.trim()) { setError('Paste data or choose a file first.'); return }
    const parser = parserId === 'auto'
      ? detectParser(text)
      : parsers.find(p => p.id === parserId)
    if (!parser) { setError('Could not auto-detect the data format — pick a parser from the dropdown and try again.'); return }
    try {
      const session = parser.parse(text)
      session.warnings = session.warnings || []
      // Tag shots with session source/date so computeClubStats can surface them
      const shots = (session.shots || []).map(s => ({
        ...s,
        source: s.source ?? session.source,
        sessionDate: s.sessionDate ?? session.sessionDate,
      }))
      setResult({ parser, session, stats: computeClubStats(shots) })
    } catch (err) {
      setError(err?.message || 'Failed to parse data')
    }
  }

  // Map bag clubs to canonical keys so ClubStats rows can find their club
  const bagKeyByIndex = clubs.map(c => normalizeClubName(c.club).key)
  const inBag = (clubKey) => bagKeyByIndex.includes(clubKey)
  const matchedRows = result ? result.stats.filter(r => inBag(r.clubKey)) : []

  const applyToBag = () => {
    if (!result || matchedRows.length === 0) return
    if (result.session.unitsDetected === 'unknown' && !confirmedUnit) return
    // If user confirmed unit and source was meters, scale carry-related fields
    // through here BEFORE applying. (The parser already had a chance to
    // convert; this only runs when the parser punted with 'unknown'.)
    if (confirmedUnit === 'meters') {
      const M_TO_Y = 1.09361
      for (const row of matchedRows) {
        for (const k of ['carryP50', 'carryP80', 'carryAvg', 'totalP50', 'totalAvg', 'dispLeftP80', 'dispRightP80']) {
          if (Number.isFinite(row[k])) row[k] = Math.round(row[k] * M_TO_Y * 10) / 10
        }
      }
    }
    const byKey = {}
    for (const row of matchedRows) byKey[row.clubKey] = row
    setClubs(prev => prev.map(club => {
      const row = byKey[normalizeClubName(club.club).key]
      if (!row) return club
      const next = { ...club, stats: row }
      // Club fields hold strings (they back number inputs)
      if (row.carryP50 != null)     next.carry = String(Math.round(row.carryP50))
      if (row.dispLeftP80 != null)  next.dispLeft = String(Math.round(row.dispLeftP80))
      if (row.dispRightP80 != null) next.dispRight = String(Math.round(row.dispRightP80))
      if (row.ballSpeedAvg != null) next.ballSpeed = String(row.ballSpeedAvg)
      if (row.launchAvg != null)    next.launchAngle = String(row.launchAvg)
      if (row.spinAvg != null)      next.spinRate = String(row.spinAvg)
      return next
    }))
    setAppliedMsg(`Applied stats to ${matchedRows.length} club${matchedRows.length === 1 ? '' : 's'} in the bag.`)
  }

  const fmt = (v, suffix = '') => (v == null ? '—' : `${v}${suffix}`)
  const cell = { fontSize: 12, color: C.text }
  const gridCols = '1.4fr 0.7fr 1fr 1fr 0.8fr 1.1fr 1fr'

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: C.text, margin: 0 }}>Import shot data</h2>
        <p style={{ fontSize: 12, color: C.textMuted, marginTop: 3 }}>
          Paste a launch-monitor export or a simple club/carry list — per-club carries and dispersion are computed and applied to your bag
        </p>
      </div>

      {/* Input */}
      <div style={{ ...card, marginBottom: 12 }}>
        <label style={lbl}>Session data — paste below or load a .csv / .txt file</label>
        <textarea
          style={{ ...inp, height: 140, resize: 'vertical', fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
          value={text}
          onChange={e => { setText(e.target.value); setFileName(''); resetOutput() }}
          placeholder={'7i, 165\n7i, 168, -4\nDriver, 272, 12\n…or paste a CSV export from your launch monitor'}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
          <input ref={fileRef} type="file" accept=".csv,.txt" style={{ display: 'none' }} onChange={handleFile} />
          <button style={btnG} onClick={() => fileRef.current && fileRef.current.click()}>📄 Choose file…</button>
          {fileName && <span style={{ fontSize: 12, color: C.textMuted }}>{fileName}</span>}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ ...lbl, margin: 0 }}>Format</span>
            <select style={{ ...inp, width: 'auto', minWidth: 200, padding: '6px 10px', fontSize: 12 }}
              value={parserId} onChange={e => { setParserId(e.target.value); resetOutput() }}>
              <option value="auto">Auto-detect</option>
              {parsers.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            <button style={{ ...btnP, padding: '7px 18px', fontSize: 12 }} onClick={runParse}>Parse →</button>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{ ...card, borderColor: C.red, marginBottom: 12 }}>
          <p style={{ color: C.red, fontSize: 13, margin: 0 }}>⚠ {error}</p>
        </div>
      )}

      {/* Preview */}
      {result && (
        <div style={{ ...card, marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
            <p style={{ ...lbl, margin: 0 }}>Preview</p>
            <span style={{ background: C.accentMuted, color: C.accent, fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 99, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              {result.parser.label}
            </span>
            <span style={{ fontSize: 11, color: C.textFaint }}>
              {result.session.shots.length} shot{result.session.shots.length === 1 ? '' : 's'}
              {result.session.sessionDate ? ` · ${result.session.sessionDate}` : ''}
              {` · units: ${result.session.unitsDetected}`}
            </span>
          </div>

          {result.session.warnings.length > 0 && (
            <div style={{ background: C.amberMuted, border: `1px solid ${C.amber}`, borderRadius: 8, padding: '8px 12px', margin: '8px 0' }}>
              {result.session.warnings.map((w, i) => (
                <p key={i} style={{ fontSize: 12, color: C.amber, margin: i === 0 ? 0 : '4px 0 0' }}>⚠ {w}</p>
              ))}
            </div>
          )}

          {needsUnitConfirm && (
            <div style={{ background: C.redMuted || '#3a1515', border: `1px solid ${C.red}`, borderRadius: 8, padding: '10px 14px', margin: '8px 0' }}>
              <p style={{ fontSize: 12, color: C.red, margin: '0 0 8px', fontWeight: 600 }}>
                ⚠ Units could not be detected for this file. Confirm below before applying — picking the wrong unit would shift every distance by ~9%.
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={{ ...btnG, padding: '4px 12px', fontSize: 12 }} onClick={() => setConfirmedUnit('yards')}>Carry numbers are YARDS</button>
                <button style={{ ...btnG, padding: '4px 12px', fontSize: 12 }} onClick={() => setConfirmedUnit('meters')}>Carry numbers are METERS — convert to yards</button>
              </div>
            </div>
          )}
          {confirmedUnit && (
            <p style={{ fontSize: 11, color: C.green, margin: '4px 0' }}>✓ Unit confirmed: {confirmedUnit}</p>
          )}

          {result.stats.length === 0 ? (
            <p style={{ fontSize: 12, color: C.textFaint, fontStyle: 'italic', margin: '10px 0 0' }}>
              No clubs with carry data found in this session.
            </p>
          ) : (
            <>
              <div style={{ overflowX: 'auto', marginTop: 10 }}>
                <div style={{ minWidth: 640 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: gridCols, gap: '4px 10px', marginBottom: 6 }}>
                    {['Club', 'Samples', 'P50 carry', 'P80 carry', 'Std', 'Disp L / R (P80)', 'Bag'].map((h, i) => (
                      <span key={i} style={{ fontSize: 10, color: C.textFaint, letterSpacing: '0.07em', textTransform: 'uppercase' }}>{h}</span>
                    ))}
                  </div>
                  {result.stats.map(row => {
                    const matched = inBag(row.clubKey)
                    return (
                      <div key={row.clubKey}
                        style={{ display: 'grid', gridTemplateColumns: gridCols, gap: '4px 10px', alignItems: 'center', padding: '5px 0', borderTop: `1px solid ${C.border}`, opacity: matched ? 1 : 0.55 }}>
                        <span style={{ ...cell, fontWeight: 600 }}>{row.clubLabel || row.clubKey}</span>
                        <span style={cell}>{row.samples}</span>
                        <span style={cell}>{fmt(row.carryP50, ' yds')}</span>
                        <span style={cell}>{fmt(row.carryP80, ' yds')}</span>
                        <span style={cell}>{fmt(row.carryStd)}</span>
                        <span style={cell}>{fmt(row.dispLeftP80, 'L')} / {fmt(row.dispRightP80, 'R')}</span>
                        {matched
                          ? <span style={{ fontSize: 11, color: C.green }}>✓ in bag</span>
                          : <span style={{ fontSize: 11, color: C.textFaint }}>not in bag</span>}
                      </div>
                    )
                  })}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14, flexWrap: 'wrap' }}>
                <button
                  style={{ ...btnP, opacity: applyDisabled ? 0.5 : 1, cursor: applyDisabled ? 'default' : 'pointer' }}
                  onClick={applyToBag} disabled={applyDisabled}>
                  Apply to bag ({matchedRows.length} club{matchedRows.length === 1 ? '' : 's'})
                </button>
                {appliedMsg && <span style={{ fontSize: 12, color: C.green }}>✓ {appliedMsg}</span>}
                {matchedRows.length === 0 && (
                  <span style={{ fontSize: 12, color: C.textFaint }}>No parsed clubs match your bag — rename bag clubs or check the data.</span>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Hint */}
      {!result && !error && (
        <div style={{ background: C.blueMuted, border: `1px solid ${C.blue}`, borderRadius: 8, padding: '10px 14px' }}>
          <p style={{ fontSize: 12, color: C.textMuted, margin: 0, lineHeight: 1.6 }}>
            <span style={{ color: C.blue, fontWeight: 600 }}>Formats:</span> launch-monitor CSV exports are auto-detected.
            For quick manual entry, paste one shot per line as <code>club, carry</code> or <code>club, carry, offline</code> —
            offline in yards, negative = left, positive = right (e.g. <code>7i, 165, -4</code>).
            Applying updates each matching club's carry, dispersion, and launch numbers in the bag.
          </p>
        </div>
      )}
    </div>
  )
}
