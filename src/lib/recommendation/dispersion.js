// Dispersion-vs-hazard overlap estimator.
//
// Single biggest accuracy lever in the recommender: turns "watch out for the
// right bunker" vibes into "driver dispersion overlaps right bunker by ~32%."
// Doing this in code (not Claude's head) gives the LLM a real input.
//
// Model: a club's shots from the tee form an ellipse with semi-axes
//   (sigmaDistance, sigmaLateral) centered on (carryYds, bias).
// We approximate the per-shot lateral position at carry distance d as
// gaussian: N(bias, sigmaLateral). For hazards described by a side (L|R) and
// a carry_yards entry (when the hazard starts), we estimate the probability
// the shot lands in the hazard's lateral band.
//
// Side mapping (matches yardage-book convention, lefty perspective handled by
// the caller):
//   L     → hazard centered to the LEFT (negative offset)
//   R     → hazard centered to the RIGHT (positive offset)
//   C     → centerline (in-play)
//   front → short of green; not a tee-shot dispersion problem (ignored)
//   back  → long of green
//
// Hazard lateral band default (yards from centerline, before/after a tunable
// width). These are caddy defaults — fine for a heuristic that tells the LLM
// "this club's left misses overlap that water." Per-hole hazard.notes can
// optionally include a numeric band that overrides the default.

const DEFAULT_HAZARD_WIDTH_YDS = 12       // half-width of typical fairway hazard band (24y total)
const DEFAULT_HAZARD_OFFSET_YDS = 25      // distance from fairway centerline to hazard center

const ERF_A1 = 0.254829592
const ERF_A2 = -0.284496736
const ERF_A3 = 1.421413741
const ERF_A4 = -1.453152027
const ERF_A5 = 1.061405429
const ERF_P = 0.3275911

function erf(x) {
  // Abramowitz & Stegun 7.1.26
  const sign = x < 0 ? -1 : 1
  const ax = Math.abs(x)
  const t = 1 / (1 + ERF_P * ax)
  const y = 1 - (((((ERF_A5 * t + ERF_A4) * t) + ERF_A3) * t + ERF_A2) * t + ERF_A1) * t * Math.exp(-ax * ax)
  return sign * y
}

function normalCdf(x, mu, sigma) {
  if (sigma <= 0) return x >= mu ? 1 : 0
  return 0.5 * (1 + erf((x - mu) / (sigma * Math.SQRT2)))
}

// Probability that a draw from N(mu, sigma) falls in [lo, hi].
function bandProb(lo, hi, mu, sigma) {
  return Math.max(0, Math.min(1, normalCdf(hi, mu, sigma) - normalCdf(lo, mu, sigma)))
}

// Side string → signed lateral offset in yards (negative = LEFT, positive = RIGHT)
function sideOffset(side) {
  const s = (side || '').toUpperCase()
  if (s === 'L') return -DEFAULT_HAZARD_OFFSET_YDS
  if (s === 'R') return DEFAULT_HAZARD_OFFSET_YDS
  if (s === 'C') return 0
  return null  // front/back/unknown → not a tee-shot lateral problem
}

/**
 * Estimate overlap probability of a single hazard with the player's club
 * dispersion. Returns 0..1 (rounded to 2 dp) or null when the hazard isn't a
 * lateral threat (front/back/unknown side, or no club lateral spread known).
 *
 * @param {object} hazard   - {type, side, carry_yards, notes}
 * @param {object} clubStats - {carryYds, offlineBiasYds, lateralSigmaYds}
 *                             offlineBiasYds: + = right, - = left (matches shotStore)
 */
