// Raw shot store — a localStorage-backed accumulator for imported
// launch-monitor sessions (NormalizedSession objects).
//
// Pure module: no app imports, no browser globals touched at import time.
// Storage is injected (anything with getItem/setItem/removeItem), so the
// module is fully testable in node.
//
// Stored value under SHOT_STORE_KEY:
//   { version: 1, sessions: NormalizedSession[], droppedSessions?, droppedShots? }
//
// `droppedSessions` / `droppedShots` are cumulative counters recorded whenever
// old data had to be evicted (cap or storage quota), so callers can warn.

export const SHOT_STORE_KEY = 'gse_shots'
export const MAX_STORED_SHOTS = 5000
const STORE_VERSION = 1

function emptyData() {
  return { version: STORE_VERSION, sessions: [] }
}

// Composite dedupe key for a shot within a given source.
function shotDedupeKey(source, shot) {
  return `${source}|${shot.timestamp ?? ''}|${shot.clubKey}|${shot.carryYds}`
}

function countShots(sessions) {
  return sessions.reduce((n, s) => n + s.shots.length, 0)
}

// Index of the oldest session by sessionDate (nulls sort oldest; ties keep
// the earliest-inserted session). Returns -1 when empty.
function oldestSessionIndex(sessions) {
  let best = -1
  let bestKey = null
  for (let i = 0; i < sessions.length; i++) {
    const key = sessions[i].sessionDate ?? ''
    if (best === -1 || key < bestKey) {
      best = i
      bestKey = key
    }
  }
  return best
}

function quotaError() {
  return new Error(
    'Could not save imported shots: browser storage is full. ' +
      'Clear stored shot data (or free up site storage) and try importing again.'
  )
}

// ─── Per-club aggregation ────────────────────────────────────────────────────

const MS_PER_DAY = 86400000
export const DEFAULT_HALF_LIFE_DAYS = 90

// Parse a timestamp or session date into epoch ms, or null if unusable.
function parseTime(value) {
  if (value == null) return null
  const t = Date.parse(value)
  return Number.isFinite(t) ? t : null
}

// Weighted mean / std over [{ v, w }] pairs. Std uses the reliability-weights
// formula, which reduces to the ordinary sample std (n-1) when all weights are
// equal. Returns null fields when there is no usable data.
function weightedStats(pairs) {
  if (pairs.length === 0) return { mean: null, std: null, min: null, max: null, n: 0 }
  let sumW = 0
  let sumWV = 0
  let min = Infinity
  let max = -Infinity
  for (const { v, w } of pairs) {
    sumW += w
    sumWV += w * v
    if (v < min) min = v
    if (v > max) max = v
  }
  const mean = sumWV / sumW
  let std = null
  if (pairs.length > 1) {
    let sumWSq = 0
    let sumWDev = 0
    for (const { v, w } of pairs) {
      sumWSq += w * w
      sumWDev += w * (v - mean) * (v - mean)
    }
    const denom = sumW - sumWSq / sumW
    std = denom > 0 ? Math.sqrt(sumWDev / denom) : 0
  }
  return { mean, std, min, max, n: pairs.length }
}

