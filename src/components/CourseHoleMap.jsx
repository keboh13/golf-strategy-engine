import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { C, card, lbl } from '../theme.js'
import { computeHoleDistances, formatDistancesLine } from '../lib/courseGeometry.js'

// Always-on satellite map. Decoupled from OSM completion: it boots as soon
// as `coords` are known and lays overlays on top as `geojson` arrives. When
// no per-hole bbox is available (Tier 3 or unmapped holes), it frames the
// whole course around `coords` at a wide zoom so the player still sees the
// satellite — not a placeholder.
//
// Two affordances make the satellite usable even without OSM data:
//   1. A prominent floating "Hole N" badge sits on top of the canvas so the
//      player always knows which hole they're looking at — answers the
//      original "I can't tell which hole" complaint.
//   2. Contribute mode: tap-tee, tap-pin lets the user mark the hole and
//      synthesizes a centerline. The saved pair flows back to the parent
//      via onContribute and ends up in Supabase so the next user benefits.

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

function extractPar(hole) {
  if (!hole) return null
  if (hole.par) return hole.par
  const txt = hole.content || hole.notes || ''
  const m = txt.match(/Par\s+(\d)/i)
  return m ? parseInt(m[1]) : null
}

function extractYardage(hole) {
  if (!hole) return null
  if (hole.yardage) return hole.yardage
  const txt = hole.content || hole.notes || ''
  const m = txt.match(/(\d{3,4})\s*(?:y|yd|yds|yards)/i)
  return m ? m[1] : null
}