export function hazardOverlapProb(hazard, clubStats) {
  if (!hazard || !clubStats) return null
  if (!Number.isFinite(clubStats.lateralSigmaYds) || clubStats.lateralSigmaYds <= 0) return null
  if (!Number.isFinite(clubStats.carryYds) || clubStats.carryYds <= 0) return null

  // Only consider hazards in carry range — within ±15y of player's carry.
  if (Number.isFinite(hazard.carry_yards)) {
    if (hazard.carry_yards > clubStats.carryYds + 15) return 0
    if (hazard.carry_yards < clubStats.carryYds - 60) return 0    // already past it
  }

  const offset = sideOffset(hazard.side)
  if (offset == null) return null

  const bias = Number.isFinite(clubStats.offlineBiasYds) ? clubStats.offlineBiasYds : 0
  const sigma = clubStats.lateralSigmaYds
  const lo = offset - DEFAULT_HAZARD_WIDTH_YDS
  const hi = offset + DEFAULT_HAZARD_WIDTH_YDS

  const p = bandProb(lo, hi, bias, sigma)
  return Math.round(p * 100) / 100
}

/**
 * Compute per-hole overlap flags for the tee shot. Returns an array of
 * { type, side, carry_yards, prob } sorted by prob desc, only including
 * hazards with prob >= threshold.
 *
 * Designed to be turned into a single prompt-line per hole — e.g.
 *   "driver dispersion: bunker R ~32%, water L ~12%"
 */
export function tee_shot_overlaps({ hazards, clubStats, threshold = 0.1 }) {
  if (!Array.isArray(hazards) || !clubStats) return []
  const flagged = []
  for (const hz of hazards) {
    const p = hazardOverlapProb(hz, clubStats)
    if (p != null && p > 0 && p >= threshold) {
      flagged.push({
        type: hz.type, side: hz.side,
        carry_yards: Number.isFinite(hz.carry_yards) ? hz.carry_yards : null,
        prob: p,
      })
    }
  }
  flagged.sort((a, b) => b.prob - a.prob)
  return flagged
}

export function formatOverlapLine(clubLabel, overlaps) {
  if (!overlaps.length) return null
  const parts = overlaps.map(o => {
    const carry = o.carry_yards ? ` @${o.carry_yards}y` : ''
    return `${o.type} ${o.side}${carry} ~${Math.round(o.prob * 100)}%`
  })
  return `${clubLabel} dispersion overlaps: ${parts.join(', ')}`
}

// ── Issue #193: Approach-shot dispersion analysis ──────────────────────────
//
// After the tee shot lands, we need to evaluate the approach shot's dispersion
// against greenside hazards. This uses the same statistical model as tee shots
// but from the expected landing zone to the green.

/**
 * Pick the best club stats for a given approach distance from the player's bag.
 * Returns { clubLabel, carryYds, offlineBiasYds, lateralSigmaYds } or null.
 */
export function pickApproachClubStats(clubs, distanceYds) {
  if (!Array.isArray(clubs) || !Number.isFinite(distanceYds) || distanceYds <= 0) return null

  // Filter to irons and wedges (approach clubs)
  const approachClubs = clubs.filter(c => {
    const name = (c.club || '').toLowerCase()
    return /iron|wedge|hybrid/i.test(name) && !/driver|wood/i.test(name)
  })
  if (!approachClubs.length) return null

  let best = null
  let bestDiff = Infinity
  for (const c of approachClubs) {
    const carry = c.stats?.carryP50 ?? c.stats?.carryAvg ?? c.carry
    if (!Number.isFinite(carry)) continue
    const diff = Math.abs(carry - distanceYds)
    if (diff < bestDiff) {
      bestDiff = diff
      best = c
    }
  }
  if (!best) return null

  const carryYds = best.stats?.carryP50 ?? best.stats?.carryAvg ?? best.carry
  const stats = best.stats
  let sigma = null
  if (stats && Number.isFinite(stats.offlineStd)) {
    sigma = stats.offlineStd
  } else if (stats && Number.isFinite(stats.dispLeftP80) && Number.isFinite(stats.dispRightP80)) {
    sigma = (stats.dispLeftP80 + stats.dispRightP80) / 2 / 1.28
  } else {
    const dispLeft = Number.isFinite(best.dispLeft) ? best.dispLeft : 0
    const dispRight = Number.isFinite(best.dispRight) ? best.dispRight : 0
    sigma = (dispLeft + dispRight) > 0 ? (dispLeft + dispRight) / 2 : null
  }

  return {
    clubLabel: best.club,
    carryYds,
    offlineBiasYds: Number.isFinite(stats?.offlineBias) ? stats.offlineBias : 0,
    lateralSigmaYds: sigma,
  }
}

