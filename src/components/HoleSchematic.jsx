import { C, F, card, lbl } from '../theme.js'

// Tier 3 fallback: a stylized, top-down hole diagram for courses with no
// OSM polygon data. Driven entirely by scorecard + design text:
//   - par, yardage, handicap → label panel
//   - dogleg (left|right) from osmDesign.dogleg or webDesign.dogleg → fairway curve
//   - hazards: [{type, loc}] from osmDesign.hazards (loc is one of
//     left/right/front/back/front-left/back-right…) → placed along the side
//
// Explicitly NOT geo-accurate. Banner shouts "Schematic — not to scale" so the
// reader doesn't mistake it for an overlay.

const W = 320, H = 480
const TEE_Y = H - 50
const GREEN_CX = W / 2, GREEN_CY = 70
const GREEN_W = 110, GREEN_H = 70

function fairwayPath(dogleg) {
  // Tee → mid (waist) → green. Straight by default; doglegs curve at mid.
  const teeX = W / 2, midY = (TEE_Y + GREEN_CY) / 2
  if (dogleg === 'left') {
    return `M ${teeX},${TEE_Y - 10} C ${teeX + 30},${midY + 40} ${GREEN_CX + 60},${midY - 20} ${GREEN_CX},${GREEN_CY + GREEN_H / 2}`
  }
  if (dogleg === 'right') {
    return `M ${teeX},${TEE_Y - 10} C ${teeX - 30},${midY + 40} ${GREEN_CX - 60},${midY - 20} ${GREEN_CX},${GREEN_CY + GREEN_H / 2}`
  }
  return `M ${teeX},${TEE_Y - 10} L ${GREEN_CX},${GREEN_CY + GREEN_H / 2}`
}

const HAZARD_POSITIONS = {
  left:        { x: 30,            y: H / 2 + 30 },
  right:       { x: W - 30,        y: H / 2 + 30 },
  front:       { x: GREEN_CX,      y: GREEN_CY + GREEN_H / 2 + 30 },
  back:        { x: GREEN_CX,      y: GREEN_CY - GREEN_H / 2 - 20 },
  'front-left':  { x: GREEN_CX - 70, y: GREEN_CY + GREEN_H / 2 + 18 },
  'front-right': { x: GREEN_CX + 70, y: GREEN_CY + GREEN_H / 2 + 18 },
  'back-left':   { x: GREEN_CX - 60, y: GREEN_CY - GREEN_H / 2 - 10 },
  'back-right':  { x: GREEN_CX + 60, y: GREEN_CY - GREEN_H / 2 - 10 },
}

function HazardMark({ type, loc, idx }) {
  const pos = HAZARD_POSITIONS[loc] || HAZARD_POSITIONS.right
  const x = pos.x + (idx % 2 ? 14 : -14) * (idx > 1 ? 1 : 0)
  const y = pos.y
  const label = type === 'bunker' ? 'BNKR' : type === 'water' ? 'WTR' : type.toUpperCase().slice(0, 4)
  return (
    <g>
      {type === 'bunker' && <ellipse cx={x} cy={y} rx={14} ry={8} fill="#d4a94433" stroke="#d4a944" strokeWidth={1.5} />}
      {type === 'water'  && <ellipse cx={x} cy={y} rx={16} ry={9} fill="#38bdf822" stroke="#38bdf8" strokeWidth={1.5} />}
      {type === 'OB'     && <line x1={x - 14} y1={y - 8} x2={x + 14} y2={y + 8} stroke="#ef4444" strokeWidth={1.5} strokeDasharray="3 3" />}
      <text x={x} y={y - 12} textAnchor="middle" fill={C.textFaint} fontSize={8} fontFamily={F}>{label}</text>
    </g>
  )
}

