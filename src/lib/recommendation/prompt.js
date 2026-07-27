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
import { decomposeWind, windDistanceAdjustmentYds } from './wind.js'
import { effectiveYardage } from './elevation.js'
import { tee_shot_overlaps, formatOverlapLine, approach_overlaps, formatApproachOverlapLine } from './dispersion.js'
import { holeConfidence, rollupConfidence } from './confidence.js'
import { summarizeHistory, renderHistoryBlock } from './history.js'
import { formatDistancesLine } from '../courseGeometry.js'
import { renderPriorRoundBlock } from '../postRound.js'

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

// ── Issue #196: Miss-side conflict detection ──────────────────────────────
/**
 * Check if player's miss tendency conflicts with hazard positions on a hole.
 * Returns an array of caution strings (empty if no conflicts).
 *
 * @param {string|object} miss - player miss direction (string or {shape, magnitudeYds, trigger})
 * @param {Array} hazards - hole hazards [{type, side, loc, carry_yards}]
 * @param {boolean} isLefty - whether player is left-handed
 */
export function computeMissSideConflicts(miss, hazards, isLefty) {
  if (!miss || !Array.isArray(hazards) || !hazards.length) return []

  // Determine the miss direction in absolute terms (L or R on the course)
  const missShape = typeof miss === 'string' ? miss.toLowerCase() : (miss.shape || '').toLowerCase()

  // Map miss shape to absolute miss side
  // Righty: fade/slice → R, draw/hook → L
  // Lefty: fade/slice → L, draw/hook → R
  let missSide = null
  if (/fade|slice|push/.test(missShape)) {
    missSide = isLefty ? 'L' : 'R'
  } else if (/draw|hook|pull/.test(missShape)) {
    missSide = isLefty ? 'R' : 'L'
  }

  if (!missSide) return []

  const magnitude = typeof miss === 'object' && Number.isFinite(miss.magnitudeYds) ? miss.magnitudeYds : null
  const trigger = typeof miss === 'object' && miss.trigger ? miss.trigger : null

  const conflicts = []
  for (const hz of hazards) {
    const hzSide = (hz.side || hz.loc || '').toUpperCase()
    if (hzSide !== missSide) continue

    const magStr = magnitude ? ` (~${magnitude}y)` : ''
    const trigStr = trigger ? ` (especially ${trigger})` : ''
    conflicts.push(
      `CAUTION: miss tendency ${missShape}${magStr} goes toward ${hz.type} ${hzSide}${trigStr}`
    )
  }
  return conflicts
}

// ── Issue #200: Wind-adjusted club suggestions ────────────────────────────
/**
 * Find the best club for a given target distance from the player's bag.
 * Returns { club, carry } or null.
 */
export function findClubForDistance(clubs, targetYds) {
  if (!Array.isArray(clubs) || !Number.isFinite(targetYds) || targetYds <= 0) return null

  let best = null
  let bestDiff = Infinity
  for (const c of clubs) {
    const carry = c.stats?.carryP50 ?? c.stats?.carryAvg ?? c.carry
    if (!Number.isFinite(carry)) continue
    const diff = Math.abs(carry - targetYds)
    if (diff < bestDiff) {
      bestDiff = diff
      best = { club: c.club, carry }
    }
  }
  return best
}

/**
 * When wind delta exceeds a typical club gap (~10-12y), compute a wind-adjusted
 * club suggestion string.
 *
 * @param {Array} clubs - player's bag
 * @param {number} baseYds - elevation-adjusted yardage
 * @param {number} windDelta - wind distance adjustment in yards
 * @returns {string|null}
 */
export function windAdjustedClubSuggestion(clubs, baseYds, windDelta) {
  if (!Array.isArray(clubs) || !Number.isFinite(baseYds) || !Number.isFinite(windDelta)) return null
  if (Math.abs(windDelta) < 10) return null

  const playsAs = baseYds + windDelta
  const normalClub = findClubForDistance(clubs, baseYds)
  const adjustedClub = findClubForDistance(clubs, playsAs)

  if (!normalClub || !adjustedClub) return null
  if (normalClub.club === adjustedClub.club) return null

  return `Wind-adjusted: ${baseYds}y plays as ${playsAs}y -> suggest ${adjustedClub.club} (normally ${normalClub.club})`
}

// ── Issue #204: Scoring strategy section ──────────────────────────────────
/**
 * Categorize each hole as birdie target, par-save, or bogey-risk based on
 * player capabilities, hole layout, and hazard data.
 *
 * @param {Array} holes - course holes array
 * @param {Array} clubs - player's bag
 * @param {object} playerInfo - player profile
 * @param {object} course - course data
 * @returns {string} formatted SCORING_STRATEGY section
 */