/**
 * Compute approach-shot dispersion overlaps with greenside hazards.
 *
 * Takes the expected landing zone from the tee shot as starting point,
 * computes dispersion ellipses for the appropriate approach club,
 * and checks overlap vs greenside hazards.
 *
 * @param {object} params
 * @param {number} params.holeYardage - total hole yardage
 * @param {number} params.teeCarryYds - tee shot carry distance
 * @param {Array}  params.hazards - greenside hazards [{type, side, carry_yards}]
 * @param {Array}  params.clubs - player's full bag
 * @param {number} [params.threshold=0.10] - minimum prob to flag
 * @returns {{ clubStats, overlaps, approachYds }|null}
 */
export function approach_overlaps({ holeYardage, teeCarryYds, hazards, clubs, threshold = 0.10 }) {
  if (!Number.isFinite(holeYardage) || !Number.isFinite(teeCarryYds)) return null
  if (!Array.isArray(hazards) || !Array.isArray(clubs)) return null

  const approachYds = holeYardage - teeCarryYds
  if (approachYds <= 0) return null

  // Filter to greenside hazards (front, back, or lateral near green)
  const greensideHazards = hazards.filter(hz => {
    const side = (hz.side || hz.loc || '').toLowerCase()
    // Include front/back/L/R hazards that are near the green
    if (side === 'front' || side === 'back') return true
    // For lateral hazards, include those with carry_yards near or past the approach distance
    if (Number.isFinite(hz.carry_yards)) {
      return hz.carry_yards >= teeCarryYds - 20
    }
    // Include lateral hazards without carry info (assume they could be greenside)
    return side === 'l' || side === 'r' || side === 'c'
  })

  const clubStats = pickApproachClubStats(clubs, approachYds)
  if (!clubStats) return null

  // For front/back hazards, map them to a lateral-compatible format for overlap calc
  const mappedHazards = greensideHazards.map(hz => {
    const side = (hz.side || hz.loc || '').toLowerCase()
    if (side === 'front' || side === 'back') {
      // Front/back hazards: treat as centerline hazard
      return { ...hz, side: 'C' }
    }
    return hz
  })

  const flagged = []
  for (const hz of mappedHazards) {
    const p = hazardOverlapProb(hz, clubStats)
    if (p != null && p > 0 && p >= threshold) {
      flagged.push({
        type: hz.type,
        side: hz.side || hz.loc,
        carry_yards: Number.isFinite(hz.carry_yards) ? hz.carry_yards : null,
        prob: p,
      })
    }
  }
  flagged.sort((a, b) => b.prob - a.prob)

  return { clubStats, overlaps: flagged, approachYds }
}

/**
 * Compare approach dispersion from a layup position vs going for it.
 *
 * @param {object} params
 * @param {number} params.holeYardage
 * @param {number} params.teeCarryYds - carry if going for it
 * @param {number} params.layupCarryYds - carry if laying up
 * @param {Array}  params.hazards
 * @param {Array}  params.clubs
 * @returns {{ goForIt, layup }|null}
 */
export function compareLayupApproach({ holeYardage, teeCarryYds, layupCarryYds, hazards, clubs }) {
  if (!Number.isFinite(layupCarryYds)) return null

  const goForIt = approach_overlaps({ holeYardage, teeCarryYds, hazards, clubs, threshold: 0 })
  const layup = approach_overlaps({ holeYardage, teeCarryYds: layupCarryYds, hazards, clubs, threshold: 0 })

  if (!goForIt && !layup) return null
  return { goForIt, layup }
}

export function formatApproachOverlapLine(result) {
  if (!result || !result.overlaps?.length) return null
  const parts = result.overlaps.map(o => {
    const carry = o.carry_yards ? ` @${o.carry_yards}y` : ''
    return `${o.type} ${o.side}${carry} ~${Math.round(o.prob * 100)}%`
  })
  return `${result.clubStats.clubLabel} approach from ${result.approachYds}y: ${parts.join(', ')}`
}
