import { C, F } from '../theme.js'

/**
 * HoleDiagram — schematic yardage-book-style SVG diagram of a hole.
 *
 * Two rendering modes:
 *   1. Rich mode (hazard data available via hole.hzDesign or hole.osmDesign):
 *      full diagram with hazard markers, carry distances, dogleg direction.
 *   2. Basic/estimated mode (no hazard data): simple fairway shape based on
 *      par and yardage — always renders as long as par + yardage exist.
 *
 * Props: { hole, holeNum }
 */
export default function HoleDiagram({ hole, holeNum }) {
  if (!hole) return null

  const par = hole.par || 4
  const yardage = parseInt(hole.yardage, 10) || null

  // Merge hazard sources: prefer hzDesign (yardage-book extracted), fall back to osmDesign
  const design = hole.hzDesign || hole.osmDesign || null
  const hazards = design?.hazards || []
  const dogleg = design?.dogleg || null

  const VB_W = 320
  const VB_H = 480

  // Fairway dimensions scale with par
  const fairwayWidths = { 3: 50, 4: 60, 5: 55 }
  const fw = fairwayWidths[par] || 60

  // Tee and green positions
  const teeY = VB_H - 50
  const greenY = 60
  const cx = VB_W / 2

  // Green dimensions — use osmDesign if available, else defaults by par
  const defaultGreenW = { 3: 50, 4: 55, 5: 60 }
  const defaultGreenD = { 3: 40, 4: 45, 5: 50 }
  const greenW = design?.greenWidth ? Math.min(design.greenWidth * 2, 80) : (defaultGreenW[par] || 55)
  const greenD = design?.greenDepth ? Math.min(design.greenDepth * 2, 70) : (defaultGreenD[par] || 45)

  // Build fairway path
  const fairwayPath = buildFairwayPath(cx, teeY, greenY, fw, par, dogleg)

  // Position hazards along the hole
  const hazardElements = hazards.map((hz, i) => {
    const pos = hazardPosition(hz, cx, teeY, greenY, fw, par)
    return renderHazard(hz, pos, i)
  })

  // Yardage markers along the side
  const yardageMarkers = yardage ? buildYardageMarkers(yardage, par, cx, teeY, greenY, fw) : []

  return (
    <div style={{ background: C.bgInput, borderRadius: 10, padding: '10px 8px', marginTop: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, padding: '0 8px' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Hole {holeNum} — Par {par}
        </span>
        {yardage && (
          <span style={{ fontSize: 12, fontWeight: 700, color: C.text }}>
            {yardage} yds
          </span>
        )}
      </div>
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        width="100%"
        style={{ display: 'block', maxWidth: 320 }}
      >
        {/* Rough / background */}
        <rect x={0} y={0} width={VB_W} height={VB_H} fill="#0d1a12" rx={8} />

        {/* Fairway */}
        <path d={fairwayPath} fill="#1a4d2e" stroke="#2a6e3e" strokeWidth={1} />

        {/* Green */}
        <ellipse
          cx={cx + (dogleg === 'left' ? -15 : dogleg === 'right' ? 15 : 0)}
          cy={greenY}
          rx={greenW / 2}
          ry={greenD / 2}
          fill="#1f6b3a"
          stroke={C.green}
          strokeWidth={1.5}
        />
        {/* Pin flag on green */}
        <line
          x1={cx + (dogleg === 'left' ? -15 : dogleg === 'right' ? 15 : 0)}
          y1={greenY}
          x2={cx + (dogleg === 'left' ? -15 : dogleg === 'right' ? 15 : 0)}
          y2={greenY - 18}
          stroke="#fff"
          strokeWidth={1.5}
        />
        <circle
          cx={cx + (dogleg === 'left' ? -15 : dogleg === 'right' ? 15 : 0)}
          cy={greenY - 18}
          r={3}
          fill={C.red}
        />
        <text
          x={cx + (dogleg === 'left' ? -15 : dogleg === 'right' ? 15 : 0)}
          y={greenY - 26}
          textAnchor="middle"
          fill={C.textMuted}
          fontSize={9}
          fontFamily={F}
        >
          GREEN
        </text>

        {/* Tee box */}
        <rect
          x={cx - 18}
          y={teeY - 6}
          width={36}
          height={12}
          rx={3}
          fill="#2a4a2e"
          stroke={C.textFaint}
          strokeWidth={1}
        />
        <text
          x={cx}
          y={teeY + 20}
          textAnchor="middle"
          fill={C.textMuted}
          fontSize={9}
          fontFamily={F}
        >
          TEE
        </text>

        {/* Total yardage label */}
        {yardage && (
          <text
            x={cx}
            y={teeY + 38}
            textAnchor="middle"
            fill={C.text}
            fontSize={14}
            fontWeight={700}
            fontFamily={F}
          >
            {yardage} yds
          </text>
        )}

        {/* Dogleg arrow indicator */}
        {dogleg && (
          <g>
            <text
              x={dogleg === 'left' ? 30 : VB_W - 30}
              y={(teeY + greenY) / 2}
              textAnchor="middle"
              fill={C.amber}
              fontSize={9}
              fontFamily={F}
            >
              {dogleg === 'left' ? '◄' : '►'} dogleg {dogleg}
            </text>
          </g>
        )}

        {/* Hazard markers */}
        {hazardElements}

        {/* Yardage markers along the side */}
        {yardageMarkers}
      </svg>
      {!hazards.length && (
        <p style={{ fontSize: 9, color: C.textFaint, margin: '6px 8px 0', fontStyle: 'italic' }}>
          Estimated layout — no hazard data available
        </p>
      )}
    </div>
  )
}

function buildFairwayPath(cx, teeY, greenY, fw, par, dogleg) {
  const hw = fw / 2
  const totalLen = teeY - greenY

  if (par === 3) {
    // Short straight fairway
    return `M${cx - hw * 0.7},${teeY - 12} L${cx - hw * 0.9},${greenY + 30} L${cx + hw * 0.9},${greenY + 30} L${cx + hw * 0.7},${teeY - 12} Z`
  }

  if (dogleg === 'left') {
    const bendY = greenY + totalLen * 0.45
    return `M${cx - hw},${teeY - 12} ` +
      `C${cx - hw},${bendY + 40} ${cx - hw - 35},${bendY} ${cx - hw - 30},${greenY + 30} ` +
      `L${cx + hw - 30},${greenY + 30} ` +
      `C${cx + hw - 25},${bendY} ${cx + hw},${bendY + 40} ${cx + hw},${teeY - 12} Z`
  }

  if (dogleg === 'right') {
    const bendY = greenY + totalLen * 0.45
    return `M${cx - hw},${teeY - 12} ` +
      `C${cx - hw},${bendY + 40} ${cx - hw + 25},${bendY} ${cx - hw + 30},${greenY + 30} ` +
      `L${cx + hw + 30},${greenY + 30} ` +
      `C${cx + hw + 35},${bendY} ${cx + hw},${bendY + 40} ${cx + hw},${teeY - 12} Z`
  }

  // Straight par 4 / par 5
  const taperTop = par === 5 ? 0.85 : 0.9
  return `M${cx - hw},${teeY - 12} L${cx - hw * taperTop},${greenY + 30} L${cx + hw * taperTop},${greenY + 30} L${cx + hw},${teeY - 12} Z`
}

function hazardPosition(hz, cx, teeY, greenY, fw, par) {
  const hw = fw / 2
  const totalLen = teeY - greenY
  // Determine vertical position
  const locStr = hz.loc || hz.side || ''
  let y, x

  if (locStr.includes('front')) {
    y = greenY + totalLen * 0.15
  } else if (locStr.includes('back')) {
    y = greenY - 10
  } else {
    // Default: middle area
    y = greenY + totalLen * 0.35
  }

  if (locStr.includes('left')) {
    x = cx - hw - 25
  } else if (locStr.includes('right')) {
    x = cx + hw + 25
  } else if (locStr === 'front') {
    x = cx
    y = greenY + totalLen * 0.12
  } else if (locStr === 'back') {
    x = cx
    y = greenY - 15
  } else {
    // Center-ish default
    x = cx + hw + 20
  }

  return { x, y }
}

function renderHazard(hz, pos, idx) {
  const type = hz.type || 'bunker'
  const carry = hz.carry_yards || null

  if (type === 'water') {
    return (
      <g key={idx}>
        <ellipse cx={pos.x} cy={pos.y} rx={20} ry={10} fill="#38bdf822" stroke={C.blue} strokeWidth={1.5} />
        <text x={pos.x} y={pos.y - 14} textAnchor="middle" fill={C.blue} fontSize={8} fontFamily={F}>water</text>
        {carry && (
          <text x={pos.x} y={pos.y + 18} textAnchor="middle" fill={C.textMuted} fontSize={9} fontFamily={F}>{carry}y carry</text>
        )}
      </g>
    )
  }

  if (type === 'ob' || type === 'OB') {
    return (
      <g key={idx}>
        <line x1={pos.x - 15} y1={pos.y - 12} x2={pos.x - 15} y2={pos.y + 12} stroke={C.red} strokeWidth={2} strokeDasharray="4 3" />
        <text x={pos.x - 15} y={pos.y - 16} textAnchor="middle" fill={C.red} fontSize={8} fontFamily={F}>OB</text>
      </g>
    )
  }

  // Default: bunker
  return (
    <g key={idx}>
      <ellipse cx={pos.x} cy={pos.y} rx={18} ry={10} fill="#d4a94433" stroke={C.amber} strokeWidth={1.5} />
      <text x={pos.x} y={pos.y - 14} textAnchor="middle" fill={C.amber} fontSize={8} fontFamily={F}>bunker</text>
      {carry && (
        <text x={pos.x} y={pos.y + 18} textAnchor="middle" fill={C.textMuted} fontSize={9} fontFamily={F}>{carry}y carry</text>
      )}
    </g>
  )
}

function buildYardageMarkers(yardage, par, cx, teeY, greenY, fw) {
  const markers = []
  const hw = fw / 2
  const totalLen = teeY - greenY

  // Place 150-yard marker and par-dependent intermediate markers
  const intervals = []
  if (par >= 4 && yardage > 200) intervals.push(150)
  if (par === 5 && yardage > 350) intervals.push(250)
  if (yardage > 150) intervals.push(100)

  for (const dist of intervals) {
    if (dist >= yardage) continue
    const ratio = dist / yardage
    const y = teeY - 12 - ratio * totalLen
    const xLeft = cx - hw - 8

    markers.push(
      <g key={`yd-${dist}`}>
        <line x1={cx - hw + 5} y1={y} x2={cx + hw - 5} y2={y} stroke={C.textFaint} strokeWidth={0.5} strokeDasharray="4 3" opacity={0.6} />
        <text x={xLeft} y={y + 3} textAnchor="end" fill={C.textFaint} fontSize={9} fontFamily={F}>{dist}y</text>
      </g>
    )
  }

  return markers
}
