// ─── Pure stats + club-name utilities for imported shot data ──────────────────
// No app imports — safe to use from parsers, components, and tests.
//
// Shared data spec:
//   NormalizedShot { clubKey, clubLabel, carryYds, totalYds, offlineYds (neg=LEFT,
//     pos=RIGHT), ballSpeedMph, clubSpeedMph, launchDeg, spinRpm, apexFt, timestamp }
//   Missing values are null — never 0/undefined/NaN. Numerics round to 1 decimal.

// ─── Club name normalization ──────────────────────────────────────────────────
// Canon keys: driver, 2w–9w, 1h–5h, 1i–9i, pw, gw, sw, lw, bare loft '44'–'64'.
// Unmatched names fall back to a slugified key with the raw string as label.
export function normalizeClubName(raw) {
  const rawStr = String(raw ?? '').trim()
  if (!rawStr) return { key: 'unknown', label: 'Unknown' }

  // lowercase, drop parenthetical notes ("GW (50°)"), strip degree signs,
  // spaces, hyphens, underscores, dots — then take the first "/" alternative
  // ("4-iron / hybrid" → "4iron")
  let s = rawStr.toLowerCase().replace(/\(.*?\)/g, '')
  s = s.replace(/[°º]/g, '').replace(/[\s\-_.]+/g, '')
  s = s.split('/')[0]

  let m
  if (/^(driver|dr|d|1w(ood)?)$/.test(s))             return { key: 'driver', label: 'Driver' }
  if ((m = s.match(/^([2-9])w(ood)?$/)))              return { key: `${m[1]}w`, label: `${m[1]}W` }
  if ((m = s.match(/^([1-5])(h|hy|hybrid|rescue)$/))) return { key: `${m[1]}h`, label: `${m[1]}H` }
  if ((m = s.match(/^([1-9])i(ron)?$/)))              return { key: `${m[1]}i`, label: `${m[1]}i` }
  if (s === 'pw' || s.includes('pitching'))           return { key: 'pw', label: 'PW' }
  if (s === 'gw' || s === 'aw' || s.includes('gap') || s.includes('approach'))
    return { key: 'gw', label: 'GW' }
  if (s === 'sw' || s.includes('sand'))               return { key: 'sw', label: 'SW' }
  if (s === 'lw' || s.includes('lob'))                return { key: 'lw', label: 'LW' }
  if ((m = s.match(/^(4[4-9]|5[0-9]|6[0-4])$/)))      return { key: m[1], label: `${m[1]}°` }

  const slug = rawStr.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return { key: slug || 'unknown', label: rawStr }
}

// ─── Numeric helpers ──────────────────────────────────────────────────────────
export function round1(n) {
  if (n == null || !Number.isFinite(n)) return null
  return Math.round(n * 10) / 10
}

function finiteNumbers(values) {
  return (values || []).filter(v => typeof v === 'number' && Number.isFinite(v))
}

function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
}

// Sample standard deviation (n−1). Requires ≥ 3 samples, else null.
function sampleStd(values) {
  if (values.length < 3) return null
  const m = mean(values)
  const ss = values.reduce((acc, v) => acc + (v - m) ** 2, 0)
  return Math.sqrt(ss / (values.length - 1))
}

// percentile([...], p) — p in 0..100, linear interpolation between closest
// ranks. Accepts sorted or unsorted input (never mutates). Empty → null.
export function percentile(sortedOrUnsorted, p) {
  const vals = finiteNumbers(sortedOrUnsorted).slice().sort((a, b) => a - b)
  if (vals.length === 0) return null
  const pct = Math.min(100, Math.max(0, Number(p) || 0))
  const rank = (vals.length - 1) * (pct / 100)
  const lo = Math.floor(rank)
  const hi = Math.ceil(rank)
  if (lo === hi) return vals[lo]
  return vals[lo] + (rank - lo) * (vals[hi] - vals[lo])
}

