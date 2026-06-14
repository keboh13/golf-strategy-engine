import { useState, useEffect } from 'react'
import { C, card, lbl, btnG } from '../theme.js'
import { InfoBox } from './ui.jsx'

export default function CourseMapEmbed({ courseName, location, mapsKey }) {
  const [embedStatus, setEmbedStatus] = useState('loading')
  const query    = encodeURIComponent(`${courseName} golf course ${location || ''}`)
  const mapsUrl  = `https://www.google.com/maps/search/${query}`
  const validKey = mapsKey && mapsKey.startsWith('AIza')

  useEffect(() => {
    if (!validKey) return
    setEmbedStatus('loading')
    const embedUrl = `https://www.google.com/maps/embed/v1/place?key=${mapsKey}&q=${query}&zoom=15&maptype=satellite`
    fetch(embedUrl, { method: 'HEAD', mode: 'no-cors' })
      .then(() => setEmbedStatus('ok'))
      .catch(() => setEmbedStatus('error'))
  }, [mapsKey, query, validKey])

  if (!mapsKey) {
    return (
      <div style={{ ...card, marginBottom: 14 }}>
        <p style={{ ...lbl, marginBottom: 8 }}>Satellite view</p>
        <InfoBox>
          <p style={{ fontSize: 12, color: C.blue, margin: 0 }}>
            Add <code>VITE_GOOGLE_MAPS_KEY</code> to your <code>.env</code> file to embed satellite imagery inline.
            Without it, use the link below to open in Google Maps.
          </p>
        </InfoBox>
        <a href={mapsUrl} target="_blank" rel="noreferrer"
          style={{ ...btnG, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          Open {courseName} in Google Maps ↗
        </a>
      </div>
    )
  }

  if (!validKey) {
    return (
      <div style={{ ...card, marginBottom: 14 }}>
        <p style={{ ...lbl, marginBottom: 8 }}>Satellite view</p>
        <div style={{ padding: '10px 14px', background: C.redMuted, border: `1px solid ${C.red}`, borderRadius: 8, marginBottom: 10 }}>
          <p style={{ fontSize: 12, color: C.red, margin: 0 }}>
            ⚠ Invalid key format — Google Maps API keys must start with <code>AIza</code>.
            Get one at <a href="https://console.cloud.google.com" target="_blank" rel="noreferrer" style={{ color: C.red }}>console.cloud.google.com</a> → enable <strong>Maps Embed API</strong>.
          </p>
        </div>
        <a href={mapsUrl} target="_blank" rel="noreferrer"
          style={{ ...btnG, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          Open {courseName} in Google Maps ↗
        </a>
      </div>
    )
  }

  const embedUrl = `https://www.google.com/maps/embed/v1/place?key=${mapsKey}&q=${query}&zoom=15&maptype=satellite`
  return (
    <div style={{ ...card, marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <p style={{ ...lbl, margin: 0 }}>Satellite — {courseName}</p>
        <a href={mapsUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: C.accent, textDecoration: 'none' }}>
          Open full screen ↗
        </a>
      </div>
      <div style={{ borderRadius: 10, overflow: 'hidden', border: `1px solid ${C.border}`, position: 'relative' }}>
        <iframe
          key={embedUrl}
          title="Course satellite view"
          src={embedUrl}
          width="100%" height="500"
          style={{ display: 'block', border: 'none' }}
          allowFullScreen loading="lazy"
          onLoad={e => {
            try { setEmbedStatus(e.target.contentDocument?.title?.toLowerCase().includes('error') ? 'error' : 'ok') } catch { setEmbedStatus('ok') }
          }}
          onError={() => setEmbedStatus('error')}
        />
      </div>
      {embedStatus === 'error' && (
        <div style={{ marginTop: 8, padding: '10px 14px', background: C.redMuted, border: `1px solid ${C.red}`, borderRadius: 8 }}>
          <p style={{ fontSize: 12, color: C.red, margin: '0 0 6px', fontWeight: 600 }}>⚠ Map failed to load — common causes:</p>
          <p style={{ fontSize: 12, color: C.red, margin: 0, lineHeight: 1.6 }}>
            1. Wrong API enabled — go to Google Cloud Console and enable <strong>Maps Embed API</strong> (not Maps JavaScript API)<br />
            2. Key has HTTP referrer restrictions — add <code>localhost:3000/*</code> to the allowed list<br />
            3. Billing not enabled on your Google Cloud project (required even for free tier)
          </p>
        </div>
      )}
      <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
        <a href={mapsUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: C.textFaint, textDecoration: 'none' }}>
          Open in Google Maps as fallback ↗
        </a>
      </div>
    </div>
  )
}