export function buildScoringStrategy(holes, clubs, playerInfo, course) {
  if (!Array.isArray(holes) || !holes.length) return ''

  // Find player's max distances
  const maxCarry = getMaxCarry(clubs)
  const longIronMax = getLongIronMax(clubs)

  const birdieTargets = []
  const parSave = []
  const bogeyRisk = []

  const miss = playerInfo?.miss
  const isLefty = (playerInfo?.handedness || 'Right') === 'Left'

  for (let i = 0; i < holes.length; i++) {
    const h = holes[i]
    const yds = parseInt(h.yardage) || 0
    const par = parseInt(h.par) || 4
    const hcp = parseInt(h.handicap) || 9
    const holeNum = i + 1

    // Collect hazards for this hole
    const allHazards = [
      ...(h.hzDesign?.hazards || []),
      ...(h.osmDesign?.hazards || []).map(hz => ({ type: hz.type, side: hz.loc })),
    ]
    const hazardCount = allHazards.length
    const missConflicts = computeMissSideConflicts(miss, allHazards, isLefty)

    if (par === 5) {
      if (maxCarry && yds <= maxCarry * 2 + 30) {
        const reachClub = yds - maxCarry <= longIronMax ? 'reachable in two' : 'needs long approach'
        birdieTargets.push(`H${holeNum} par ${par} ${yds}y: ${reachClub}, birdie target`)
      } else if (hazardCount >= 2 || hcp <= 4) {
        bogeyRisk.push(`H${holeNum} par ${par} ${yds}y: long with hazards, bogey risk`)
      } else {
        parSave.push(`H${holeNum} par ${par} ${yds}y: three-shot hole, play for par`)
      }
    } else if (par === 4) {
      if (yds <= 340 && hazardCount <= 1) {
        birdieTargets.push(`H${holeNum} par ${par} ${yds}y: short par 4, birdie opportunity`)
      } else if (yds >= 430 || (hcp <= 4 && hazardCount >= 2)) {
        if (missConflicts.length > 0) {
          bogeyRisk.push(`H${holeNum} par ${par} ${yds}y: long + miss conflicts with hazards, elevated risk`)
        } else {
          parSave.push(`H${holeNum} par ${par} ${yds}y: demanding, play for par`)
        }
      } else if (missConflicts.length > 0 && hazardCount >= 2) {
        bogeyRisk.push(`H${holeNum} par ${par} ${yds}y: hazard layout + miss tendency = elevated risk`)
      }
    } else if (par === 3) {
      if (yds <= 160 && hazardCount <= 1) {
        birdieTargets.push(`H${holeNum} par ${par} ${yds}y: short par 3, birdie chance`)
      } else if (yds >= 210 || hazardCount >= 3) {
        parSave.push(`H${holeNum} par ${par} ${yds}y: demanding par 3`)
      } else if (missConflicts.length > 0) {
        bogeyRisk.push(`H${holeNum} par ${par} ${yds}y: miss tendency toward hazard`)
      }
    }
  }

  const lines = ['SCORING_STRATEGY:']
  if (birdieTargets.length) {
    lines.push('Birdie targets:')
    birdieTargets.forEach(t => lines.push(`  - ${t}`))
  }
  if (parSave.length) {
    lines.push('Par-save holes:')
    parSave.forEach(t => lines.push(`  - ${t}`))
  }
  if (bogeyRisk.length) {
    lines.push('Bogey-risk holes:')
    bogeyRisk.forEach(t => lines.push(`  - ${t}`))
  }

  return lines.length > 1 ? lines.join('\n') : ''
}

function getMaxCarry(clubs) {
  if (!Array.isArray(clubs)) return null
  let max = 0
  for (const c of clubs) {
    const carry = c.stats?.carryP50 ?? c.stats?.carryAvg ?? c.carry
    if (Number.isFinite(carry) && carry > max) max = carry
  }
  return max || null
}

