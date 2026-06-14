import { useState } from 'react'
import { C, card, inp, lbl, btnP } from '../theme.js'
import { useIsMobile, Spin } from './ui.jsx'
import { windDir, computeHoleTimes, getWeatherAtHour, fetchOpenMeteo } from '../lib/weather.js'
import { geocodeViaClaudeSearch } from '../lib/courseApi.js'

export default function WeatherPanel({ authToken, course, coords, setCoords,
                        teeTime, setTeeTime, teeDate, setTeeDate, pace, setPace,
                        timezone, weather, setWeather, weatherLoading, setWeatherLoading }) {
  const isMobile = useIsMobile()
  const [status,     setStatus]     = useState('')
  const [error,      setError]      = useState('')
  const [manualLat,  setManualLat]  = useState('')
  const [manualLng,  setManualLng]  = useState('')
  const [showManual, setShowManual] = useState(false)

  const holeTimes   = computeHoleTimes(teeTime, pace)
  const holeWeather = holeTimes.map(dt => weather ? getWeatherAtHour(weather, dt) : null)

  const doFetch = async (lat, lng, tierLabel) => {
    try {
      const hourly = await fetchOpenMeteo(lat, lng, timezone)
      setWeather(hourly)
      setCoords({ lat, lng })
      setStatus(`Weather loaded via ${tierLabel}`)
      setError('')
      setShowManual(false)
      return true
    } catch {
      return false
    }
  }

  const fetchWeather = async () => {
    if (!course.name) { setError('Enter a course name first.'); return }
    setWeatherLoading(true); setStatus(''); setError('')

    if (coords?.lat) {
      const ok = await doFetch(coords.lat, coords.lng, 'course coordinates')
      if (ok) { setWeatherLoading(false); return }
    }

    if (authToken) {
      setStatus('Geocoding via Claude web search...')
      try {
        const c = await geocodeViaClaudeSearch(authToken, course.name, course.location)
        const ok = await doFetch(c.lat, c.lng, 'Claude geocode')
        if (ok) { setWeatherLoading(false); return }
      } catch {}
    }

    setError(
      `Automatic geocoding failed. This can happen when:\n` +
      `• The course name is ambiguous or misspelled\n` +
      `• You may need to sign in again\n` +
      `• Open-Meteo is temporarily unreachable\n\n` +
      `Enter coordinates manually below (find them on Google Maps).`
    )
    setShowManual(true)
    setWeatherLoading(false)
  }

  const fetchManual = async () => {
    const lat = parseFloat(manualLat), lng = parseFloat(manualLng)
    if (isNaN(lat) || isNaN(lng)) { setError('Enter valid decimal coordinates.'); return }
    setWeatherLoading(true)
    await doFetch(lat, lng, 'manual coordinates')
    setWeatherLoading(false)
  }

  const codes = { 0:'Clear', 1:'Mostly clear', 2:'Partly cloudy', 3:'Overcast', 45:'Foggy', 48:'Rime fog', 51:'Light drizzle', 53:'Drizzle', 55:'Heavy drizzle', 56:'Freezing drizzle', 57:'Heavy freezing drizzle', 61:'Light rain', 63:'Rain', 65:'Heavy rain', 66:'Freezing rain', 67:'Heavy freezing rain', 71:'Light snow', 73:'Snow', 75:'Heavy snow', 77:'Snow grains', 80:'Showers', 81:'Moderate showers', 82:'Heavy showers', 85:'Snow showers', 86:'Heavy snow showers', 95:'Thunderstorm', 96:'Thunderstorm w/ hail', 99:'Severe thunderstorm' }

  return (
    <div style={{ ...card, marginBottom: 12 }}>
      <p style={{ ...lbl, marginBottom: 12 }}>Tee time & live weather</p>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '140px 120px 110px 1fr auto', gap: 10, alignItems: 'flex-end' }}>
        <div>
          <label style={lbl}>Date</label>
          <input type="date" style={inp} value={teeDate} onChange={e => setTeeDate(e.target.value)} />
        </div>
        <div>
          <label style={lbl}>Tee time</label>
          <input type="time" style={inp} value={teeTime} onChange={e => setTeeTime(e.target.value)} />
        </div>
        <div>
          <label style={lbl}>Pace (min/hole)</label>
          <input type="number" style={inp} value={pace} onChange={e => setPace(Number(e.target.value))} min={8} max={20} />
        </div>
        {!isMobile && <div />}
        <button style={{ ...btnP, display: 'flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap', minHeight: 44, ...(isMobile ? { gridColumn: '1 / -1' } : {}) }}
          onClick={fetchWeather} disabled={weatherLoading} aria-label="Fetch live weather forecast">
          {weatherLoading ? <><Spin /> Fetching...</> : '🌤 Fetch live weather'}
        </button>
      </div>

      {status && <p style={{ fontSize: 12, color: C.green, marginTop: 8 }}>✓ {status}</p>}

      {error && (
        <div style={{ marginTop: 10, padding: '10px 14px', background: C.redMuted, border: `1px solid ${C.red}`, borderRadius: 8 }}>
          <p style={{ fontSize: 12, color: C.red, margin: 0, whiteSpace: 'pre-wrap' }}>⚠ {error}</p>
        </div>
      )}

      {showManual && (
        <div style={{ marginTop: 10, padding: '12px 14px', background: C.bgInput, border: `1px solid ${C.border}`, borderRadius: 8 }}>
          <p style={{ ...lbl, marginBottom: 8 }}>Manual coordinates</p>
          <p style={{ fontSize: 11, color: C.textMuted, margin: '0 0 10px' }}>
            Find on Google Maps: right-click the course → "What's here?" → copy the coordinates shown.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '1fr 1fr auto', gap: 8 }}>
            <div>
              <label style={lbl}>Latitude</label>
              <input style={inp} value={manualLat} onChange={e => setManualLat(e.target.value)} placeholder="e.g. 36.0430" />
            </div>
            <div>
              <label style={lbl}>Longitude</label>
              <input style={inp} value={manualLng} onChange={e => setManualLng(e.target.value)} placeholder="e.g. -115.2889" />
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', ...(isMobile ? { gridColumn: '1 / -1' } : {}) }}>
              <button style={{ ...btnP, width: isMobile ? '100%' : 'auto' }} onClick={fetchManual} disabled={weatherLoading}>Fetch →</button>
            </div>
          </div>
        </div>
      )}

      {weather && holeWeather[0] && (
        <div style={{ marginTop: 14 }}>
          <p style={{ ...lbl, marginBottom: 8 }}>Forecast by hole — {pace} min/hole pace from {teeTime}</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))', gap: 6 }}>
            {holeWeather.slice(0, 18).map((w, i) => w && (
              <div key={i} style={{ background: C.bgInput, border: `1px solid ${C.border}`, borderRadius: 7, padding: '7px 10px' }}>
                <div style={{ fontSize: 10, color: C.textFaint, marginBottom: 4 }}>
                  Hole {i + 1} · {holeTimes[i]?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
                <span style={{ fontSize: 11, color: C.blue }}>🌡 {Math.round(w.temp)}°F  </span>
                <span style={{ fontSize: 11, color: C.textMuted }}>💨 {windDir(w.windDir)} {Math.round(w.windSpeed)}mph</span>
                {w.precip > 20 && <span style={{ fontSize: 11, color: C.amber }}> 🌧 {w.precip}%</span>}
                {codes[w.code] && <div style={{ fontSize: 10, color: C.textFaint, marginTop: 2 }}>{codes[w.code]}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
