import { describe, it, expect } from 'vitest'
import { windDir, computeHoleTimes, getWeatherAtHour, toParStr, fetchOpenMeteo } from './weather.js'

describe('windDir', () => {
  it('rounds to the nearest 16-point compass bearing', () => {
    expect(windDir(0)).toBe('N')
    expect(windDir(90)).toBe('E')
    expect(windDir(180)).toBe('S')
    expect(windDir(270)).toBe('W')
    expect(windDir(45)).toBe('NE')
    expect(windDir(225)).toBe('SW')
  })
})

describe('toParStr', () => {
  it('formats par-relative score', () => {
    expect(toParStr(72, 72)).toBe('E')
    expect(toParStr(75, 72)).toBe('+3')
    expect(toParStr(69, 72)).toBe('-3')
    expect(toParStr('abc', 72)).toBe('')
  })
})

describe('computeHoleTimes', () => {
  it('returns empty when no tee time', () => {
    expect(computeHoleTimes('', 12)).toEqual([])
  })

  it('produces 18 evenly-spaced Date objects starting at the tee time', () => {
    const out = computeHoleTimes('08:30', 12)
    expect(out).toHaveLength(18)
    expect(out[0].getHours()).toBe(8)
    expect(out[0].getMinutes()).toBe(30)
    // 12 min/hole × 17 = 204 minutes after tee
    const minsAfter = (out[17].getTime() - out[0].getTime()) / 60000
    expect(minsAfter).toBe(204)
  })
})

describe('getWeatherAtHour', () => {
  it('matches the hourly bucket by ISO prefix', () => {
    const hourly = {
      time: ['2026-06-14T08:00', '2026-06-14T09:00', '2026-06-14T10:00'],
      temperature_2m: [60, 65, 70],
      windspeed_10m: [5, 6, 7],
      winddirection_10m: [180, 190, 200],
      precipitation_probability: [10, 15, 20],
      weathercode: [1, 2, 3],
    }
    const dt = new Date('2026-06-14T09:30:00Z')
    const w = getWeatherAtHour(hourly, dt)
    expect(w.temp).toBe(65)
    expect(w.windSpeed).toBe(6)
    expect(w.code).toBe(2)
  })

  it('returns null when no matching bucket', () => {
    const hourly = { time: ['2026-06-14T08:00'], temperature_2m: [60], windspeed_10m: [5], winddirection_10m: [180], precipitation_probability: [10], weathercode: [1] }
    expect(getWeatherAtHour(hourly, new Date('2030-01-01T00:00:00Z'))).toBe(null)
  })
})

// ── Live integration check ──────────────────────────────────────────────────
// Hits the public Open-Meteo API. Marked optional so it doesn't fail builds
// in offline environments — pass `SKIP_NETWORK_TESTS=1` to skip.
const skipNetwork = !!process.env.SKIP_NETWORK_TESTS

describe.skipIf(skipNetwork)('fetchOpenMeteo (live)', () => {
  it('returns hourly forecast in the expected shape for Pebble Beach', async () => {
    const hourly = await fetchOpenMeteo(36.5685, -121.9499, 'America/Los_Angeles')
    expect(hourly).toBeTruthy()
    expect(Array.isArray(hourly.time)).toBe(true)
    expect(hourly.time.length).toBeGreaterThan(24) // at least one full day
    for (const k of ['temperature_2m', 'windspeed_10m', 'winddirection_10m', 'precipitation_probability', 'weathercode']) {
      expect(Array.isArray(hourly[k]), `${k} should be array`).toBe(true)
      expect(hourly[k].length).toBe(hourly.time.length)
    }
    // Plausible temperature in Fahrenheit for coastal California
    const t = hourly.temperature_2m[0]
    expect(t).toBeGreaterThan(20)
    expect(t).toBeLessThan(120)
  }, 15000)
})