// Aggregate per-club stats from an array of NormalizedSession objects.
//
// Options:
//   now              — epoch ms used as "today" for recency ages (default Date.now())
//   halfLifeDays     — recency half-life; a shot this old counts half as much
//   recencyWeighting — set false for plain unweighted stats
//
// Each shot's age comes from its own timestamp, falling back to the session
// date; undated shots get full weight so sparse data is never discarded.
//
// Returns an array (sorted by carry mean, longest club first) of:
//   {
//     clubKey, clubLabel, count, sources, lastShotAt,
//     carry:     { mean, std, min, max, n },
//     total:     { mean, std, min, max, n },
//     offline:   { mean, std, min, max, n },   // mean = bias, std = dispersion
//     ballSpeed: { mean, n },
//     clubSpeed: { mean, n },
//   }
export function aggregateClubStats(sessions, options = {}) {
  const {
    now = Date.now(),
    halfLifeDays = DEFAULT_HALF_LIFE_DAYS,
    recencyWeighting = true,
  } = options

  const byClub = new Map()
  for (const session of Array.isArray(sessions) ? sessions : []) {
    if (!session || !Array.isArray(session.shots)) continue
    const sessionTime = parseTime(session.sessionDate)
    for (const shot of session.shots) {
      if (!shot || typeof shot.clubKey !== 'string' || shot.clubKey === '') continue

      const t = parseTime(shot.timestamp) ?? sessionTime
      let weight = 1
      if (recencyWeighting && t != null && halfLifeDays > 0) {
        const ageDays = Math.max(0, (now - t) / MS_PER_DAY)
        weight = Math.pow(0.5, ageDays / halfLifeDays)
      }

      let entry = byClub.get(shot.clubKey)
      if (!entry) {
        entry = {
          clubKey: shot.clubKey,
          clubLabel: null,
          count: 0,
          sources: new Set(),
          lastShotTime: null,
          carry: [],
          total: [],
          offline: [],
          ballSpeed: [],
          clubSpeed: [],
        }
        byClub.set(shot.clubKey, entry)
      }

      entry.count++
      if (shot.clubLabel) entry.clubLabel = shot.clubLabel
      if (session.source) entry.sources.add(session.source)
      if (t != null && (entry.lastShotTime == null || t > entry.lastShotTime)) {
        entry.lastShotTime = t
      }
      for (const metric of ['carry', 'total', 'offline', 'ballSpeed', 'clubSpeed']) {
        const v = shot[`${metric}Yds`] ?? shot[`${metric}Mph`]
        if (Number.isFinite(v)) entry[metric].push({ v, w: weight })
      }
    }
  }

  const result = []
  for (const entry of byClub.values()) {
    const carry = weightedStats(entry.carry)
    const total = weightedStats(entry.total)
    const offline = weightedStats(entry.offline)
    const ballSpeed = weightedStats(entry.ballSpeed)
    const clubSpeed = weightedStats(entry.clubSpeed)
    result.push({
      clubKey: entry.clubKey,
      clubLabel: entry.clubLabel ?? entry.clubKey,
      count: entry.count,
      sources: [...entry.sources].sort(),
      lastShotAt:
        entry.lastShotTime != null ? new Date(entry.lastShotTime).toISOString() : null,
      carry,
      total,
      offline,
      ballSpeed: { mean: ballSpeed.mean, n: ballSpeed.n },
      clubSpeed: { mean: clubSpeed.mean, n: clubSpeed.n },
    })
  }

  // Longest club first; clubs with no carry data sort last.
  result.sort((a, b) => (b.carry.mean ?? -Infinity) - (a.carry.mean ?? -Infinity))
  return result
}

