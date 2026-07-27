import { useState, useRef, useEffect } from 'react'
import { C } from '../theme.js'

function hazardSummary(hz) {
  if (!hz) return ''
  const parts = []
  if (hz.dogleg && hz.dogleg !== 'straight') parts.push(`DL${hz.dogleg[0].toUpperCase()}`)
  if (Array.isArray(hz.hazards)) {
    const counts = {}
    for (const z of hz.hazards) {
      const k = (z.type || 'haz')[0].toUpperCase() + (z.side || '')
      counts[k] = (counts[k] || 0) + 1
    }
    for (const [k, n] of Object.entries(counts)) parts.push(n > 1 ? `${k}×${n}` : k)
  }
  return parts.join(' ')
}

export default function ScorecardPreview({ holes }) {
  if (!holes || holes.length < 18) return null
  const front = holes.slice(0, 9)
  const back  = holes.slice(9, 18)
  const hasHazards = holes.some(h => h.hzDesign)
  const row = (label, fn, color = C.textMuted) => (
    <tr>
      <td style={{ color: C.textFaint, padding: '3px 4px', fontSize: 10 }}>{label}</td>
      {front.map((h, i) => <td key={i} style={{ color, padding: '3px 4px', textAlign: 'center', fontSize: 11 }}>{fn(h)}</td>)}
      <td style={{ color, padding: '3px 4px', textAlign: 'center', fontSize: 11, fontWeight: 600 }}>
        {front.reduce((s, h) => s + (Number(fn(h)) || 0), 0) || ''}
      </td>
      {back.map((h, i) => <td key={i + 9} style={{ color, padding: '3px 4px', textAlign: 'center', fontSize: 11 }}>{fn(h)}</td>)}
      <td style={{ color, padding: '3px 4px', textAlign: 'center', fontSize: 11, fontWeight: 600 }}>
        {back.reduce((s, h) => s + (Number(fn(h)) || 0), 0) || ''}
      </td>
    </tr>
  )
  const scrollRef = useRef(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const check = () => {
      setCanScrollLeft(el.scrollLeft > 4)
      setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
    }
    check()
    el.addEventListener('scroll', check, { passive: true })
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(check) : null
    ro?.observe(el)
    return () => { el.removeEventListener('scroll', check); ro?.disconnect() }
  }, [holes])

  return (
    <div style={{ position: 'relative' }}>
      {canScrollLeft && (
        <div aria-hidden style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 24, background: `linear-gradient(to right, ${C.bgCard}, transparent)`, zIndex: 1, pointerEvents: 'none' }} />
      )}
      {canScrollRight && (
        <div aria-hidden style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 24, background: `linear-gradient(to left, ${C.bgCard}, transparent)`, zIndex: 1, pointerEvents: 'none' }} />
      )}
      <div ref={scrollRef} style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 11, tableLayout: 'fixed', minWidth: 760 }}>
        <thead>
          <tr>
            <td style={{ color: C.textFaint, padding: '3px 4px', width: 36 }}>Hole</td>
            {[1,2,3,4,5,6,7,8,9].map(n => <td key={n} style={{ color: C.textFaint, padding: '3px 4px', textAlign: 'center', width: 34 }}>{n}</td>)}
            <td style={{ color: C.textFaint, padding: '3px 4px', textAlign: 'center', width: 38, fontWeight: 600 }}>Out</td>
            {[10,11,12,13,14,15,16,17,18].map(n => <td key={n} style={{ color: C.textFaint, padding: '3px 4px', textAlign: 'center', width: 34 }}>{n}</td>)}
            <td style={{ color: C.textFaint, padding: '3px 4px', textAlign: 'center', width: 38, fontWeight: 600 }}>In</td>
          </tr>
        </thead>
        <tbody>
          {row('Par', h => h.par, C.text)}
          {row('Yds', h => h.yardage, C.accent)}
          {row('HCP', h => h.handicap, C.textFaint)}
        </tbody>
      </table>
      </div>
      {hasHazards && (
        <div style={{ marginTop: 10, padding: '8px 10px', background: C.bgInput, border: `1px solid ${C.border}`, borderRadius: 8 }}>
          <div style={{ fontSize: 10, color: C.textFaint, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Yardage-book hazards (from PDF)
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 6 }}>
            {holes.map((h, i) => {
              if (!h.hzDesign) return null
              const summary = hazardSummary(h.hzDesign)
              return (
                <div key={i} style={{ fontSize: 11, color: C.text, padding: '4px 6px', background: C.bg, borderRadius: 6, border: `1px solid ${C.border}` }}>
                  <span style={{ color: C.accent, fontWeight: 600 }}>H{i + 1}</span>
                  <span style={{ color: C.textMuted, marginLeft: 6 }}>{summary || '—'}</span>
                  {h.hzDesign.green_notes && (
                    <div style={{ fontSize: 10, color: C.textFaint, marginTop: 2 }}>{h.hzDesign.green_notes}</div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
