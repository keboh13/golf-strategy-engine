import { useState } from 'react'
import { C, F, card, inp, lbl, btnP, btnG } from '../theme.js'
import { Badge } from './ui.jsx'
import { supabase } from '../lib/supabase.js'

// Parses a CSV or JSON file into an array of course objects.
// Expected CSV columns (case-insensitive, extra columns ignored):
//   name, location, par, yardage, rating, slope, tee, source, holes_json
// Expected JSON: array of objects with the same keys, or Supabase course_data shape.
function parseFile(text, filename) {
  if (filename.toLowerCase().endsWith('.json')) {
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? parsed : [parsed]
  }

  // CSV
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) throw new Error('CSV needs a header row and at least one data row.')
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/[^a-z_]/g, ''))
  return lines.slice(1).filter(l => l.trim()).map((line, i) => {
    // Handle quoted fields
    const cols = []
    let cur = '', inQ = false
    for (const ch of line + ',') {
      if (ch === '"') { inQ = !inQ }
      else if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = '' }
      else cur += ch
    }
    const row = {}
    headers.forEach((h, j) => { if (h) row[h] = cols[j] ?? '' })
    if (!row.name) throw new Error(`Row ${i + 2}: missing name.`)
    return row
  })
}

// Map a parsed row to the shape course_cache expects in course_data.
function toCourseData(row) {
  const cd = {
    name:     (row.name || '').trim(),
    location: (row.location || '').trim(),
  }
  if (row.par)     cd.par     = parseInt(row.par)     || undefined
  if (row.yardage) cd.yardage = parseInt(row.yardage) || undefined
  if (row.rating)  cd.rating  = parseFloat(row.rating) || undefined
  if (row.slope)   cd.slope   = parseInt(row.slope)   || undefined
  if (row.tee)     cd.tee     = row.tee.trim()
  if (row.holes_json) {
    try { cd.holes = JSON.parse(row.holes_json) } catch {}
  }
  return cd
}

function cacheKey(name, location) {
  return `${(name || '').toLowerCase().trim()}|${(location || '').toLowerCase().trim()}`
}

export default function AdminBulkImport() {
  const [rows,     setRows]     = useState(null)   // parsed preview
  const [parseErr, setParseErr] = useState('')
  const [importing, setImporting] = useState(false)
  const [progress,  setProgress]  = useState(null) // { done, total, errors }
  const [msg,       setMsg]       = useState('')
  const [source,    setSource]    = useState('bulk_import')

  const handleFile = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setParseErr(''); setRows(null); setMsg(''); setProgress(null)
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const parsed = parseFile(ev.target.result, file.name)
        setRows(parsed.map(r => ({ ...r, _courseData: toCourseData(r), _key: cacheKey(r.name, r.location) })))
      } catch (err) {
        setParseErr(err.message)
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const runImport = async () => {
    if (!rows?.length) return
    setImporting(true); setMsg(''); setProgress({ done: 0, total: rows.length, errors: [] })

    let done = 0
    const errors = []

    for (const row of rows) {
      try {
        const { error } = await supabase
          .from('course_cache')
          .upsert(
            { cache_key: row._key, course_data: row._courseData, source, cached_at: new Date().toISOString() },
            { onConflict: 'cache_key' }
          )
        if (error) throw new Error(error.message)
      } catch (e) {
        errors.push(`${row._courseData.name}: ${e.message}`)
      }
      done++
      setProgress({ done, total: rows.length, errors })
    }

    setMsg(`✓ Imported ${done - errors.length} of ${rows.length} courses.${errors.length ? ` ${errors.length} failed.` : ''}`)
    setImporting(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ ...card }}>
        <p style={{ ...lbl, margin: '0 0 6px' }}>Bulk course import</p>
        <p style={{ fontSize: 12, color: C.textMuted, margin: '0 0 12px' }}>
          Upload a CSV or JSON file to import multiple courses into the shared cache at once.
          CSV must have a header row with columns: <code style={{ color: C.accent }}>name, location, par, yardage, rating, slope, tee</code>.
          JSON should be an array of objects with the same keys.
          Existing entries for the same course key are overwritten.
        </p>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={lbl}>File</label>
            <input type="file" accept=".csv,.json,application/json,text/csv" style={{ ...inp, padding: '5px 8px', cursor: 'pointer' }} onChange={handleFile} />
          </div>
          <div>
            <label style={lbl}>Source tag</label>
            <input style={{ ...inp, width: 140 }} value={source} onChange={e => setSource(e.target.value)} placeholder="bulk_import" />
          </div>
        </div>
        {parseErr && <p style={{ fontSize: 12, color: C.red, margin: '8px 0 0' }}>⚠ Parse error: {parseErr}</p>}
        {msg && <p style={{ fontSize: 12, color: msg.startsWith('✓') ? C.green : C.red, margin: '8px 0 0' }}>{msg}</p>}
      </div>

      {rows && rows.length > 0 && (
        <div style={{ ...card }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <p style={{ ...lbl, margin: 0 }}>Preview — {rows.length} course{rows.length !== 1 ? 's' : ''}</p>
            <button style={btnP} disabled={importing} onClick={runImport}>
              {importing ? `Importing… ${progress?.done}/${progress?.total}` : `Import ${rows.length} courses →`}
            </button>
          </div>

          {progress?.errors?.length > 0 && (
            <div style={{ padding: '8px 12px', background: C.redMuted, border: `1px solid ${C.red}`, borderRadius: 8, marginBottom: 10 }}>
              {progress.errors.map((e, i) => <p key={i} style={{ fontSize: 11, color: C.red, margin: i === 0 ? 0 : '2px 0 0' }}>{e}</p>)}
            </div>
          )}

          <div style={{ maxHeight: 400, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {rows.map((row, i) => {
              const cd = row._courseData
              const done = progress && i < progress.done
              const failed = done && progress.errors.some(e => e.startsWith(cd.name))
              return (
                <div key={i} style={{ background: C.bgInput, border: `1px solid ${failed ? C.red : done ? C.green : C.border}`, borderRadius: 6, padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <div>
                    <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{cd.name}</span>
                    <span style={{ fontSize: 11, color: C.textMuted, marginLeft: 8 }}>
                      {cd.location || '—'}
                      {cd.par ? ` · Par ${cd.par}` : ''}
                      {cd.yardage ? ` · ${Number(cd.yardage).toLocaleString()}y` : ''}
                      {cd.holes?.length ? ` · ${cd.holes.length} holes` : ''}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <Badge label={source} bg={C.bgInput} fg={C.textMuted} />
                    {done && !failed && <Badge label="✓ done" bg="#0d2a1a" fg="#4ade80" />}
                    {failed && <Badge label="⚠ failed" bg={C.redMuted} fg={C.red} />}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