function getLongIronMax(clubs) {
  if (!Array.isArray(clubs)) return 0
  let max = 0
  for (const c of clubs) {
    const name = (c.club || '').toLowerCase()
    if (/iron|hybrid/i.test(name)) {
      const carry = c.stats?.carryP50 ?? c.stats?.carryAvg ?? c.carry
      if (Number.isFinite(carry) && carry > max) max = carry
    }
  }
  return max
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

  // Wind-adjusted "plays" delta on top of raw yardage. Uses the elevation-
  // adjusted yardage as the base so wind stacks with elevation the way a
  // caddy actually thinks about it. Only surface deltas ≥3y — anything
  // smaller is inside the model's shot dispersion and reads as noise.
  const baseYds = eff?.effectiveYds || rawYds
  const windDelta = (wind && baseYds) ? windDistanceAdjustmentYds(wind.headMph, baseYds) : 0
  const windPlaysStr = Math.abs(windDelta) >= 3
    ? ` (wind: plays ${windDelta > 0 ? '+' : ''}${windDelta}y ${windDelta > 0 ? 'longer' : 'shorter'})`
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
    // Support both structured hazards array and legacy loose-string fields
    if (Array.isArray(h.webDesign.hazards) && h.webDesign.hazards.length) {
      parts.push('hazards: ' + h.webDesign.hazards.map(z => {
        const carry = z.carry_yards ? ` carry ${z.carry_yards}y` : ''
        const desc = z.position_description ? ` (${z.position_description})` : (z.notes ? ` (${z.notes})` : '')
        return `${z.type} ${z.side}${carry}${desc}`
      }).join(', '))
    } else {
      // Legacy loose-string fields for backward compat with cached data
      if (h.webDesign.water) parts.push(`water: ${h.webDesign.water}`)
      if (h.webDesign.bunkers) parts.push(`bunkers: ${h.webDesign.bunkers}`)
      if (h.webDesign.ob) parts.push(`OB ${h.webDesign.ob}`)
    }
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
        const desc = z.position_description ? ` (${z.position_description})` : (z.notes ? ` (${z.notes})` : '')
        return `${z.type} ${z.side}${carry}${desc}`
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

  // Issue #193: Approach-shot dispersion analysis
  const teeCarry = ctx.teeClubStats?.carryYds
  const approachResult = (rawYds && teeCarry && ctx.clubs)
    ? approach_overlaps({ holeYardage: rawYds, teeCarryYds: teeCarry, hazards: allHazards, clubs: ctx.clubs })
    : null
  const approachLine = formatApproachOverlapLine(approachResult)
  const approachStr = approachLine ? `\n   Risk: ${approachLine}` : ''

  // Issue #196: Miss-side conflict detection
  const missConflicts = ctx.playerMiss
    ? computeMissSideConflicts(ctx.playerMiss, allHazards, ctx.isLefty)
    : []
  const missStr = missConflicts.length ? `\n   ${missConflicts.join('\n   ')}` : ''

  // Issue #200: Wind-adjusted club suggestion
  const windClubStr = (Math.abs(windDelta) >= 10 && ctx.clubs)
    ? windAdjustedClubSuggestion(ctx.clubs, baseYds, windDelta)
    : null
  const windClubLine = windClubStr ? `\n   ${windClubStr}` : ''

  // Confidence tag
  const conf = holeConfidence(ctx.course, h)
  const confStr = ` | conf:${conf.overall}/${conf.hazards}`

  const nStr = h.notes ? ` | Note: ${h.notes}` : (!designStr ? ' | Note: no design data — do not assume hazards' : '')

  const elevHdr = h.elevation ? ` | Elev: ${h.elevation}` : ''

  return `H${i+1}: Par ${h.par}, ${h.yardage || '?'}y${effStr}${windPlaysStr}, HCP ${h.handicap}${elevHdr}${confStr}${designStr}${nStr}${wStr}${yardageBookText}${overlapStr}${approachStr}${missStr}${windClubLine}`
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
    priorRound = null,            // { date, scores, notes, generalNotes } — post-round hindsight
    nowMs,
  } = inputs
  const priorRoundBlock = renderPriorRoundBlock(priorRound)

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
  const ctx = { course, holeTimes, holeWeather, teeClubStats, clubs, playerMiss: playerInfo?.miss, isLefty }
  const holesData = (course.holes || []).map((h, i) => buildHoleLine(i, h, ctx)).join('\n')

  // Issue #204: Scoring strategy section
  const scoringStrategy = buildScoringStrategy(course.holes, clubs, playerInfo, course)

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
${priorRoundBlock}
${scoringStrategy ? `\n${scoringStrategy}\n` : ''}
PRE-COMPUTED HINTS (USE THESE — do not redo the math):
- "plays Xy" = elevation-adjusted effective yardage. Pick clubs off this number.
- "(NNmph headwind, NNmph L→R cross)" = wind already decomposed against the hole bearing.
- "(wind: plays +Xy longer/shorter)" = wind-adjusted distance delta on top of raw yardage. When this appears, your Tee/Approach line MUST reflect it: name the club change ("one more club — 6-iron", "half-club less"), and adjust the aim for the crosswind. Do not fold this back into the raw yardage silently.
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
7. Phase markers: emit "[[PHASE: roadmap]]", "[[PHASE: holes]]", and "[[PHASE: finalize]]" each on a line of their own, in the exact spots shown below. These drive the UI progress display — do not move them, paraphrase them, or add commentary on the same line.

## Round strategy
2-3 sentences. Approach for today, factoring style "${style}".

[[PHASE: roadmap]]
## Scoring roadmap
One line per hole: "H[N] Par [X] [Yds]y — 🟢/🟡/🔴 — reason"

[[PHASE: holes]]
## Hole-by-hole
### Hole [N] — Par [X] — [Yds]y — HCP [N]
- **Tee**: Club, target, shape (specify ball flight direction for this ${isLefty ? 'lefty' : 'righty'})
- **Approach**: Club, distance, landing zone
- **Caddy**: One short sentence. Sound like a human, not a manual.
\`\`\`green-json
{"depth_y":28,"width_y":24,"shape":"oval","pin":"center","slope":"flat","tiers":0,"tier_desc":"","green_notes":"","confidence":"uncertain","hazards":[]}
\`\`\`
Green-json: "hazards" must be [] unless a hole's hzDesign/osmDesign explicitly listed one. "confidence" must be "verified" only when the hole's conf:hazards tag is "high".

[[PHASE: finalize]]
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