export default function HoleSchematic({ hole, holeNum, par, yardage, handicap, strategyLine }) {
  if (!hole) return null
  const osm = hole.osmDesign || {}
  const web = hole.webDesign || {}
  const dogleg = osm.dogleg || (web.dogleg && web.dogleg !== 'straight' ? web.dogleg : null)
  const hazards = osm.hazards || []
  // Some web design data carries water/bunker side hints — fold those in if
  // the OSM block didn't already.
  const extraHazards = []
  if (!hazards.length) {
    if (web.water) extraHazards.push({ type: 'water', loc: web.water.includes('left') ? 'left' : web.water.includes('right') ? 'right' : 'front' })
    if (web.bunkers) {
      const t = web.bunkers
      if (/left/i.test(t))  extraHazards.push({ type: 'bunker', loc: 'left' })
      if (/right/i.test(t)) extraHazards.push({ type: 'bunker', loc: 'right' })
      if (/front/i.test(t)) extraHazards.push({ type: 'bunker', loc: 'front' })
    }
    if (web.ob) extraHazards.push({ type: 'OB', loc: /left/i.test(web.ob) ? 'left' : 'right' })
  }
  const allHazards = [...hazards, ...extraHazards]

  return (
    <div style={{ ...card, marginBottom: 14, padding: '14px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8 }}>
        <p style={{ ...lbl, margin: 0 }}>Hole {holeNum} — schematic</p>
        <span style={{ fontSize: 9, fontWeight: 600, color: C.amber, background: C.amberMuted, padding: '2px 7px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Not to scale
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 14, alignItems: 'start' }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', background: '#0c1410', borderRadius: 8 }}>
          {/* fairway corridor */}
          <path d={fairwayPath(dogleg)} stroke="#5a9e5a" strokeWidth={42} strokeLinecap="round" fill="none" opacity={0.55} />
          <path d={fairwayPath(dogleg)} stroke="#3a7d44" strokeWidth={2} fill="none" opacity={0.7} strokeDasharray="4 4" />

          {/* green */}
          <ellipse cx={GREEN_CX} cy={GREEN_CY} rx={GREEN_W / 2} ry={GREEN_H / 2} fill="#1a4d2e" stroke={C.green} strokeWidth={1.5} />
          <circle cx={GREEN_CX} cy={GREEN_CY} r={3} fill="#fff" />
          <line x1={GREEN_CX} y1={GREEN_CY} x2={GREEN_CX} y2={GREEN_CY - 14} stroke="#fff" strokeWidth={1.2} />
          <circle cx={GREEN_CX} cy={GREEN_CY - 14} r={2.5} fill={C.red} />

          {/* tee box */}
          <rect x={W / 2 - 14} y={TEE_Y - 6} width={28} height={12} rx={2} fill="#374151" stroke={C.textFaint} strokeWidth={1} />
          <text x={W / 2} y={TEE_Y + 22} textAnchor="middle" fill={C.textFaint} fontSize={9} fontFamily={F}>TEE</text>

          {/* hazards */}
          {allHazards.slice(0, 6).map((h, i) => <HazardMark key={i} type={h.type} loc={h.loc} idx={i} />)}

          {/* yardage label */}
          {yardage && (
            <text x={W - 8} y={H / 2 + 4} textAnchor="end" fill={C.textFaint} fontSize={10} fontFamily={F}>
              {yardage}y
            </text>
          )}
          {dogleg && (
            <text x={10} y={H / 2 - 10} fill={C.textMuted} fontSize={9} fontFamily={F}>
              dogleg {dogleg}
            </text>
          )}
        </svg>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
          <YardageRow label="Par" value={par} />
          <YardageRow label="Yardage" value={yardage ? `${yardage}y` : '—'} />
          <YardageRow label="Handicap" value={handicap ?? '—'} />
          {allHazards.length > 0 && (
            <div style={{ marginTop: 4 }}>
              <p style={{ ...lbl, marginBottom: 4 }}>Hazards (est.)</p>
              <ul style={{ margin: 0, paddingLeft: 14, color: C.textMuted, fontSize: 11, lineHeight: 1.5 }}>
                {allHazards.slice(0, 6).map((h, i) => (
                  <li key={i}>{h.type} {h.loc}</li>
                ))}
              </ul>
            </div>
          )}
          {strategyLine && (
            <p style={{ fontSize: 11, color: C.green, margin: '4px 0 0', lineHeight: 1.45 }}>
              {strategyLine}
            </p>
          )}
          <p style={{ fontSize: 10, color: C.textFaint, margin: '4px 0 0', fontStyle: 'italic' }}>
            Tier 3 — design data is estimated from scorecards and web sources.
          </p>
        </div>
      </div>
    </div>
  )
}

function YardageRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: `1px solid ${C.border}`, padding: '4px 0' }}>
      <span style={{ fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{value}</span>
    </div>
  )
}
