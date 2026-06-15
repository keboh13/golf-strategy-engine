import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { C, card, lbl } from '../theme.js'
import { computeHoleDistances, formatDistancesLine } from '../lib/courseGeometry.js'

// Always-on satellite map. Decoupled from OSM completion: it boots as soon
// as `coords` are known and lays overlays on top as `geojson` arrives. When
// no per-hole bbox is available (Tier 3 or unmapped holes), it frames the
// whole course around `coords` at a wide zoom so the player still sees the
// satellite — not a placeholder.

const ESRI_TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

const STYLE = {
  version: 8,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    sat: {
      type: 'raster',
      tiles: [ESRI_TILES],
      tileSize: 256,
      attribution: 'Imagery © Esri, Maxar, Earthstar Geographics · Course data © OpenStreetMap contributors (ODbL)',
    },
  },
  layers: [{ id: 'sat', type: 'raster', source: 'sat' }],
}

const LAYER_STYLES = {
  fairway: { color: '#5a9e5a', opacity: 0.35 },
  water:   { color: '#38bdf8', opacity: 0.55 },
  bunker:  { color: '#d4a944', opacity: 0.7  },
  green:   { color: '#3a7d44', opacity: 0.65 },
}
const POLY_ORDER = ['fairway', 'water', 'bunker', 'green']

function filterForHole(geojson, holeRef) {
  if (!geojson?.features) return { type: 'FeatureCollection', features: [] }
  return {
    type: 'FeatureCollection',
    features: geojson.features.filter(f => f.properties?.holeRef === holeRef),
  }
}

