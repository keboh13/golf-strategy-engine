import { useEffect, useState } from 'react'
import { C, F } from '../theme.js'
import { polygonToSvgPath } from '../lib/greenGeometry.js'

export default function GreenView({ green, holeNum }) {
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape' && fullscreen) setFullscreen(false) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [fullscreen])

  if (!green) return null
  const FIXED_W = 320, FIXED_H = 290
  const cx = FIXED_W / 2, cy = 135

  // Compute the rendered green's bounding box in pixels. When a real polygon
  // is available (OSM-derived via mergeGreen → greenGeometry.extractGreenForHole),
  // use its exact outline. Otherwise fall back to a schematic shape scaled by
  // green.width_y / green.depth_y (yards).
  let greenPath
  let greenW, greenH
  const usingRealPolygon = Array.isArray(green.polygonRingM) && green.polygonRingM.length >= 3

  if (usingRealPolygon) {
    // Path is centred around (FIXED_W/2, FIXED_H/2). Re-anchor at our cy.
    const path = polygonToSvgPath(green.polygonRingM, FIXED_W, 220, 14)
    greenPath = shiftPathY(path, cy - FIXED_H / 2)
    // Approximate width/depth in pixels for hazard/pin positioning. Same uniform
    // scale used in polygonToSvgPath (preserves aspect).
    const dims = ringPixelDims(green.polygonRingM, FIXED_W, 220, 14)
    greenW = dims.w
    greenH = dims.h
  } else {
    // Schematic mode: scale a template shape by the AI-supplied yardages so
    // the green at least reflects the dimensions we do know (the old code
    // hardcoded greenW=140, greenH=100 regardless).
    const wY = clampNum(green.width_y, 12, 60, 24)
    const dY = clampNum(green.depth_y, 12, 60, 28)
    const maxW = 220, maxH = 150
    const pxPerY = Math.min(maxW / wY, maxH / dY)
    greenW = Math.round(wY * pxPerY)
    greenH = Math.round(dY * pxPerY)

    const shapes = {
      kidney: (cx, cy, w, h) => {
        const hw = w / 2, hh = h / 2
        return `M${cx - hw},${cy} C${cx - hw},${cy - hh * 1.1} ${cx - hw * 0.3},${cy - hh} ${cx},${cy - hh} C${cx + hw * 0.5},${cy - hh} ${cx + hw},${cy - hh * 0.7} ${cx + hw},${cy - hh * 0.2} C${cx + hw},${cy + hh * 0.3} ${cx + hw * 0.6},${cy + hh} ${cx},${cy + hh} C${cx - hw * 0.4},${cy + hh} ${cx - hw},${cy + hh * 0.6} ${cx - hw},${cy} Z`
      },
      oval: (cx, cy, w, h) => {
        const hw = w / 2, hh = h / 2
        return `M${cx},${cy - hh} C${cx + hw},${cy - hh} ${cx + hw},${cy + hh} ${cx},${cy + hh} C${cx - hw},${cy + hh} ${cx - hw},${cy - hh} ${cx},${cy - hh} Z`
      },
      round: (cx, cy, w, h) => {
        const r = Math.min(w, h) / 2
        return `M${cx},${cy - r} A${r},${r} 0 1,1 ${cx},${cy + r} A${r},${r} 0 1,1 ${cx},${cy - r} Z`
      },
      oblong: (cx, cy, w, h) => {
        const hw = w / 2, hh = h / 2, r = Math.min(hw, hh * 0.5)
        return `M${cx - hw + r},${cy - hh} L${cx + hw - r},${cy - hh} A${r},${r} 0 0,1 ${cx + hw},${cy - hh + r} L${cx + hw},${cy + hh - r} A${r},${r} 0 0,1 ${cx + hw - r},${cy + hh} L${cx - hw + r},${cy + hh} A${r},${r} 0 0,1 ${cx - hw},${cy + hh - r} L${cx - hw},${cy - hh + r} A${r},${r} 0 0,1 ${cx - hw + r},${cy - hh} Z`
      },
    }
    const shapeFn = shapes[green.shape] || shapes.oval
    greenPath = shapeFn(cx, cy, greenW, greenH)
  }

  const pinPositions = {
    'front-right': { x: cx + greenW * 0.2, y: cy + greenH * 0.3 },
    'front-left':  { x: cx - greenW * 0.2, y: cy + greenH * 0.3 },
    'back-right':  { x: cx + greenW * 0.2, y: cy - greenH * 0.3 },
    'back-left':   { x: cx - greenW * 0.2, y: cy - greenH * 0.3 },
    'center':      { x: cx, y: cy },
    'center-right':{ x: cx + greenW * 0.2, y: cy },
    'center-left': { x: cx - greenW * 0.2, y: cy },
  }
  const pin = pinPositions[green.pin] || pinPositions.center

  const hazardElems = (green.hazards || []).map((hz, i) => {
    const locs = {
      'left':        { x: cx - greenW / 2 - 22, y: cy },
      'right':       { x: cx + greenW / 2 + 22, y: cy },
      'front':       { x: cx, y: cy + greenH / 2 + 22 },
      'back':        { x: cx, y: cy - greenH / 2 - 22 },
      'front-left':  { x: cx - greenW / 2 - 12, y: cy + greenH / 2 + 8 },
      'front-right': { x: cx + greenW / 2 + 12, y: cy + greenH / 2 + 8 },
      'back-left':   { x: cx - greenW / 2 - 12, y: cy - greenH / 2 - 8 },
      'back-right':  { x: cx + greenW / 2 + 12, y: cy - greenH / 2 - 8 },
    }
    const pos = locs[hz.loc] || locs.right
    return (
      <g key={i}>
        {hz.type === 'bunker' && <ellipse cx={pos.x} cy={pos.y} rx={16} ry={10} fill="#d4a94433" stroke="#d4a944" strokeWidth={1.5} />}
        {hz.type === 'water' && <ellipse cx={pos.x} cy={pos.y} rx={18} ry={10} fill="#38bdf822" stroke="#38bdf8" strokeWidth={1.5} />}
        {hz.type === 'false_front' && <line x1={pos.x - 18} y1={pos.y} x2={pos.x + 18} y2={pos.y} stroke="#f59e0b" strokeWidth={2} strokeDasharray="4 3" />}
        {hz.type === 'mound' && <ellipse cx={pos.x} cy={pos.y} rx={12} ry={8} fill="none" stroke="#8b8fa8" strokeWidth={1.5} strokeDasharray="3 2" />}
        {hz.carry_y && <text x={pos.x} y={pos.y + 18} textAnchor="middle" fill={C.textMuted} fontSize={9} fontFamily={F}>{hz.carry_y}y</text>}
        <text x={pos.x} y={pos.y - 14} textAnchor="middle" fill={C.textFaint} fontSize={8} fontFamily={F}>{hz.type === 'false_front' ? 'false front' : hz.type}</text>
      </g>
    )
  })

  const tierCount = green.tiers || 0
  const sourceTag = green._source === 'osm+ai' ? 'real shape'
    : green._source === 'osm' ? 'real shape'
    : null

  const inner = (
    <div style={fullscreen
      ? { position: 'fixed', inset: 0, zIndex: 1001, background: C.bg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24 }
      : { background: C.bgInput, borderRadius: 10, padding: '12px 8px', marginTop: 10 }
    }>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, padding: '0 8px', width: '100%' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Green — Hole {holeNum}</span>
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {sourceTag && <span style={{ fontSize: 9, fontWeight: 600, color: C.green, background: '#1a4d2e55', padding: '1px 6px', borderRadius: 4 }}>{sourceTag}</span>}
          {tierCount > 0 && <span style={{ fontSize: 10, fontWeight: 600, color: C.amber, background: C.amberMuted, padding: '1px 6px', borderRadius: 4 }}>{tierCount}-tier</span>}
          <button
            onClick={() => setFullscreen(f => !f)}
            title={fullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'}
            style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 4, color: C.textMuted, fontSize: 13, cursor: 'pointer', padding: '1px 5px', lineHeight: 1, fontFamily: F }}
          >{fullscreen ? '⊠' : '⛶'}</button>
        </span>
      </div>
      <svg viewBox={`0 0 ${FIXED_W} ${FIXED_H}`} width="100%" style={{ display: 'block' }}>
        <path d={greenPath} fill="#1a4d2e" stroke={C.green} strokeWidth={1.5} />

        {tierCount >= 2 && <line x1={cx - greenW * 0.35} y1={cy} x2={cx + greenW * 0.35} y2={cy} stroke={C.textFaint} strokeWidth={0.8} strokeDasharray="6 3" opacity={0.6} />}
        {tierCount >= 3 && <line x1={cx - greenW * 0.3} y1={cy - greenH * 0.25} x2={cx + greenW * 0.3} y2={cy - greenH * 0.25} stroke={C.textFaint} strokeWidth={0.8} strokeDasharray="6 3" opacity={0.6} />}

        <line x1={cx - greenW / 2 - 16} y1={cy - greenH / 2} x2={cx - greenW / 2 - 16} y2={cy + greenH / 2} stroke={C.textFaint} strokeWidth={0.5} />
        <line x1={cx - greenW / 2 - 20} y1={cy - greenH / 2} x2={cx - greenW / 2 - 12} y2={cy - greenH / 2} stroke={C.textFaint} strokeWidth={0.5} />
        <line x1={cx - greenW / 2 - 20} y1={cy + greenH / 2} x2={cx - greenW / 2 - 12} y2={cy + greenH / 2} stroke={C.textFaint} strokeWidth={0.5} />
        <text x={cx - greenW / 2 - 22} y={cy + 3} textAnchor="end" fill={C.textFaint} fontSize={9} fontFamily={F}>{green.depth_y || '?'}y</text>

        <line x1={cx - greenW / 2} y1={cy + greenH / 2 + 14} x2={cx + greenW / 2} y2={cy + greenH / 2 + 14} stroke={C.textFaint} strokeWidth={0.5} />
        <line x1={cx - greenW / 2} y1={cy + greenH / 2 + 10} x2={cx - greenW / 2} y2={cy + greenH / 2 + 18} stroke={C.textFaint} strokeWidth={0.5} />
        <line x1={cx + greenW / 2} y1={cy + greenH / 2 + 10} x2={cx + greenW / 2} y2={cy + greenH / 2 + 18} stroke={C.textFaint} strokeWidth={0.5} />
        <text x={cx} y={cy + greenH / 2 + 26} textAnchor="middle" fill={C.textFaint} fontSize={9} fontFamily={F}>{green.width_y || '?'}y wide</text>

        <line x1={pin.x} y1={pin.y} x2={pin.x} y2={pin.y - 18} stroke="#fff" strokeWidth={1.5} />
        <circle cx={pin.x} cy={pin.y - 18} r={3} fill={C.red} />
        <circle cx={pin.x} cy={pin.y} r={2} fill="#fff" />

        {green.slope && green.slope !== 'flat' && (() => {
          const arrowId = `arrow-${holeNum}`
          const dirs = {
            'back-to-front':  { x1: cx + greenW * 0.3, y1: cy - greenH * 0.2, x2: cx + greenW * 0.3, y2: cy + greenH * 0.2 },
            'front-to-back':  { x1: cx + greenW * 0.3, y1: cy + greenH * 0.2, x2: cx + greenW * 0.3, y2: cy - greenH * 0.2 },
            'left-to-right':  { x1: cx - greenW * 0.15, y1: cy + greenH * 0.35, x2: cx + greenW * 0.15, y2: cy + greenH * 0.35 },
            'right-to-left':  { x1: cx + greenW * 0.15, y1: cy + greenH * 0.35, x2: cx - greenW * 0.15, y2: cy + greenH * 0.35 },
          }
          const d = dirs[green.slope]
          if (!d) return null
          return (
            <g>
              <defs><marker id={arrowId} markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto"><polygon points="0 0, 6 2, 0 4" fill={C.textFaint} /></marker></defs>
              <line {...d} stroke={C.textFaint} strokeWidth={1} markerEnd={`url(#${arrowId})`} />
              <text x={(d.x1 + d.x2) / 2 + 10} y={(d.y1 + d.y2) / 2 + 3} fill={C.textFaint} fontSize={8} fontFamily={F}>slope</text>
            </g>
          )
        })()}

        {hazardElems}

        <polygon points={`${cx - 4},${FIXED_H - 8} ${cx + 4},${FIXED_H - 8} ${cx},${FIXED_H - 16}`} fill={C.textFaint} />
        <text x={cx} y={FIXED_H - 2} textAnchor="middle" fill={C.textFaint} fontSize={8} fontFamily={F}>approach</text>
      </svg>
      <div style={{ padding: '4px 8px 0', display: 'flex', flexDirection: 'column', gap: 2, width: '100%' }}>
        {green.confidence && green.confidence !== 'verified' && !sourceTag && (
          <p style={{ fontSize: 9, color: C.amber, margin: 0, fontStyle: 'italic' }}>
            Green data is estimated — verify with course knowledge
          </p>
        )}
        {green.slope && green.slope !== 'flat' && <p style={{ fontSize: 10, color: C.textFaint, margin: 0 }}>Slope: {green.slope.replace(/-/g, ' → ').replace(/to →/, '→')}</p>}
        {green.tier_desc && <p style={{ fontSize: 10, color: C.amber, margin: 0 }}>Tiers: {green.tier_desc}</p>}
        {green.green_notes && <p style={{ fontSize: 10, color: C.green, margin: 0, fontStyle: 'italic' }}>{green.green_notes}</p>}
      </div>
    </div>
  )

  if (!fullscreen) return inner
  return (
    <>
      {/* Placeholder to preserve layout space when fullscreen */}
      <div style={{ background: C.bgInput, borderRadius: 10, padding: '12px 8px', marginTop: 10, opacity: 0.3, pointerEvents: 'none' }}>
        <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 12, color: C.textFaint }}>Green view — fullscreen</span>
        </div>
      </div>
      {inner}
    </>
  )
}

function clampNum(v, min, max, fallback) {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

// Re-anchor a path generated around viewport-centre Y onto our cy.
function shiftPathY(path, dy) {
  if (!path) return path
  return path.replace(/([ML])\s*(-?\d+\.?\d*),(-?\d+\.?\d*)/g,
    (_, cmd, x, y) => `${cmd}${x},${(Number(y) + dy).toFixed(2)}`)
}

function ringPixelDims(ring, viewW, viewH, margin) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const [x, y] of ring) {
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
  }
  const wM = Math.max(maxX - minX, 0.01)
  const hM = Math.max(maxY - minY, 0.01)
  const scale = Math.min((viewW - 2 * margin) / wM, (viewH - 2 * margin) / hM)
  return { w: wM * scale, h: hM * scale }
}