export function createShotStore(storage = globalThis.localStorage) {
  function load() {
    let raw = null
    try {
      raw = storage.getItem(SHOT_STORE_KEY)
    } catch {
      return emptyData()
    }
    if (raw == null) return emptyData()
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      return emptyData()
    }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.sessions)) {
      return emptyData()
    }
    const data = emptyData()
    data.sessions = parsed.sessions.filter(
      (s) => s && typeof s === 'object' && Array.isArray(s.shots)
    )
    if (Number.isInteger(parsed.droppedSessions) && parsed.droppedSessions > 0) {
      data.droppedSessions = parsed.droppedSessions
    }
    if (Number.isInteger(parsed.droppedShots) && parsed.droppedShots > 0) {
      data.droppedShots = parsed.droppedShots
    }
    return data
  }

  function recordDrops(data, sessionsDropped, shotsDropped) {
    if (sessionsDropped > 0) {
      data.droppedSessions = (data.droppedSessions || 0) + sessionsDropped
    }
    if (shotsDropped > 0) {
      data.droppedShots = (data.droppedShots || 0) + shotsDropped
    }
  }

  // Remove oldest sessions until at most `targetShots` remain, always keeping
  // at least one session. Returns { sessions, shots } counts dropped.
  function dropOldest(data, targetShots) {
    let sessionsDropped = 0
    let shotsDropped = 0
    while (data.sessions.length > 1 && countShots(data.sessions) > targetShots) {
      const i = oldestSessionIndex(data.sessions)
      shotsDropped += data.sessions[i].shots.length
      data.sessions.splice(i, 1)
      sessionsDropped++
    }
    return { sessions: sessionsDropped, shots: shotsDropped }
  }

  function save(data) {
    storage.setItem(SHOT_STORE_KEY, JSON.stringify(data))
  }

  // Save, treating a setItem throw as a storage-quota failure: drop oldest
  // sessions (roughly halving the stored shot count), record the drops, and
  // retry exactly once. Still failing -> user-readable Error.
  function persist(data) {
    try {
      save(data)
      return
    } catch {
      const target = Math.floor(countShots(data.sessions) / 2)
      const dropped = dropOldest(data, target)
      if (dropped.sessions === 0) throw quotaError()
      recordDrops(data, dropped.sessions, dropped.shots)
      try {
        save(data)
      } catch {
        throw quotaError()
      }
    }
  }

  function appendSession(session) {
    if (!session || typeof session !== 'object' || !Array.isArray(session.shots)) {
      throw new Error('appendSession expects a NormalizedSession with a shots array')
    }
    const data = load()

    const seen = new Set()
    for (const stored of data.sessions) {
      for (const shot of stored.shots) {
        seen.add(shotDedupeKey(stored.source, shot))
      }
    }

    const fresh = []
    let duplicates = 0
    for (const shot of session.shots) {
      const key = shotDedupeKey(session.source, shot)
      if (seen.has(key)) {
        duplicates++
        continue
      }
      seen.add(key)
      fresh.push({ ...shot })
    }

    if (fresh.length === 0) {
      return { added: 0, duplicates }
    }

    data.sessions.push({
      source: session.source,
      sessionDate: session.sessionDate ?? null,
      unitsDetected: session.unitsDetected ?? 'unknown',
      warnings: Array.isArray(session.warnings) ? [...session.warnings] : [],
      shots: fresh,
    })

    // Enforce the global cap, evicting oldest sessions first.
    const dropped = dropOldest(data, MAX_STORED_SHOTS)
    // A single remaining session can still exceed the cap: keep its newest shots.
    const only = data.sessions.length === 1 ? data.sessions[0] : null
    if (only && only.shots.length > MAX_STORED_SHOTS) {
      dropped.shots += only.shots.length - MAX_STORED_SHOTS
      only.shots = only.shots.slice(only.shots.length - MAX_STORED_SHOTS)
    }
    recordDrops(data, dropped.sessions, dropped.shots)

    persist(data)
    return { added: fresh.length, duplicates }
  }

  function getSessions() {
    return load().sessions
  }

  function getAllShots() {
    return load().sessions.flatMap((s) => s.shots)
  }

  // Cumulative eviction counters, so callers can warn that old data was lost.
  function getDropInfo() {
    const data = load()
    return {
      droppedSessions: data.droppedSessions || 0,
      droppedShots: data.droppedShots || 0,
    }
  }

  // Per-club aggregates over everything stored. See aggregateClubStats for
  // the options and return shape.
  function getClubStats(options) {
    return aggregateClubStats(load().sessions, options)
  }

  // Snapshot of the stored data, suitable for JSON.stringify and a later
  // importData() on this or another device.
  function exportData() {
    return load()
  }

  // Merge a previously exported snapshot (or any { sessions: [...] } object)
  // into the store. Each session goes through the normal appendSession path,
  // so duplicates are skipped and the shot cap is enforced.
  function importData(payload) {
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.sessions)) {
      throw new Error('importData expects an object with a sessions array')
    }
    let added = 0
    let duplicates = 0
    for (const session of payload.sessions) {
      if (!session || typeof session !== 'object' || !Array.isArray(session.shots)) continue
      const result = appendSession(session)
      added += result.added
      duplicates += result.duplicates
    }
    return { added, duplicates }
  }

  function clear() {
    try {
      storage.removeItem(SHOT_STORE_KEY)
    } catch {
      // Nothing useful to do; clearing a missing/blocked store is a no-op.
    }
  }

  return {
    appendSession,
    getSessions,
    getAllShots,
    getClubStats,
    getDropInfo,
    exportData,
    importData,
    clear,
  }
}

// Lazy default instance bound to globalThis.localStorage. localStorage is not
// touched until a method is first called, so importing this module is safe in
// node (tests, SSR, scripts).
let defaultInstance = null

function getDefaultInstance() {
  if (!defaultInstance) {
    defaultInstance = createShotStore(globalThis.localStorage)
  }
  return defaultInstance
}

const shotStore = {
  appendSession: (session) => getDefaultInstance().appendSession(session),
  getSessions: () => getDefaultInstance().getSessions(),
  getAllShots: () => getDefaultInstance().getAllShots(),
  getClubStats: (options) => getDefaultInstance().getClubStats(options),
  getDropInfo: () => getDefaultInstance().getDropInfo(),
  exportData: () => getDefaultInstance().exportData(),
  importData: (payload) => getDefaultInstance().importData(payload),
  clear: () => getDefaultInstance().clear(),
}

export default shotStore
