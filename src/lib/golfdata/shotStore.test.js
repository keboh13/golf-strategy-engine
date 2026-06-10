import { describe, it, expect, beforeEach } from 'vitest'
import shotStoreDefault, {
  createShotStore,
  aggregateClubStats,
  SHOT_STORE_KEY,
  MAX_STORED_SHOTS,
  DEFAULT_HALF_LIFE_DAYS,
} from './shotStore.js'

// Minimal localStorage-compatible mock backed by a Map.
function createMockStorage() {
  const map = new Map()
  return {
    map,
    getItem(key) {
      return map.has(key) ? map.get(key) : null
    },
    setItem(key, value) {
      map.set(key, String(value))
    },
    removeItem(key) {
      map.delete(key)
    },
  }
}

function makeShot(overrides = {}) {
  return {
    clubKey: '7i',
    clubLabel: '7 Iron',
    carryYds: 165,
    totalYds: 172,
    offlineYds: 3,
    ballSpeedMph: 118,
    clubSpeedMph: 84,
    launchDeg: 17.5,
    spinRpm: 6500,
    apexFt: 92,
    timestamp: null,
    ...overrides,
  }
}

function makeShots(count, tag) {
  // Distinct timestamps -> distinct dedupe keys.
  return Array.from({ length: count }, (_, i) =>
    makeShot({ timestamp: `${tag}-${i}`, carryYds: 150 + (i % 40) })
  )
}

function makeSession(overrides = {}) {
  return {
    source: 'trackman',
    sessionDate: '2026-06-01',
    unitsDetected: 'yards',
    shots: [makeShot()],
    warnings: [],
    ...overrides,
  }
}

