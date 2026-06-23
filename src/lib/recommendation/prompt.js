// Recommendation prompt assembly.
//
// Pure: (inputs) → string. Easier to test and reason about than the inline
// builder in App.jsx. Wires together:
//   - club bag section (existing promptSections.buildBagSection)
//   - history summary (history.summarizeHistory + renderHistoryBlock)
//   - per-hole context: weather, design data, elevation-adjusted yardage,
//     wind decomposition, dispersion-vs-hazard overlaps, confidence tags
//   - confidence-aware data accuracy section
//
// The result is a single user-content string. Tone/instructions match what
// buildPrompt previously emitted, so the LLM behavior is comparable; the new
// content adds pre-computed math the LLM no longer has to guess at.

import { buildBagSection } from '../promptSections.js'
import { decomposeWind } from './wind.js'
import { effectiveYardage } from './elevation.js'
import { tee_shot_overlaps, formatOverlapLine } from './dispersion.js'
import { holeConfidence, rollupConfidence } from './confidence.js'
import { summarizeHistory, renderHistoryBlock } from './history.js'
import { formatDistancesLine } from '../courseGeometry.js'

const windCompassFromDeg = (deg) => {
  if (!Number.isFinite(deg)) return ''
  const labels = ['N','NE','E','SE','S','SW','W','NW']
  const idx = Math.round((((deg % 360) + 360) % 360) / 45) % 8
  return labels[idx]
}

function formatStructuredMiss(miss) {
  // miss can be a string (legacy) or { shape, magnitudeYds, trigger }
  if (!miss) return null
  if (typeof miss === 'string') return miss
  if (typeof miss !== 'object') return null
  const parts = []
  if (miss.shape) parts.push(miss.shape)
  if (Number.isFinite(miss.magnitudeYds) && miss.magnitudeYds > 0) parts.push(`~${miss.magnitudeYds}y`)
  if (miss.trigger) parts.push(`under ${miss.trigger}`)
  if (miss.notes) parts.push(miss.notes)
  return parts.join(', ') || null
}

// Find the driver/longest-club stats for tee-shot dispersion math.
function pickTeeClubStats(clubs) {
  if (!Array.isArray(clubs)) return null
  const driver = clubs.find(c => /driver/i.test(c.club || ''))
  const target = driver || clubs[0]
  if (!target) return null
  const stats = target.stats
  if (!stats || !Number.isFinite(stats.samples) || stats.samples < 3) {
    // Fall back to legacy fields if no imported stats
    const carryYds = Number.isFinite(target.carry) ? target.carry : null
    const dispLeft = Number.isFinite(target.dispLeft) ? target.dispLeft : 0
    const dispRight = Number.isFinite(target.dispRight) ? target.dispRight : 0
    const lateralSigmaYds = (dispLeft + dispRight) > 0 ? (dispLeft + dispRight) / 2 : null
    return carryYds ? {
      clubLabel: target.club,
      carryYds,
      offlineBiasYds: 0,
      lateralSigmaYds,
    } : null
  }
  const carryYds = stats.carryP50 ?? stats.carryAvg ?? target.carry
  const sigma = Number.isFinite(stats.offlineStd) ? stats.offlineStd
              : Number.isFinite(stats.dispLeftP80) && Number.isFinite(stats.dispRightP80)
                ? (stats.dispLeftP80 + stats.dispRightP80) / 2 / 1.28   // ~P80 → sigma
                : null
  return {
    clubLabel: target.club,
    carryYds,
    offlineBiasYds: Number.isFinite(stats.offlineBias) ? stats.offlineBias : 0,
    lateralSigmaYds: sigma,
  }
}

