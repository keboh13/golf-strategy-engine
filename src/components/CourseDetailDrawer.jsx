import { useEffect, useState, useCallback } from 'react'
import { C, F, card, inp, lbl, btnP, btnG } from '../theme.js'
import { Badge } from './ui.jsx'
import { supabase } from '../lib/supabase.js'
import CourseHoleMap from './CourseHoleMap.jsx'

function shortDate(iso) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return iso }
}

function sourceBadge(source) {
  if (source === 'GolfCourseAPI') return { label: '✓ GolfCourseAPI', bg: C.greenMuted,  fg: C.green }
  if (source === 'yardage_book')  return { label: '📄 Yardage book',  bg: C.blueMuted,   fg: C.blue }
  if (source === 'OpenGolfAPI')   return { label: '~ OpenGolf',       bg: C.amberMuted,  fg: C.amber }
  if (source === 'Claude')        return { label: '⚡ AI-derived',     bg: C.accentMuted, fg: C.accent }
  return { label: source || 'Unknown', bg: C.bgInput, fg: C.textMuted }
}

function ScorecardTable({ holes }) {
  if (!Array.isArray(holes) || holes.length === 0) return null

  const front = holes.slice(0, 9)
  const back  = holes.slice(9)

  const HalfTable = ({ half, label }) => {
    if (!half.length) return null
    const par   = half.reduce((s, h) => s + (Number(h.par)     || 0), 0)
    const yards = half.reduce((s, h) => s + (Number(h.yardage) || 0), 0)
    return (
      <div style={{ overflowX: 'auto', marginBottom: 12 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 360, fontSize: 11 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
              <th style={{ textAlign: 'left', padding: '4px 6px', color: C.textMuted, fontWeight: 600, width: 56 }}>{label}</th>
              {half.map(h => (
                <th key={h.num} style={{ textAlign: 'center', padding: '4px 4px', color: C.textFaint, fontWeight: 500, minWidth: 28 }}>
                  {h.num}
                </th>
              ))}
              <th style={{ textAlign: 'center', padding: '4px 6px', color: C.textMuted, fontWeight: 600 }}>Tot</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ padding: '4px 6px', color: C.textMuted, fontSize: 10, fontWeight: 600 }}>PAR</td>
              {half.map(h => (
                <td key={h.num} style={{ textAlign: 'center', padding: '4px 4px', color: C.text }}>{h.par || '—'}</td>
              ))}
              <td style={{ textAlign: 'center', padding: '4px 6px', color: C.text, fontWeight: 600 }}>{par || '—'}</td>
            </tr>
            <tr style={{ borderTop: `1px solid ${C.border}` }}>
              <td style={{ padding: '4px 6px', color: C.textMuted, fontSize: 10, fontWeight: 600 }}>YDS</td>
              {half.map(h => (
                <td key={h.num} style={{ textAlign: 'center', padding: '4px 4px', color: C.textMuted, fontSize: 10 }}>
                  {h.yardage ? Number(h.yardage).toLocaleString() : '—'}
                </td>
              ))}
              <td style={{ textAlign: 'center', padding: '4px 6px', color: C.textMuted, fontSize: 10 }}>
                {yards ? Number(yards).toLocaleString() : '—'}
              </td>
            </tr>
            {half.some(h => h.handicap) && (
              <tr>
                <td style={{ padding: '4px 6px', color: C.textMuted, fontSize: 10, fontWeight: 600 }}>HCP</td>
                {half.map(h => (
                  <td key={h.num} style={{ textAlign: 'center', padding: '4px 4px', color: C.textFaint, fontSize: 10 }}>
                    {h.handicap || '—'}
                  </td>
                ))}
                <td />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div>
      <HalfTable half={front} label="FRONT" />
      {back.length > 0 && <HalfTable half={back} label="BACK" />}
    </div>
  )
}

// Contribution form — lets authenticated users submit tee & pin coordinates for
// a hole that is missing geometry. Upserts directly to course_hole_contrib via
// the Supabase client (RLS allows any authenticated user to insert/update).
function ContributeSection({ courseKey, holes, coveredHoles }) {
  const [open, setOpen]     = useState(false)
  const [hole, setHole]     = useState(1)
  const [teeLat, setTeeLat] = useState('')
  const [teeLng, setTeeLng] = useState('')
  const [pinLat, setPinLat] = useState('')
  const [pinLng, setPinLng] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg]       = useState(null) // { ok: bool, text: str }

  const holeOptions = holes.length > 0
    ? holes.map(h => h.num)
    : Array.from({ length: 18 }, (_, i) => i + 1)

  const reset = () => {
    setTeeLat(''); setTeeLng(''); setPinLat(''); setPinLng(''); setMsg(null)
  }

  const submit = async () => {
    const parse = (v) => parseFloat(v)
    const [tLat, tLng, pLat, pLng] = [teeLat, teeLng, pinLat, pinLng].map(parse)
    if ([tLat, tLng, pLat, pLng].some(isNaN)) {
      setMsg({ ok: false, text: 'All four coordinate fields are required.' })
      return
    }
    if (Math.abs(tLat) > 90 || Math.abs(pLat) > 90 || Math.abs(tLng) > 180 || Math.abs(pLng) > 180) {
      setMsg({ ok: false, text: 'Coordinates out of range. Latitude ±90, longitude ±180.' })
      return
    }
    setSaving(true); setMsg(null)
    const { error } = await supabase.from('course_hole_contrib').upsert({
      course_key: courseKey,
      hole_ref:   hole,
      tee_lat:    tLat,
      tee_lng:    tLng,
      pin_lat:    pLat,
      pin_lng:    pLng,
      source:     'user',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'course_key,hole_ref' })
    setSaving(false)
    if (error) {
      setMsg({ ok: false, text: error.message })
    } else {
      setMsg({ ok: true, text: `Hole ${hole} geometry submitted — thank you! An admin will review before it appears on the map.` })
      reset()
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left', fontFamily: F }}
      >
        <span style={{ fontSize: 12, color: C.accent }}>+ Contribute tee & pin coordinates</span>
      </button>
    )
  }

  return (
    <div style={{ ...card, padding: '14px 16px', border: `1px solid ${C.accentDim}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <p style={{ ...lbl, margin: 0 }}>Contribute hole geometry</p>
        <button onClick={() => { setOpen(false); reset() }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textFaint, fontSize: 16, lineHeight: 1, fontFamily: F }}>✕</button>
      </div>

      <p style={{ fontSize: 12, color: C.textMuted, margin: '0 0 12px' }}>
        Enter the decimal latitude and longitude for the tee box and pin for one hole.
        Get coordinates by right-clicking any location in Google Maps → "What's here?"
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
        <div>
          <label style={lbl}>Hole</label>
          <select style={inp} value={hole} onChange={e => setHole(Number(e.target.value))}>
            {holeOptions.map(n => (
              <option key={n} value={n}>
                Hole {n}{coveredHoles?.has(n) ? ' (has geometry — will overwrite)' : ''}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div>
            <label style={lbl}>Tee latitude</label>
            <input style={inp} value={teeLat} onChange={e => setTeeLat(e.target.value)} placeholder="e.g. 36.5671" />
          </div>
          <div>
            <label style={lbl}>Tee longitude</label>
            <input style={inp} value={teeLng} onChange={e => setTeeLng(e.target.value)} placeholder="e.g. -121.9496" />
          </div>
          <div>
            <label style={lbl}>Pin latitude</label>
            <input style={inp} value={pinLat} onChange={e => setPinLat(e.target.value)} placeholder="e.g. 36.5690" />
          </div>
          <div>
            <label style={lbl}>Pin longitude</label>
            <input style={inp} value={pinLng} onChange={e => setPinLng(e.target.value)} placeholder="e.g. -121.9503" />
          </div>
        </div>
      </div>

      {msg && (
        <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 6, background: msg.ok ? C.greenMuted : C.redMuted, border: `1px solid ${msg.ok ? C.green : C.red}` }}>
          <p style={{ margin: 0, fontSize: 12, color: msg.ok ? C.green : C.red }}>{msg.text}</p>
        </div>
      )}

      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
        <button style={btnP} onClick={submit} disabled={saving}>{saving ? 'Submitting…' : 'Submit geometry'}</button>
        <button style={btnG} onClick={() => { setOpen(false); reset() }}>Cancel</button>
      </div>
    </div>
  )
}

export default function CourseDetailDrawer({ course, onClose, onUseForPrep, session }) {
  const [geo, setGeo]               = useState(null)
  const [geoLoading, setGeoLoading] = useState(false)
  const [selectedHole, setSelectedHole] = useState(1)
  const [useMsg, setUseMsg]         = useState('')

  const courseKey = course?._cacheKey || course?.cacheKey
  const courseName = course?.name || ''
  const location   = course?.location || ''
  const holes      = Array.isArray(course?.holes) ? course.holes : []

  const loadGeo = useCallback(async () => {
    if (!courseKey) return
    setGeoLoading(true)
    const { data } = await supabase
      .from('course_geo')
      .select('tier, geojson, bbox_by_hole, coverage')
      .eq('course_key', courseKey)
      .maybeSingle()
    if (data?.geojson) {
      setGeo({ geojson: data.geojson, bboxByHole: data.bbox_by_hole, tier: data.tier, coverage: data.coverage })
    }
    setGeoLoading(false)
  }, [courseKey])

  useEffect(() => {
    if (!course) return
    setGeo(null)
    setSelectedHole(1)
    setUseMsg('')
    loadGeo()
  }, [course, loadGeo])

  // Trap Escape key
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  if (!course) return null

  const sb = sourceBadge(course.source)
  const coords = course.coords?.lat
    ? { lat: course.coords.lat, lng: course.coords.lng }
    : null

  const handleUseForPrep = () => {
    if (!session) { setUseMsg('Sign in to use this course in Round Prep.'); return }
    onUseForPrep?.(course)
    onClose?.()
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 900,
        }}
      />

      {/* Drawer panel */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 901,
        width: 'min(600px, 100vw)',
        background: C.bg,
        borderLeft: `1px solid ${C.border}`,
        overflowY: 'auto',
        display: 'flex', flexDirection: 'column',
        boxShadow: '-8px 0 40px rgba(0,0,0,0.4)',
      }}>

        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.border}`, position: 'sticky', top: 0, background: C.bg, zIndex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.text, lineHeight: 1.2 }}>{courseName}</h2>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: C.textMuted }}>{location}</p>
              <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <Badge label={sb.label} bg={sb.bg} fg={sb.fg} />
                {course.isPublic && <Badge label="Library" bg={C.accentMuted} fg={C.accent} />}
                {course.par && <Badge label={`Par ${course.par}`} bg={C.bgInput} fg={C.textMuted} />}
                {course.rating && course.slope && (
                  <Badge label={`${course.rating}/${course.slope}`} bg={C.bgInput} fg={C.textMuted} />
                )}
                {holes.length > 0 && <Badge label={`${holes.length} holes`} bg={C.bgInput} fg={C.textMuted} />}
              </div>
            </div>
            <button onClick={onClose} style={{ ...btnG, flexShrink: 0, padding: '6px 10px' }}>✕</button>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 20, flex: 1 }}>

          {/* Use for prep CTA */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button style={{ ...btnP }} onClick={handleUseForPrep}>
              Use for Round Prep →
            </button>
            {useMsg && <p style={{ margin: 0, fontSize: 12, color: C.textMuted }}>{useMsg}</p>}
          </div>

          {/* Scorecard */}
          {holes.length > 0 && (
            <div style={{ ...card, padding: '14px 16px' }}>
              <p style={{ ...lbl, margin: '0 0 10px' }}>Scorecard</p>
              <ScorecardTable holes={holes} />
              {course.yardage && (
                <p style={{ fontSize: 11, color: C.textFaint, margin: '4px 0 0' }}>
                  Total: {Number(course.yardage).toLocaleString()} yards
                  {course.rating ? ` · Rating ${course.rating}` : ''}
                  {course.slope  ? ` · Slope ${course.slope}` : ''}
                </p>
              )}
            </div>
          )}

          {/* Hole map */}
          {coords && (
            <div style={{ ...card, padding: '14px 16px' }}>
              <p style={{ ...lbl, margin: '0 0 10px' }}>
                Satellite view
                {geoLoading && <span style={{ color: C.textFaint, fontWeight: 400, marginLeft: 6 }}>· loading geometry…</span>}
                {!geoLoading && geo?.tier && <span style={{ color: C.textFaint, fontWeight: 400, marginLeft: 6 }}>· Tier {geo.tier}</span>}
              </p>
              <div style={{ height: 340, borderRadius: 8, overflow: 'hidden' }}>
                <CourseHoleMap
                  courseName={courseName}
                  coords={coords}
                  geojson={geo?.geojson || null}
                  bboxByHole={geo?.bboxByHole || null}
                  holes={holes}
                  coverage={geo?.coverage || null}
                  tier={geo?.tier || 3}
                  selectedHole={selectedHole}
                  onSelectHole={setSelectedHole}
                />
              </div>
              {!session && (
                <p style={{ fontSize: 12, color: C.textMuted, margin: '10px 0 0' }}>
                  Sign in to contribute tee & pin locations for missing holes.
                </p>
              )}
              {session && courseKey && (
                <div style={{ marginTop: 12 }}>
                  <ContributeSection
                    courseKey={courseKey}
                    holes={holes}
                    coveredHoles={geo?.coverage ? new Set(Object.keys(geo.coverage).map(Number)) : new Set()}
                  />
                </div>
              )}
            </div>
          )}

          {/* Contribution form for courses with no map coords */}
          {!coords && session && courseKey && (
            <ContributeSection courseKey={courseKey} holes={holes} coveredHoles={new Set()} />
          )}

          {/* Hazards summary */}
          {Array.isArray(course.hazardSummary) && course.hazardSummary.length > 0 && (
            <div style={{ ...card, padding: '14px 16px' }}>
              <p style={{ ...lbl, margin: '0 0 10px' }}>Hazard notes</p>
              <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {course.hazardSummary.map((h, i) => (
                  <li key={i} style={{ fontSize: 12, color: C.textMuted }}>{h}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Bottom CTA — duplicated so user doesn't scroll back up after reviewing all holes */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button style={{ ...btnP }} onClick={handleUseForPrep}>
              Use for Round Prep →
            </button>
          </div>

          {/* Metadata footer */}
          <div style={{ ...card, padding: '12px 16px' }}>
            <p style={{ ...lbl, margin: '0 0 8px' }}>Source</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <p style={{ margin: 0, fontSize: 12, color: C.textMuted }}>
                Data source: <span style={{ color: C.text }}>{course.source || 'Unknown'}</span>
              </p>
              {course.cachedAt && (
                <p style={{ margin: 0, fontSize: 12, color: C.textMuted }}>
                  Cached: {shortDate(course.cachedAt)}
                </p>
              )}
              {course.hitCount > 0 && (
                <p style={{ margin: 0, fontSize: 12, color: C.textMuted }}>
                  Used by {course.hitCount} round prep session{course.hitCount === 1 ? '' : 's'}
                </p>
              )}
            </div>
          </div>

        </div>
      </div>
    </>
  )
}