describe('shotStore', () => {
  let storage
  let store

  beforeEach(() => {
    storage = createMockStorage()
    store = createShotStore(storage)
  })

  describe('append/get round-trip', () => {
    it('stores a session and reads it back', () => {
      const session = makeSession({ shots: makeShots(3, 'a') })
      const result = store.appendSession(session)

      expect(result).toEqual({ added: 3, duplicates: 0 })

      const sessions = store.getSessions()
      expect(sessions).toHaveLength(1)
      expect(sessions[0].source).toBe('trackman')
      expect(sessions[0].sessionDate).toBe('2026-06-01')
      expect(sessions[0].unitsDetected).toBe('yards')
      expect(sessions[0].shots).toHaveLength(3)
      expect(sessions[0].shots[0]).toEqual(session.shots[0])

      expect(store.getAllShots()).toHaveLength(3)
    })

    it('persists under the gse_shots key with version 1', () => {
      store.appendSession(makeSession())
      const stored = JSON.parse(storage.getItem(SHOT_STORE_KEY))
      expect(stored.version).toBe(1)
      expect(stored.sessions).toHaveLength(1)
    })

    it('is readable by a fresh store instance over the same storage', () => {
      store.appendSession(makeSession({ shots: makeShots(2, 'a') }))
      const other = createShotStore(storage)
      expect(other.getAllShots()).toHaveLength(2)
    })

    it('flattens shots across multiple sessions in getAllShots', () => {
      store.appendSession(makeSession({ shots: makeShots(2, 'a'), sessionDate: '2026-06-01' }))
      store.appendSession(makeSession({ shots: makeShots(3, 'b'), sessionDate: '2026-06-02' }))
      expect(store.getSessions()).toHaveLength(2)
      expect(store.getAllShots()).toHaveLength(5)
    })
  })

  describe('dedupe', () => {
    it('counts re-imported shots as duplicates and does not store them again', () => {
      const session = makeSession({ shots: makeShots(3, 'a') })
      store.appendSession(session)

      const again = store.appendSession(makeSession({ shots: makeShots(3, 'a') }))
      expect(again).toEqual({ added: 0, duplicates: 3 })
      expect(store.getAllShots()).toHaveLength(3)
      // No empty session should have been appended.
      expect(store.getSessions()).toHaveLength(1)
    })

    it('keeps shots whose only difference is the timestamp', () => {
      const a = makeShot({ timestamp: '2026-06-01T10:00:00Z' })
      const b = makeShot({ timestamp: '2026-06-01T10:01:00Z' })
      const result = store.appendSession(makeSession({ shots: [a, b] }))
      expect(result).toEqual({ added: 2, duplicates: 0 })
    })

    it('dedupes identical shots within a single incoming session', () => {
      const shot = makeShot({ timestamp: null })
      const result = store.appendSession(makeSession({ shots: [shot, { ...shot }] }))
      expect(result).toEqual({ added: 1, duplicates: 1 })
      expect(store.getAllShots()).toHaveLength(1)
    })

    it('treats the same shot from a different source as distinct', () => {
      const shot = makeShot({ timestamp: '2026-06-01T10:00:00Z' })
      store.appendSession(makeSession({ source: 'trackman', shots: [shot] }))
      const result = store.appendSession(
        makeSession({ source: 'garmin-r10', shots: [{ ...shot }] })
      )
      expect(result).toEqual({ added: 1, duplicates: 0 })
      expect(store.getAllShots()).toHaveLength(2)
    })
  })

  describe('5000-shot cap', () => {
    it('drops oldest sessions (nulls oldest) when the cap is exceeded', () => {
      store.appendSession(
        makeSession({ sessionDate: null, shots: makeShots(1000, 'old') })
      )
      store.appendSession(
        makeSession({ sessionDate: '2026-05-01', shots: makeShots(2500, 'mid') })
      )
      store.appendSession(
        makeSession({ sessionDate: '2026-06-01', shots: makeShots(2000, 'new') })
      )

      // 1000 + 2500 + 2000 = 5500 > 5000, so the null-dated session goes.
      const sessions = store.getSessions()
      expect(sessions.map((s) => s.sessionDate)).toEqual(['2026-05-01', '2026-06-01'])
      expect(store.getAllShots()).toHaveLength(4500)
      expect(store.getAllShots().length).toBeLessThanOrEqual(MAX_STORED_SHOTS)

      // The drop is recorded in the stored object so callers can warn.
      const stored = JSON.parse(storage.getItem(SHOT_STORE_KEY))
      expect(stored.droppedSessions).toBe(1)
      expect(stored.droppedShots).toBe(1000)
      expect(store.getDropInfo()).toEqual({ droppedSessions: 1, droppedShots: 1000 })
    })

    it('drops multiple oldest sessions if needed', () => {
      store.appendSession(
        makeSession({ sessionDate: '2026-01-01', shots: makeShots(200, 's1') })
      )
      store.appendSession(
        makeSession({ sessionDate: '2026-02-01', shots: makeShots(300, 's2') })
      )
      store.appendSession(
        makeSession({ sessionDate: '2026-06-01', shots: makeShots(4900, 's3') })
      )

      expect(store.getSessions().map((s) => s.sessionDate)).toEqual(['2026-06-01'])
      expect(store.getAllShots()).toHaveLength(4900)
      expect(store.getDropInfo().droppedSessions).toBe(2)
    })
  })

  describe('corrupt or missing stored JSON', () => {
    it('treats missing data as an empty store', () => {
      expect(store.getSessions()).toEqual([])
      expect(store.getAllShots()).toEqual([])
    })

    it('recovers from unparseable JSON without throwing', () => {
      storage.setItem(SHOT_STORE_KEY, '{not valid json!!')
      expect(store.getSessions()).toEqual([])

      const result = store.appendSession(makeSession())
      expect(result.added).toBe(1)
      expect(store.getAllShots()).toHaveLength(1)
    })

    it('treats a wrong-shaped stored value as empty', () => {
      storage.setItem(SHOT_STORE_KEY, JSON.stringify({ version: 1, sessions: 'nope' }))
      expect(store.getSessions()).toEqual([])

      storage.setItem(SHOT_STORE_KEY, JSON.stringify([1, 2, 3]))
      expect(store.getSessions()).toEqual([])
    })
  })

  describe('storage quota errors', () => {
    function failSetItem(times) {
      const original = storage.setItem.bind(storage)
      let remaining = times
      storage.setItem = (key, value) => {
        if (remaining !== 0) {
          if (remaining > 0) remaining -= 1
          const err = new Error('exceeded the quota')
          err.name = 'QuotaExceededError'
          throw err
        }
        original(key, value)
      }
    }

    it('drops oldest sessions and retries once when setItem throws', () => {
      store.appendSession(
        makeSession({ sessionDate: '2026-01-01', shots: makeShots(4, 'old') })
      )
      store.appendSession(
        makeSession({ sessionDate: '2026-05-01', shots: makeShots(1, 'mid') })
      )

      failSetItem(1)
      const result = store.appendSession(
        makeSession({ sessionDate: '2026-06-01', shots: makeShots(1, 'new') })
      )

      expect(result).toEqual({ added: 1, duplicates: 0 })
      // 6 shots total -> retry targets <= 3 -> only the 4-shot oldest session drops.
      expect(store.getSessions().map((s) => s.sessionDate)).toEqual([
        '2026-05-01',
        '2026-06-01',
      ])
      expect(store.getDropInfo().droppedSessions).toBe(1)
      expect(store.getDropInfo().droppedShots).toBe(4)
    })

    it('throws a user-readable error when storage keeps failing', () => {
      store.appendSession(
        makeSession({ sessionDate: '2026-01-01', shots: makeShots(2, 'old') })
      )

      failSetItem(-1) // always throw
      expect(() =>
        store.appendSession(
          makeSession({ sessionDate: '2026-06-01', shots: makeShots(2, 'new') })
        )
      ).toThrow(/storage is full/i)
    })

    it('throws a user-readable error when there is nothing left to drop', () => {
      failSetItem(-1) // always throw, single session means no drop candidates
      expect(() => store.appendSession(makeSession())).toThrow(/storage is full/i)
    })
  })

  describe('aggregateClubStats', () => {
    const NOW = Date.parse('2026-06-10T00:00:00Z')
    const plain = { recencyWeighting: false }

    it('groups shots by clubKey and computes carry mean/std/min/max', () => {
      const sessions = [
        makeSession({
          shots: [
            makeShot({ clubKey: '7i', carryYds: 160, timestamp: 't1' }),
            makeShot({ clubKey: '7i', carryYds: 170, timestamp: 't2' }),
            makeShot({ clubKey: 'dr', clubLabel: 'Driver', carryYds: 270, timestamp: 't3' }),
          ],
        }),
      ]
      const stats = aggregateClubStats(sessions, plain)

      expect(stats).toHaveLength(2)
      // Sorted longest club first.
      expect(stats.map((s) => s.clubKey)).toEqual(['dr', '7i'])

      const iron = stats[1]
      expect(iron.clubLabel).toBe('7 Iron')
      expect(iron.count).toBe(2)
      expect(iron.sources).toEqual(['trackman'])
      expect(iron.carry.mean).toBeCloseTo(165)
      // Sample std of [160, 170] = sqrt(50)
      expect(iron.carry.std).toBeCloseTo(Math.sqrt(50))
      expect(iron.carry.min).toBe(160)
      expect(iron.carry.max).toBe(170)
      expect(iron.carry.n).toBe(2)

      const driver = stats[0]
      expect(driver.clubLabel).toBe('Driver')
      expect(driver.count).toBe(1)
      expect(driver.carry.mean).toBe(270)
      expect(driver.carry.std).toBeNull() // single shot: no spread estimate
    })

    it('computes offline dispersion (mean = bias, std = spread)', () => {
      const sessions = [
        makeSession({
          shots: [
            makeShot({ offlineYds: -10, timestamp: 't1' }),
            makeShot({ offlineYds: 2, timestamp: 't2' }),
            makeShot({ offlineYds: 8, timestamp: 't3' }),
          ],
        }),
      ]
      const [stats] = aggregateClubStats(sessions, plain)
      expect(stats.offline.mean).toBeCloseTo(0)
      // Sample std of [-10, 2, 8] around 0 = sqrt((100+4+64)/2)
      expect(stats.offline.std).toBeCloseTo(Math.sqrt(84))
    })

    it('skips non-finite metric values but still counts the shot', () => {
      const sessions = [
        makeSession({
          shots: [
            makeShot({ carryYds: 160, ballSpeedMph: null, timestamp: 't1' }),
            makeShot({ carryYds: NaN, ballSpeedMph: 120, timestamp: 't2' }),
          ],
        }),
      ]
      const [stats] = aggregateClubStats(sessions, plain)
      expect(stats.count).toBe(2)
      expect(stats.carry.n).toBe(1)
      expect(stats.carry.mean).toBe(160)
      expect(stats.ballSpeed).toEqual({ mean: 120, n: 1 })
    })

    it('ignores shots without a clubKey and malformed sessions', () => {
      const sessions = [
        null,
        { source: 'x' }, // no shots array
        makeSession({ shots: [makeShot({ clubKey: '' }), makeShot({ clubKey: '7i' })] }),
      ]
      const stats = aggregateClubStats(sessions, plain)
      expect(stats).toHaveLength(1)
      expect(stats[0].clubKey).toBe('7i')
      expect(stats[0].count).toBe(1)
    })

    it('weights recent shots more than old ones (one half-life apart)', () => {
      const sessions = [
        makeSession({
          sessionDate: null,
          shots: [
            // Old shot, exactly one half-life ago: weight 0.5.
            makeShot({ carryYds: 150, timestamp: '2026-03-12T00:00:00Z' }),
            // Fresh shot: weight 1.
            makeShot({ carryYds: 180, timestamp: '2026-06-10T00:00:00Z' }),
          ],
        }),
      ]
      expect(NOW - Date.parse('2026-03-12T00:00:00Z')).toBe(
        DEFAULT_HALF_LIFE_DAYS * 86400000
      )
      const [stats] = aggregateClubStats(sessions, { now: NOW })
      // Weighted mean = (0.5*150 + 1*180) / 1.5 = 170
      expect(stats.carry.mean).toBeCloseTo(170)
      // Unweighted, the same data averages 165.
      const [unweighted] = aggregateClubStats(sessions, { ...plain, now: NOW })
      expect(unweighted.carry.mean).toBeCloseTo(165)
    })

    it('falls back to the session date when shots have no timestamp', () => {
      const sessions = [
        makeSession({
          sessionDate: '2026-03-12',
          shots: [makeShot({ carryYds: 150, timestamp: null })],
        }),
        makeSession({
          sessionDate: '2026-06-10',
          shots: [makeShot({ carryYds: 180, timestamp: null })],
        }),
      ]
      const [stats] = aggregateClubStats(sessions, { now: NOW })
      // Old session weight 0.5, new session weight 1 -> mean 170.
      expect(stats.carry.mean).toBeCloseTo(170)
      expect(stats.lastShotAt).toBe('2026-06-10T00:00:00.000Z')
    })

    it('gives undated shots full weight instead of discarding them', () => {
      const sessions = [
        makeSession({
          sessionDate: null,
          shots: [
            makeShot({ carryYds: 150, timestamp: null }),
            makeShot({ carryYds: 180, timestamp: '2026-06-10T00:00:00Z' }),
          ],
        }),
      ]
      const [stats] = aggregateClubStats(sessions, { now: NOW })
      expect(stats.carry.n).toBe(2)
      expect(stats.carry.mean).toBeCloseTo(165)
      expect(stats.lastShotAt).toBe('2026-06-10T00:00:00.000Z')
    })

    it('merges the same club across sessions and sources', () => {
      const sessions = [
        makeSession({ source: 'trackman', shots: [makeShot({ carryYds: 160, timestamp: 'a' })] }),
        makeSession({ source: 'garmin-r10', shots: [makeShot({ carryYds: 170, timestamp: 'b' })] }),
      ]
      const [stats] = aggregateClubStats(sessions, plain)
      expect(stats.count).toBe(2)
      expect(stats.carry.mean).toBeCloseTo(165)
      expect(stats.sources).toEqual(['garmin-r10', 'trackman'])
    })

    it('returns an empty array for no data', () => {
      expect(aggregateClubStats([])).toEqual([])
      expect(aggregateClubStats(undefined)).toEqual([])
    })
  })

  describe('getClubStats', () => {
    it('aggregates over everything stored', () => {
      store.appendSession(
        makeSession({
          sessionDate: '2026-06-01',
          shots: [
            makeShot({ clubKey: '7i', carryYds: 160, timestamp: 't1' }),
            makeShot({ clubKey: 'dr', clubLabel: 'Driver', carryYds: 270, timestamp: 't2' }),
          ],
        })
      )
      store.appendSession(
        makeSession({
          sessionDate: '2026-06-02',
          shots: [makeShot({ clubKey: '7i', carryYds: 170, timestamp: 't3' })],
        })
      )

      const stats = store.getClubStats({ recencyWeighting: false })
      expect(stats.map((s) => s.clubKey)).toEqual(['dr', '7i'])
      expect(stats[1].count).toBe(2)
      expect(stats[1].carry.mean).toBeCloseTo(165)
    })

    it('returns an empty array for an empty store', () => {
      expect(store.getClubStats()).toEqual([])
    })
  })

  describe('export / import', () => {
    it('round-trips through exportData/importData into a fresh store', () => {
      store.appendSession(makeSession({ sessionDate: '2026-06-01', shots: makeShots(3, 'a') }))
      store.appendSession(makeSession({ sessionDate: '2026-06-02', shots: makeShots(2, 'b') }))

      const snapshot = JSON.parse(JSON.stringify(store.exportData()))

      const otherStorage = createMockStorage()
      const other = createShotStore(otherStorage)
      const result = other.importData(snapshot)

      expect(result).toEqual({ added: 5, duplicates: 0 })
      expect(other.getSessions()).toHaveLength(2)
      expect(other.getAllShots()).toEqual(store.getAllShots())
    })

    it('dedupes when importing overlapping data', () => {
      store.appendSession(makeSession({ sessionDate: '2026-06-01', shots: makeShots(3, 'a') }))
      const snapshot = store.exportData()

      store.appendSession(makeSession({ sessionDate: '2026-06-02', shots: makeShots(2, 'b') }))
      const result = store.importData(snapshot)

      expect(result).toEqual({ added: 0, duplicates: 3 })
      expect(store.getAllShots()).toHaveLength(5)
    })

    it('rejects malformed payloads and skips malformed sessions', () => {
      expect(() => store.importData(null)).toThrow(/sessions array/)
      expect(() => store.importData({ sessions: 'nope' })).toThrow(/sessions array/)

      const result = store.importData({
        sessions: [null, { source: 'x' }, makeSession({ shots: makeShots(2, 'a') })],
      })
      expect(result).toEqual({ added: 2, duplicates: 0 })
    })
  })

  describe('clear()', () => {
    it('removes all stored data', () => {
      store.appendSession(makeSession({ shots: makeShots(3, 'a') }))
      store.clear()
      expect(store.getSessions()).toEqual([])
      expect(store.getAllShots()).toEqual([])
      expect(storage.getItem(SHOT_STORE_KEY)).toBeNull()
    })
  })

  describe('default instance', () => {
    it('is importable in node without touching localStorage', () => {
      expect(typeof shotStoreDefault.appendSession).toBe('function')
      expect(typeof shotStoreDefault.getSessions).toBe('function')
      expect(typeof shotStoreDefault.getAllShots).toBe('function')
      expect(typeof shotStoreDefault.clear).toBe('function')
    })
  })
})