function buildHoleLine(i, h, ctx) {
  const time = ctx.holeTimes?.[i]?.toLocaleTimeString?.([], { hour: '2-digit', minute: '2-digit' }) || ''
  const w = ctx.holeWeather?.[i]
  const bearing = h.osmDesign?.bearingDeg
  const wind = w ? decomposeWind({ windDir: w.windDir, windSpeed: w.windSpeed, bearingDeg: bearing }) : null
  const wStr = w
    ? ` | ~${time}: ${Math.round(w.temp)}°F, ${windCompassFromDeg(w.windDir)} ${Math.round(w.windSpeed)}mph` +
      (wind ? ` (${wind.label})` : '') +
      `, ${w.precip}% rain`
    : ''

  // Elevation-adjusted effective yardage
  const rawYds = parseInt(h.yardage) || null
  const courseElev = parseInt(ctx.course?.elevation) || null
  const holeElev = parseInt(h.elevation) || null
  const eff = rawYds ? effectiveYardage({
    rawYds,
    courseElevationFt: courseElev,
    holeDeltaFt: holeElev,
  }) : null
  const effStr = eff && eff.deltaYds !== 0
    ? ` (plays ${eff.effectiveYds}y — ${eff.label})`
    : ''

  // Design data string (osm > yardage-book > web)
  let designStr = ''
  if (h.osmDesign) {
    const parts = []
    if (h.osmDesign.dogleg) parts.push(`dogleg ${h.osmDesign.dogleg}`)
    if (h.osmDesign.bearingDeg != null) parts.push(`bearing ${h.osmDesign.bearingDeg}°`)
    if (h.osmDesign.hazards?.length) {
      parts.push('hazards: ' + h.osmDesign.hazards.map(hz => `${hz.type} ${hz.loc}`).join(', '))
    }
    if (h.osmDesign.greenWidth) parts.push(`green ~${h.osmDesign.greenWidth}y wide × ${h.osmDesign.greenDepth}y deep`)
    if (h.osmDesign.distances) {
      const d = h.osmDesign.distances
      parts.push(`tee→pin ${d.teeToPin}y`)
      const distLine = formatDistancesLine(d)
      if (distLine) parts.push(distLine)
    }
    if (parts.length) designStr = ` | Design (OSM verified): ${parts.join('; ')}`
  } else if (h.webDesign) {
    const parts = []
    if (h.webDesign.dogleg && h.webDesign.dogleg !== 'straight') parts.push(`dogleg ${h.webDesign.dogleg}`)
    if (h.webDesign.water) parts.push(`water: ${h.webDesign.water}`)
    if (h.webDesign.bunkers) parts.push(`bunkers: ${h.webDesign.bunkers}`)
    if (h.webDesign.ob) parts.push(`OB ${h.webDesign.ob}`)
    if (h.webDesign.green_notes) parts.push(`green: ${h.webDesign.green_notes}`)
    if (parts.length) designStr = ` | Design (web search — use with moderate confidence): ${parts.join('; ')}`
  }

  let yardageBookText = ''
  if (h.hzDesign) {
    const hz = h.hzDesign
    const parts = []
    if (hz.dogleg && hz.dogleg !== 'straight') parts.push(`dogleg ${hz.dogleg}`)
    if (Array.isArray(hz.hazards) && hz.hazards.length) {
      parts.push('hazards: ' + hz.hazards.map(z => {
        const carry = z.carry_yards ? ` carry ${z.carry_yards}y` : ''
        const note = z.notes ? ` (${z.notes})` : ''
        return `${z.type} ${z.side}${carry}${note}`
      }).join(', '))
    }
    if (hz.greenDepth) parts.push(`green depth ${hz.greenDepth}y`)
    if (hz.green_notes) parts.push(`green: ${hz.green_notes}`)
    if (hz.recommended_line) parts.push(`line: ${hz.recommended_line}`)
    if (parts.length) {
      const confLabel = hz._confidence === 'high' ? 'high confidence' : hz._confidence === 'low' ? 'low confidence' : 'verified-by-image'
      designStr += ` | Design (yardage book — ${confLabel}): ${parts.join('; ')}`
    }
    if (hz.holeName) yardageBookText += ` | "${hz.holeName}"`
    if (hz.description) yardageBookText += `\n   Book: ${hz.description}`
    if (hz.visualNotes) yardageBookText += `\n   Diagram: ${hz.visualNotes}`
    if (Array.isArray(hz.distanceMarkers) && hz.distanceMarkers.length) {
      yardageBookText += `\n   Distances: ${hz.distanceMarkers.map(d => `${d.label} ${d.yards}y`).join('; ')}`
    }
  }

  // Dispersion-vs-hazard overlap (driver/tee-shot only for now)
  const allHazards = [
    ...(h.hzDesign?.hazards || []),
    ...(h.osmDesign?.hazards || []).map(hz => ({ type: hz.type, side: hz.loc, carry_yards: null })),
  ]
  const overlapLine = ctx.teeClubStats
    ? formatOverlapLine(ctx.teeClubStats.clubLabel, tee_shot_overlaps({
        hazards: allHazards,
        clubStats: ctx.teeClubStats,
        threshold: 0.10,
      }))
    : null
  const overlapStr = overlapLine ? `\n   Risk: ${overlapLine}` : ''

  // Confidence tag
  const conf = holeConfidence(ctx.course, h)
  const confStr = ` | conf:${conf.overall}/${conf.hazards}`

  const nStr = h.notes ? ` | Note: ${h.notes}` : (!designStr ? ' | Note: no design data — do not assume hazards' : '')

  const elevHdr = h.elevation ? ` | Elev: ${h.elevation}` : ''

  return `H${i+1}: Par ${h.par}, ${h.yardage || '?'}y${effStr}, HCP ${h.handicap}${elevHdr}${confStr}${designStr}${nStr}${wStr}${yardageBookText}${overlapStr}`
}

