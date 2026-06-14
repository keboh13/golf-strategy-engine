export function windDir(deg) {
  const d = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW']
  return d[Math.round(deg / 22.5) % 16]
}

export function computeHoleTimes(teeTime, pace) {
  if (!teeTime) return []
  const [h, m] = teeTime.split(':').map(Number)
  const base = new Date(); base.setHours(h, m, 0, 0)
  return Array.from({ length: 18 }, (_, i) => new Date(base.getTime() + i * pace * 60000))
}

export function getWeatherAtHour(hourly, dt) {
  const iso = dt.toISOString()
  const idx = hourly.time.findIndex(t => t.startsWith(iso.slice(0, 13)))
  if (idx === -1) return null
  return {
    temp:      hourly.temperature_2m[idx],
    windSpeed: hourly.windspeed_10m[idx],
    windDir:   hourly.winddirection_10m[idx],
    precip:    hourly.precipitation_probability[idx],
    code:      hourly.weathercode[idx],
  }
}

export function toParStr(score, par = 72) {
  const diff = parseInt(score) - par
  if (isNaN(diff)) return ''
  return diff === 0 ? 'E' : diff > 0 ? `+${diff}` : String(diff)
}

export async function fetchOpenMeteo(lat, lng, timezone) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&hourly=temperature_2m,windspeed_10m,winddirection_10m,precipitation_probability,weathercode` +
    `&temperature_unit=fahrenheit&windspeed_unit=mph&forecast_days=2&timezone=${encodeURIComponent(timezone)}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Open-Meteo error: ${res.status}`)
  const data = await res.json()
  return data.hourly
}
