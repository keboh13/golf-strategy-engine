// Weighted scoring history analytics.
//
// Replaces the flat-mean averages in buildPrompt with:
//  1) Recency weighting (90-day half-life by default) — recent rounds count more
//  2) ESC cap on per-hole scores (net double bogey at most) — blowups don't
//     dominate par-type averages
//  3) Sample-size annotations so the prompt carries n + recency context
//
// Pure functions: ((rounds[], opts) => { overall, perPar, frontBack }).

const DAY_MS = 24 * 60 * 60 * 1000

function daysBetween(dateStr, nowMs) {
  if (!dateStr) return 365            // very stale if undated
  const t = Date.parse(dateStr)
  if (!Number.isFinite(t)) return 365
  return Math.max(0, (nowMs - t) / DAY_MS)
}

function recencyWeight(days, halfLifeDays) {
  return Math.pow(0.5, days / halfLifeDays)
}

// Equitable Stroke Control (USGA simplified): cap each hole at net double
// bogey = par + 2 + handicap strokes received on that hole. Without a
// per-hole stroke index breakdown we conservatively cap at par + 3 (lets
// scratch through ~12 handicap take the legitimate strokes; bigger blowups
// get truncated).
export function escCap(par, score) {
  if (!Number.isFinite(par) || !Number.isFinite(score)) return score
  const cap = par + 3
  return score > cap ? cap : score
}

function avg(arr) {
  if (!arr.length) return null
  const sum = arr.reduce((a, b) => a + b, 0)
  return sum / arr.length
}

function weightedAvg(values, weights) {
  if (!values.length) return null
  let s = 0, w = 0
  for (let i = 0; i < values.length; i++) {
    s += values[i] * weights[i]
    w += weights[i]
  }
  if (w === 0) return null
  return s / w
}

const toNum = r => (r.toPar === 'E' ? 0 : parseFloat(r.toPar))

/**
 * @param {Array} rounds
 * @param {object} opts { halfLifeDays, nowMs }
 * @returns { overall, tournament, casual, perPar: {3,4,5}, frontBack: {front, back} }
 */
export function summarizeHistory(rounds, opts = {}) {
  const halfLife = opts.halfLifeDays ?? 90
  const nowMs = opts.nowMs ?? Date.parse('2099-01-01')   // deterministic in tests
  if (!Array.isArray(rounds) || !rounds.length) return null

  const valid = rounds.filter(r => r.course && r.score != null)
  if (!valid.length) return null

  const weighted = valid.map(r => ({
    r,
    weight: recencyWeight(daysBetween(r.date, nowMs), halfLife),
  }))

  const numsAll = weighted
    .map(w => ({ v: toNum(w.r), w: w.weight }))
    .filter(o => Number.isFinite(o.v))

  const tournament = weighted.filter(w => w.r.roundType === 'Tournament' || w.r.roundType === 'Qualifier')
  const casual     = weighted.filter(w => w.r.roundType === 'Casual' || w.r.roundType === 'Practice round')

  const overall = numsAll.length
    ? {
        avg: weightedAvg(numsAll.map(o => o.v), numsAll.map(o => o.w)),
        flat: avg(numsAll.map(o => o.v)),
        n: numsAll.length,
        avgRecencyDays: Math.round(weightedAvg(
          valid.map(r => daysBetween(r.date, nowMs)),
          weighted.map(w => w.weight),
        )),
      }
    : null

  const groupAvg = (rs) => {
    const nums = rs.map(w => ({ v: toNum(w.r), w: w.weight })).filter(o => Number.isFinite(o.v))
    if (!nums.length) return null
    return {
      avg: weightedAvg(nums.map(o => o.v), nums.map(o => o.w)),
      n: nums.length,
    }
  }

  // Per-par averages with ESC cap on each contributing hole.
  const perPar = {}
  for (const par of [3, 4, 5]) {
    const items = []
    for (const w of weighted) {
      const holes = (w.r.holes || []).filter(h => h.par === par && h.score)
      for (const h of holes) {
        items.push({ delta: escCap(h.par, h.score) - h.par, weight: w.weight })
      }
    }
    if (items.length) {
      perPar[par] = {
        avg: weightedAvg(items.map(i => i.delta), items.map(i => i.weight)),
        n: items.length,
      }
    } else {
      perPar[par] = null
    }
  }

  // Front/back 9 averages — only count rounds with all 9 holes scored on that side
  const frontBack = { front: null, back: null }
  for (const side of ['front', 'back']) {
    const slice = side === 'front' ? [0, 9] : [9, 18]
    const items = []
    for (const w of weighted) {
      if (!Array.isArray(w.r.holes)) continue
      const holes = w.r.holes.slice(...slice).filter(h => h.par && h.score)
      if (holes.length !== 9) continue
      const sum = holes.reduce((a, h) => a + (escCap(h.par, h.score) - h.par), 0)
      items.push({ v: sum, w: w.weight })
    }
    if (items.length) {
      frontBack[side] = {
        avg: weightedAvg(items.map(i => i.v), items.map(i => i.w)),
        n: items.length,
      }
    }
  }

  return {
    overall,
    tournament: groupAvg(tournament),
    casual: groupAvg(casual),
    perPar,
    frontBack,
  }
}

const fmt = (n) => {
  if (n == null || !Number.isFinite(n)) return null
  if (Math.abs(n) < 0.05) return 'E'
  const r = Math.round(n * 10) / 10
  return r > 0 ? `+${r}` : String(r)
}

export function renderHistoryBlock(summary) {
  if (!summary) return ''
  const lines = ['', '', 'SCORING HISTORY (recency-weighted, 90-day half-life, ESC-capped):']
  if (summary.overall) {
    const f = fmt(summary.overall.avg)
    lines.push(`Overall avg: ${f} (n=${summary.overall.n}, avg recency ${summary.overall.avgRecencyDays}d)`)
  }
  if (summary.tournament) {
    lines.push(`Tournament avg: ${fmt(summary.tournament.avg)} (n=${summary.tournament.n})`)
  }
  if (summary.casual) {
    lines.push(`Casual avg: ${fmt(summary.casual.avg)} (n=${summary.casual.n})`)
  }
  for (const par of [3, 4, 5]) {
    const p = summary.perPar?.[par]
    if (p) lines.push(`Par ${par} avg: ${fmt(p.avg)} vs par (n=${p.n})`)
  }
  if (summary.frontBack.front && summary.frontBack.back) {
    lines.push(`Front 9: ${fmt(summary.frontBack.front.avg)} (n=${summary.frontBack.front.n}) | Back 9: ${fmt(summary.frontBack.back.avg)} (n=${summary.frontBack.back.n})`)
  }
  return lines.join('\n')
}