/**
 * Build the recommendation prompt. Pure function.
 * Returns { prompt, meta } where meta is useful for logging (course handicap,
 * confidence rollup, etc.).
 */
export function buildRecommendationPrompt(inputs) {
  const {
    playerInfo,
    clubs,
    course,
    holeTimes = [],
    holeWeather = [],
    teeTime,
    teeDate,
    pace,
    scoringHistory,
    style = 'balanced',           // 'balanced' | 'conservative' | 'aggressive'
    nowMs,
  } = inputs

  const clubList = buildBagSection(clubs)
  const summary = summarizeHistory(scoringHistory, { nowMs })
  const historyBlock = renderHistoryBlock(summary)

  const handicapIndex = parseFloat(playerInfo?.handicap) || 0
  const slopeVal = parseFloat(course?.slope) || 113
  const ratingVal = parseFloat(course?.rating) || 72
  const coursePar = course?.par || 72
  const courseHandicap = Math.round(handicapIndex * (slopeVal / 113) + (ratingVal - coursePar))
  const isLefty = (playerInfo?.handedness || 'Right') === 'Left'
  const handLabel = isLefty ? 'LEFT-HANDED' : 'RIGHT-HANDED'
  const missStr = formatStructuredMiss(playerInfo?.miss)

  const playerBlock = `PLAYER: ${playerInfo?.name || 'Player'}, ${handLabel} golfer
Handicap Index: ${playerInfo?.handicap || '?'} (USGA/GHIN — portable number, NOT strokes given)${course?.name ? `\nCourse Handicap: ${courseHandicap} (Index × Slope÷113 + Rating−Par)` : ''}
Miss tendency: ${missStr || 'unspecified'} | Ball flight: ${playerInfo?.ballFlight || 'unspecified'}
${playerInfo?.swingNotes ? `Swing notes: ${playerInfo.swingNotes}` : ''}
${playerInfo?.goals ? `Goals: ${playerInfo.goals}` : ''}
${playerInfo?.strengths ? `Strengths: ${playerInfo.strengths}` : ''}

CRITICAL — HANDEDNESS: This player is ${handLabel}. ${isLefty
    ? 'A fade for a lefty curves LEFT; a draw for a lefty curves RIGHT.'
    : 'A fade for a righty curves RIGHT; a draw for a righty curves LEFT.'}

BAG (carry distances):
${clubList}`

  if (!course?.name) {
    return {
      prompt: `You are an elite Tour caddy. The player has no course loaded — give a profile-only brief.

${playerBlock}
${historyBlock}

## Current form
Where the game is now. Use actual numbers.

## Where shots are leaking
2-3 sources of dropped shots from par-type averages and tendencies.

## Pattern to watch
Front/back splits, pressure patterns, recent trends.

## Focus areas for next round
2-3 specific actionable points tied to actual data.

## Pre-shot questions
3-4 strategic questions for this player's tendencies.

Be direct. Short sentences. No filler.`,
      meta: { courseHandicap, mode: 'profile_only' },
    }
  }

  const isPractice = course.roundType === 'Practice round'
  const isMatchPlay = course.roundType === 'Match play'
  const hasOSMData = course.osmEnriched && course.holes?.some(h => h.osmDesign)
  const hasWebDesign = course.holes?.some(h => h.webDesign)
  const hasHazardData = course.holes?.some(h => h.hzDesign)
  const rollup = rollupConfidence(course)
  const teeClubStats = pickTeeClubStats(clubs)
  const ctx = { course, holeTimes, holeWeather, teeClubStats }
  const holesData = (course.holes || []).map((h, i) => buildHoleLine(i, h, ctx)).join('\n')

  const sourceNote = course.source === 'GolfCourseAPI' ? `Verified — GolfCourseAPI`
    : course.source === 'OpenGolfAPI'    ? `Partial — OpenGolfAPI (par/HCP only, yardages from web)`
    : course.source                      ? `Unverified — via web search (${course.source}).`
    : 'Manual entry'

  const stylePrefix = style === 'conservative'
    ? 'CONSERVATIVE PLAN: lean toward safe targets, take stress-free pars, only attack on highest-confidence design data.'
    : style === 'aggressive'
      ? 'AGGRESSIVE PLAN: take birdie looks where math supports it, accept that some risks blow up; reserve safety only where dispersion overlap is high.'
      : 'BALANCED PLAN: weight risk against player dispersion — use the per-hole "Risk:" overlap line to decide layups.'

  return {
    prompt: `You are an elite Tour caddy. Generate a concise game plan. IMPORTANT: You MUST cover ALL 18 holes — do not stop early.

${stylePrefix}

${playerBlock}

COURSE: ${course.name}${course.selectedTee ? ` (${course.selectedTee} tees)` : ''}, ${course.yardage}y, Rating ${course.rating} / Slope ${course.slope}, Par ${course.par}
Course Handicap: ${courseHandicap} | Data: ${sourceNote} | Confidence rollup: highest=${rollup.highest}, breakdown=${JSON.stringify(rollup.breakdown)}
${course.roundType} | Target: ${course.targetScore || 'under par'} | Conditions: ${course.conditions || 'normal'}
${course.elevation ? `Course elevation: ${course.elevation}ft (per-hole effective yardages pre-adjusted below).` : ''}
${isPractice ? 'Practice round — frame around learning, not score.' : ''}${isMatchPlay ? 'Match play — adjust risk for hole-by-hole context.' : ''}
${course.notes ? `Notes: ${course.notes}` : ''}
Tee: ${teeTime} (${teeDate}), ${pace} min/hole
${historyBlock}

PRE-COMPUTED HINTS (USE THESE — do not redo the math):
- "plays Xy" = elevation-adjusted effective yardage. Pick clubs off this number.
- "(NNmph headwind, NNmph L→R cross)" = wind already decomposed against the hole bearing.
- "Risk: <club> dispersion overlaps: <hazard> ~XX%" = player's statistical chance of landing in that hazard with that tee club. Treat ≥30% as serious; ≥20% as worth a layup discussion.
- "conf:overall/hazards" = data confidence per hole. If hazards is "low" or "none", do NOT invent hazards; recommend a default-safe line.

HOLES:
${holesData}

IMPORTANT RULES:
1. Cover ALL 18 holes. Do not stop at hole 11 or 12.
2. Recommend draws AND fades AND straight shots — match shape to hole, not just one shape.
3. Remember this is a ${handLabel} player — shot shapes curve differently.
4. Keep caddy notes SHORT (1 sentence max).
5. When confidence is "low" or "none" for hazards, say "standard approach" rather than invent obstacles.
6. Use the pre-computed wind/elevation numbers verbatim. Don't re-estimate.

## Round strategy
2-3 sentences. Approach for today, factoring style "${style}".

## Scoring roadmap
One line per hole: "H[N] Par [X] [Yds]y — 🟢/🟡/🔴 — reason"

## Hole-by-hole
### Hole [N] — Par [X] — [Yds]y — HCP [N]
- **Tee**: Club, target, shape (specify ball flight direction for this ${isLefty ? 'lefty' : 'righty'})
- **Approach**: Club, distance, landing zone
- **Caddy**: One short sentence. Sound like a human, not a manual.
\`\`\`green-json
{"depth_y":28,"width_y":24,"shape":"oval","pin":"center","slope":"flat","tiers":0,"tier_desc":"","green_notes":"","confidence":"uncertain","hazards":[]}
\`\`\`
Green-json: "hazards" must be [] unless a hole's hzDesign/osmDesign explicitly listed one. "confidence" must be "verified" only when the hole's conf:hazards tag is "high".

## Weather
Club adjustments where pre-computed wind/elevation matters most.

## Pressure
${summary ? 'Use tournament vs casual data. ' : ''}Pre-shot anchor. How to handle bogeys.

Be direct. No filler. ALL 18 HOLES.`,
    meta: {
      courseHandicap,
      mode: 'course_loaded',
      style,
      confidence: rollup,
      hasOSMData, hasWebDesign, hasHazardData,
    },
  }
}