// IQR fence: [Q1 − 1.5·IQR, Q3 + 1.5·IQR]. Empty input → null.
export function iqrBounds(values) {
  const q1 = percentile(values, 25)
  const q3 = percentile(values, 75)
  if (q1 == null || q3 == null) return null
  const iqr = q3 - q1
  return { lo: q1 - 1.5 * iqr, hi: q3 + 1.5 * iqr }
}

// Keep only values inside the IQR fence.
export function iqrTrim(values) {
  const vals = finiteNumbers(values)
  const bounds = iqrBounds(vals)
  if (!bounds) return []
  return vals.filter(v => v >= bounds.lo && v <= bounds.hi)
}

// ─── Per-club aggregate stats ─────────────────────────────────────────────────
// Display/sort order: driver, woods, hybrids, irons, wedges (by loft), other.
function clubOrder(key) {
  if (key === 'driver') return 0
  let m
  if ((m = key.match(/^([2-9])w$/))) return 10 + Number(m[1])
  if ((m = key.match(/^([1-5])h$/))) return 20 + Number(m[1])
  if ((m = key.match(/^([1-9])i$/))) return 30 + Number(m[1])
  const wedgeLoft = { pw: 46, gw: 50, sw: 56, lw: 60 }[key]
  if (wedgeLoft) return 40 + wedgeLoft
  if (/^\d{2}$/.test(key)) return 40 + Number(key)
  return 999
}

// computeClubStats(shots) -> ClubStats[]
// Groups NormalizedShots by clubKey, drops shots with null carry, IQR-trims by
// carry, then aggregates. Shots may optionally carry `source` / `sessionDate`
// (attached by callers when merging sessions) to feed `sources` and
// `lastSessionDate`; shot timestamps are used as a date fallback.
export function computeClubStats(shots) {
  const groups = new Map()
  for (const shot of shots || []) {
    if (!shot || shot.carryYds == null || !Number.isFinite(shot.carryYds)) continue
    const key = shot.clubKey || 'unknown'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(shot)
  }

  const out = []
  for (const [clubKey, group] of groups) {
    const bounds = iqrBounds(group.map(s => s.carryYds))
    const kept = group.filter(s => s.carryYds >= bounds.lo && s.carryYds <= bounds.hi)
    if (kept.length === 0) continue

    const carries = kept.map(s => s.carryYds)
    const totals = finiteNumbers(kept.map(s => s.totalYds))
    const offlines = finiteNumbers(kept.map(s => s.offlineYds))
    const lefts = offlines.filter(v => v < 0).map(v => Math.abs(v))
    const rights = offlines.filter(v => v > 0)
    const ballSpeeds = finiteNumbers(kept.map(s => s.ballSpeedMph))
    const launches = finiteNumbers(kept.map(s => s.launchDeg))
    const spins = finiteNumbers(kept.map(s => s.spinRpm))
    const dates = kept
      .map(s => s.sessionDate || (typeof s.timestamp === 'string' ? s.timestamp.slice(0, 10) : null))
      .filter(Boolean)
    const sources = [...new Set(kept.map(s => s.source).filter(Boolean))]

    out.push({
      clubKey,
      clubLabel: kept[0].clubLabel || clubKey,
      samples: kept.length,
      carryAvg: round1(mean(carries)),
      carryP50: round1(percentile(carries, 50)),
      carryP80: round1(percentile(carries, 80)),
      carryStd: round1(sampleStd(carries)),
      totalAvg: round1(mean(totals)),
      offlineBias: round1(mean(offlines)),
      offlineStd: round1(sampleStd(offlines)),
      dispLeftP80: round1(percentile(lefts, 80)),
      dispRightP80: round1(percentile(rights, 80)),
      ballSpeedAvg: round1(mean(ballSpeeds)),
      launchAvg: round1(mean(launches)),
      spinAvg: round1(mean(spins)),
      lastSessionDate: dates.length ? dates.slice().sort().at(-1) : null,
      sources,
    })
  }

  out.sort((a, b) => clubOrder(a.clubKey) - clubOrder(b.clubKey) || a.clubKey.localeCompare(b.clubKey))
  return out
}