export default function CourseHoleMap({
  courseName,
  coords,           // { lat, lng } — required; the map will frame here when no hole bbox
  geojson,          // optional FeatureCollection from exportCourseGeoJSON
  bboxByHole,       // optional { [ref]: [w,s,e,n] }
  holes,            // array of hole objects with `.num`
  coverage,         // optional per-hole coverage map
  tier,             // 1 | 2 | 3 | undefined — drives the inline banner copy
  selectedHole,     // number — currently selected hole ref
  onSelectHole,     // (ref) => void
}) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const pinMarkerRef = useRef(null)
  const [ready, setReady] = useState(false)

  // Init map once `coords` are known. Critical for perf: we don't wait for
  // OSM/Overpass to finish — the satellite renders the moment we know where
  // the course is.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    if (!coords?.lat || !coords?.lng) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE,
      attributionControl: false,
      center: [coords.lng, coords.lat],
      zoom: 15.5, // wide enough to show the whole course
    })
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    map.on('load', () => {
      map.addSource('hole', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      for (const kind of POLY_ORDER) {
        const s = LAYER_STYLES[kind]
        map.addLayer({
          id: `hole-${kind}`,
          type: 'fill',
          source: 'hole',
          filter: ['==', ['get', 'kind'], kind],
          paint: { 'fill-color': s.color, 'fill-opacity': s.opacity, 'fill-outline-color': s.color },
        })
      }
      map.addLayer({
        id: 'hole-centerline',
        type: 'line',
        source: 'hole',
        filter: ['==', ['get', 'kind'], 'centerline'],
        paint: { 'line-color': '#fbbf24', 'line-width': 2, 'line-dasharray': [2, 2] },
      })
      mapRef.current = map
      setReady(true)
    })
    return () => {
      pinMarkerRef.current?.remove()
      pinMarkerRef.current = null
      map.remove()
      mapRef.current = null
      setReady(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coords?.lat, coords?.lng])

  // Frame/overlay updates when the selected hole or geojson changes.
  useEffect(() => {
    if (!ready || !mapRef.current) return
    const map = mapRef.current
    const fc = filterForHole(geojson, selectedHole)
    map.getSource('hole')?.setData(fc)

    const bbox = selectedHole != null ? bboxByHole?.[selectedHole] : null
    if (bbox) {
      // Tier 1/2 — we have hole-level geometry: zoom into the hole
      map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 50, duration: 600, maxZoom: 18 })
    } else if (coords?.lat) {
      // No hole bbox — keep the whole-course view centered on coords. This
      // is the Tier 3 / unmapped-hole path: satellite still useful.
      map.easeTo({ center: [coords.lng, coords.lat], zoom: 15.5, duration: 600 })
    }

    pinMarkerRef.current?.remove()
    pinMarkerRef.current = null
    const pinFeat = fc.features.find(f => f.properties?.kind === 'pin')
    if (pinFeat) {
      const el = document.createElement('div')
      el.style.cssText = 'width:14px;height:14px;border-radius:50%;background:#ef4444;border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,0.4)'
      pinMarkerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat(pinFeat.geometry.coordinates)
        .addTo(map)
    }
  }, [ready, selectedHole, geojson, bboxByHole, coords?.lat, coords?.lng])

  const holeRefs = useMemo(() => {
    return holes?.map(h => h.num || h.ref).filter(n => n >= 1 && n <= 18) || []
  }, [holes])

  const distances = useMemo(() => {
    if (selectedHole == null) return null
    return computeHoleDistances(geojson, selectedHole)
  }, [geojson, selectedHole])

  const cov = (coverage && selectedHole != null) ? coverage[selectedHole] : null
  const coverageBadge = cov ? buildCoverageBadge(cov) : null
  const hasHoleGeometry = !!bboxByHole?.[selectedHole]

  const banner = (() => {
    if (tier === 3 || (!geojson && coords?.lat)) {
      return {
        tone: 'blue',
        title: 'Satellite view only',
        body: "This course isn't mapped in OpenStreetMap yet, so we can't draw hole boundaries or compute carry distances. The satellite is still useful for picking lines.",
      }
    }
    if (tier === 2 && !hasHoleGeometry) {
      return {
        tone: 'amber',
        title: 'Hole boundaries not mapped',
        body: 'This hole has no OSM polygons — showing the course area. Other holes on this course do have geometry; try the hole buttons above.',
      }
    }
    return null
  })()

  return (
    <div style={{ ...card, marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
        <p style={{ ...lbl, margin: 0 }}>Course map — {courseName}</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {coverageBadge && (
            <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 999, background: C.bgInput, border: `1px solid ${C.border}`, color: C.textMuted }}>
              {coverageBadge}
            </span>
          )}
          {selectedHole != null && <span style={{ fontSize: 11, color: C.textMuted }}>Hole {selectedHole}</span>}
        </div>
      </div>

      {holeRefs.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
          {holeRefs.map(n => (
            <button
              key={n}
              onClick={() => onSelectHole?.(n)}
              style={{
                width: 30, height: 30, borderRadius: 6, fontSize: 12, fontFamily: 'inherit', cursor: 'pointer',
                background: selectedHole === n ? C.accent : C.bgInput,
                color: selectedHole === n ? '#0f1117' : C.text,
                border: `1px solid ${selectedHole === n ? C.accent : C.border}`,
              }}
            >{n}</button>
          ))}
        </div>
      )}

      <div
        ref={containerRef}
        style={{ height: 480, borderRadius: 10, overflow: 'hidden', border: `1px solid ${C.border}`, background: '#0c1410' }}
      />
      {!coords?.lat && (
        <p style={{ marginTop: 10, fontSize: 11, color: C.textMuted, fontStyle: 'italic' }}>
          Course coordinates not yet known — fetch live weather to geocode the course, then the map will load.
        </p>
      )}

      {banner && (
        <div
          style={{
            marginTop: 10, padding: '8px 12px', borderRadius: 8,
            background: banner.tone === 'amber' ? C.amberMuted : C.blueMuted,
            border: `1px solid ${banner.tone === 'amber' ? C.amber : C.blue}`,
          }}
        >
          <p style={{ fontSize: 11, color: banner.tone === 'amber' ? C.amber : C.blue, margin: 0, lineHeight: 1.5 }}>
            <strong>{banner.title}.</strong> {banner.body}
          </p>
        </div>
      )}

      {distances && (
        <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 12, color: C.text }}>
          <DistChip label="Tee → pin"     value={`${distances.teeToPin}y`} />
          {distances.frontY  != null && <DistChip label="Front"  value={`${distances.frontY}y`} />}
          {distances.centerY != null && <DistChip label="Center" value={`${distances.centerY}y`} />}
          {distances.backY   != null && <DistChip label="Back"   value={`${distances.backY}y`} />}
          {distances.carries.map((c, i) => (
            <DistChip
              key={i}
              label={`Carry ${c.kind} ${c.side}`}
              value={`${c.yards}y`}
              tone={c.kind === 'water' ? 'water' : 'sand'}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function DistChip({ label, value, tone }) {
  const bg = tone === 'water' ? '#0c2a3d' : tone === 'sand' ? '#2d1f08' : C.bgInput
  const border = tone === 'water' ? '#1e4a66' : tone === 'sand' ? '#5a3f0f' : C.border
  return (
    <span style={{
      padding: '4px 10px', borderRadius: 8, background: bg, border: `1px solid ${border}`,
      display: 'inline-flex', gap: 6, alignItems: 'baseline',
    }}>
      <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: C.textMuted }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 600 }}>{value}</span>
    </span>
  )
}

function buildCoverageBadge(cov) {
  const parts = []
  if (cov.green) parts.push('green')
  if (cov.fairway) parts.push('fairway')
  if (cov.bunker) parts.push('bunkers')
  if (cov.water) parts.push('water')
  if (!parts.length) return null
  return parts.join(' + ') + ' mapped'
}

export { formatDistancesLine }