export default function CourseHoleMap({
  courseName,
  coords,           // { lat, lng } — required; the map will frame here when no hole bbox
  geojson,          // optional FeatureCollection from exportCourseGeoJSON
  bboxByHole,       // optional { [ref]: [w,s,e,n] }
  holes,            // array of hole objects with `.num` and optional .par / .yardage
  coverage,         // optional per-hole coverage map
  tier,             // 1 | 2 | 3 | undefined — drives the inline banner copy
  selectedHole,     // number — currently selected hole ref
  onSelectHole,     // (ref) => void
  onContribute,     // async ({ ref, teeLng, teeLat, pinLng, pinLat }) => void
  contributedHoles, // Set<number> | undefined — which holes have a contribution
}) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const pinMarkerRef = useRef(null)
  const draftMarkersRef = useRef([])
  const [ready, setReady] = useState(false)
  const [contribStep, setContribStep] = useState(null) // null | 'tee' | 'pin'
  const [teeDraft, setTeeDraft] = useState(null)       // [lng, lat]
  const [saving, setSaving] = useState(false)

  const contribute = !!onContribute
  const inContribMode = contribStep != null

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
      zoom: 15.5,
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
        paint: { 'line-color': '#fbbf24', 'line-width': 3, 'line-dasharray': [2, 2] },
      })
      mapRef.current = map
      setReady(true)
    })
    return () => {
      pinMarkerRef.current?.remove()
      pinMarkerRef.current = null
      draftMarkersRef.current.forEach(m => m.remove())
      draftMarkersRef.current = []
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
      map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 50, duration: 600, maxZoom: 18 })
    } else if (coords?.lat) {
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

  // Contribute mode: install click handler on the canvas.
  useEffect(() => {
    if (!ready || !mapRef.current) return
    const map = mapRef.current
    if (!inContribMode) {
      map.getCanvas().style.cursor = ''
      return
    }
    map.getCanvas().style.cursor = 'crosshair'
    const onClick = (e) => {
      const lngLat = [e.lngLat.lng, e.lngLat.lat]
      if (contribStep === 'tee') {
        setTeeDraft(lngLat)
        const el = document.createElement('div')
        el.style.cssText = 'width:12px;height:12px;border-radius:50%;background:#22c55e;border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,0.5)'
        const m = new maplibregl.Marker({ element: el }).setLngLat(lngLat).addTo(map)
        draftMarkersRef.current.push(m)
        setContribStep('pin')
      } else if (contribStep === 'pin') {
        const el = document.createElement('div')
        el.style.cssText = 'width:14px;height:14px;border-radius:50%;background:#ef4444;border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,0.5)'
        const m = new maplibregl.Marker({ element: el }).setLngLat(lngLat).addTo(map)
        draftMarkersRef.current.push(m)
        ;(async () => {
          setSaving(true)
          try {
            await onContribute?.({
              ref: selectedHole,
              teeLng: teeDraft[0], teeLat: teeDraft[1],
              pinLng: lngLat[0],   pinLat: lngLat[1],
            })
          } finally {
            setSaving(false)
            setContribStep(null)
            setTeeDraft(null)
            draftMarkersRef.current.forEach(m => m.remove())
            draftMarkersRef.current = []
          }
        })()
      }
    }
    map.on('click', onClick)
    return () => { map.off('click', onClick); map.getCanvas().style.cursor = '' }
  }, [ready, inContribMode, contribStep, teeDraft, selectedHole, onContribute])

  // Reset contrib draft if user navigates to a different hole mid-flow.
  useEffect(() => {
    if (contribStep != null) {
      setContribStep(null)
      setTeeDraft(null)
      draftMarkersRef.current.forEach(m => m.remove())
      draftMarkersRef.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedHole])

  const holeRefs = useMemo(() => {
    return holes?.map(h => h.num || h.ref).filter(n => n >= 1 && n <= 18) || []
  }, [holes])

  const currentIdx = useMemo(() => holeRefs.indexOf(selectedHole), [holeRefs, selectedHole])
  const prevRef = currentIdx > 0 ? holeRefs[currentIdx - 1] : null
  const nextRef = currentIdx >= 0 && currentIdx < holeRefs.length - 1 ? holeRefs[currentIdx + 1] : null

  const currentHole = useMemo(() => holes?.find(h => (h.num || h.ref) === selectedHole), [holes, selectedHole])
  const currentPar = extractPar(currentHole)
  const currentYards = extractYardage(currentHole)

  const distances = useMemo(() => {
    if (selectedHole == null) return null
    return computeHoleDistances(geojson, selectedHole)
  }, [geojson, selectedHole])

  const cov = (coverage && selectedHole != null) ? coverage[selectedHole] : null
  const coverageBadge = cov ? buildCoverageBadge(cov) : null
  const hasHoleGeometry = !!bboxByHole?.[selectedHole]
  const isContributed = contributedHoles?.has?.(selectedHole)

  const startContribute = useCallback(() => {
    if (!contribute || selectedHole == null) return
    setContribStep('tee')
    setTeeDraft(null)
    draftMarkersRef.current.forEach(m => m.remove())
    draftMarkersRef.current = []
  }, [contribute, selectedHole])

  const cancelContribute = useCallback(() => {
    setContribStep(null)
    setTeeDraft(null)
    draftMarkersRef.current.forEach(m => m.remove())
    draftMarkersRef.current = []
  }, [])

  const banner = (() => {
    if (inContribMode) return null
    if (tier === 3 || (!geojson && coords?.lat)) {
      return {
        tone: 'blue',
        title: 'Satellite view only',
        body: "This course isn't mapped in OpenStreetMap yet. Tap “Mark this hole” to drop a tee and pin — we’ll draw the line and compute carry distances for you, and other players on this course will see it too.",
      }
    }
    if (tier === 2 && !hasHoleGeometry) {
      return {
        tone: 'amber',
        title: 'Hole boundaries not mapped',
        body: 'Other holes on this course do have geometry — try the hole strip. Or tap “Mark this hole” to add a tee→pin line yourself.',
      }
    }
    return null
  })()

  return (
    <div style={{ ...card, marginBottom: 14 }}>
      {/* Header row: course name + coverage + contribute control */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
        <p style={{ ...lbl, margin: 0 }}>Course map — {courseName}</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {coverageBadge && (
            <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 999, background: C.bgInput, border: `1px solid ${C.border}`, color: C.textMuted }}>
              {coverageBadge}
            </span>
          )}
          {isContributed && (
            <span title="You contributed this hole's geometry" style={{ fontSize: 10, padding: '2px 8px', borderRadius: 999, background: '#1a2e1a', border: '1px solid #2d5a2d', color: '#34d399' }}>
              user-mapped
            </span>
          )}
        </div>
      </div>

      {/* Hole nav strip: prev arrow, hole dots, next arrow */}
      {holeRefs.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
          <button
            disabled={!prevRef}
            onClick={() => prevRef && onSelectHole?.(prevRef)}
            style={navBtnStyle(!prevRef)}
            title={prevRef ? `Hole ${prevRef}` : ''}
          >‹</button>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, flex: 1 }}>
            {holeRefs.map(n => {
              const mapped = !!bboxByHole?.[n]
              const userMapped = contributedHoles?.has?.(n)
              return (
                <button
                  key={n}
                  onClick={() => onSelectHole?.(n)}
                  title={mapped ? `Hole ${n} — mapped` : `Hole ${n} — satellite only`}
                  style={{
                    width: 30, height: 30, borderRadius: 6, fontSize: 12, fontFamily: 'inherit', cursor: 'pointer',
                    background: selectedHole === n ? C.accent : C.bgInput,
                    color: selectedHole === n ? '#0f1117' : (mapped ? C.text : C.textMuted),
                    border: `1px solid ${selectedHole === n ? C.accent : (userMapped ? '#2d5a2d' : (mapped ? C.borderHover : C.border))}`,
                    position: 'relative',
                  }}
                >{n}</button>
              )
            })}
          </div>
          <button
            disabled={!nextRef}
            onClick={() => nextRef && onSelectHole?.(nextRef)}
            style={navBtnStyle(!nextRef)}
            title={nextRef ? `Hole ${nextRef}` : ''}
          >›</button>
        </div>
      )}

      {/* Map canvas with floating hole-context overlay */}
      <div style={{ position: 'relative' }}>
        <div
          ref={containerRef}
          style={{ height: 480, borderRadius: 10, overflow: 'hidden', border: `1px solid ${C.border}`, background: '#0c1410' }}
        />
        {selectedHole != null && coords?.lat && (
          <div
            style={{
              position: 'absolute', top: 10, left: 10, zIndex: 2,
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 12px', borderRadius: 999,
              background: 'rgba(15, 17, 23, 0.85)', backdropFilter: 'blur(6px)',
              border: `1px solid ${C.borderHover}`,
              boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
              pointerEvents: 'none',
            }}
          >
            <span style={{ fontSize: 16, fontWeight: 700, color: '#fff', letterSpacing: '0.02em' }}>
              Hole {selectedHole}
            </span>
            {currentPar != null && (
              <span style={{ fontSize: 11, color: C.textMuted, borderLeft: `1px solid ${C.border}`, paddingLeft: 8 }}>
                Par {currentPar}
              </span>
            )}
            {currentYards && (
              <span style={{ fontSize: 11, color: C.textMuted }}>
                {currentYards}y
              </span>
            )}
            {!hasHoleGeometry && (
              <span style={{ fontSize: 10, color: C.amber, borderLeft: `1px solid ${C.border}`, paddingLeft: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                satellite
              </span>
            )}
          </div>
        )}

        {/* Contribute mode floating prompt */}
        {inContribMode && (
          <div
            style={{
              position: 'absolute', top: 10, right: 10, zIndex: 3,
              padding: '8px 14px', borderRadius: 10,
              background: 'rgba(34, 197, 94, 0.95)', color: '#04140a',
              fontWeight: 600, fontSize: 12, maxWidth: 280,
              boxShadow: '0 2px 12px rgba(0,0,0,0.6)',
            }}
          >
            {saving ? (
              <span>Saving…</span>
            ) : contribStep === 'tee' ? (
              <>
                <div style={{ fontSize: 13 }}>Step 1 of 2 — tap the TEE</div>
                <div style={{ fontSize: 11, marginTop: 2, opacity: 0.85, fontWeight: 500 }}>Hole {selectedHole}</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 13 }}>Step 2 of 2 — tap the PIN</div>
                <div style={{ fontSize: 11, marginTop: 2, opacity: 0.85, fontWeight: 500 }}>Hole {selectedHole}</div>
              </>
            )}
            <button
              onClick={cancelContribute}
              disabled={saving}
              style={{ marginTop: 6, background: 'transparent', border: '1px solid #04140a', color: '#04140a', borderRadius: 6, padding: '2px 8px', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit' }}
            >Cancel</button>
          </div>
        )}
      </div>

      {!coords?.lat && (
        <p style={{ marginTop: 10, fontSize: 11, color: C.textMuted, fontStyle: 'italic' }}>
          Course coordinates not yet known — fetch live weather to geocode the course, then the map will load.
        </p>
      )}

      {/* Actionable banner — includes "Mark this hole" CTA when contribute is available */}
      {banner && (
        <div
          style={{
            marginTop: 10, padding: '10px 14px', borderRadius: 8,
            background: banner.tone === 'amber' ? C.amberMuted : C.blueMuted,
            border: `1px solid ${banner.tone === 'amber' ? C.amber : C.blue}`,
            display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap',
          }}
        >
          <p style={{ fontSize: 11, color: banner.tone === 'amber' ? C.amber : C.blue, margin: 0, lineHeight: 1.5, flex: 1, minWidth: 200 }}>
            <strong>{banner.title}.</strong> {banner.body}
          </p>
          {contribute && selectedHole != null && (
            <button
              onClick={startContribute}
              style={{
                background: banner.tone === 'amber' ? C.amber : C.blue,
                color: '#0f1117', border: 'none', borderRadius: 6,
                padding: '6px 12px', fontSize: 11, fontWeight: 700,
                cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
              }}
            >Mark this hole</button>
          )}
        </div>
      )}

      {/* Always offer contribute, even when banner is hidden, if the hole still lacks geometry */}
      {!banner && contribute && selectedHole != null && !hasHoleGeometry && !inContribMode && (
        <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={startContribute} style={{ background: 'transparent', color: C.accent, border: `1px solid ${C.accent}`, borderRadius: 6, padding: '5px 10px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>
            + Mark tee & pin for Hole {selectedHole}
          </button>
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

function navBtnStyle(disabled) {
  return {
    width: 30, height: 30, borderRadius: 6, fontSize: 18, lineHeight: 1, fontFamily: 'inherit',
    cursor: disabled ? 'default' : 'pointer',
    background: C.bgInput, color: disabled ? C.textFaint : C.text,
    border: `1px solid ${C.border}`, opacity: disabled ? 0.4 : 1, padding: 0,
  }
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
