// ─── OpenStreetMap course design data via Overpass API ──────────────────────
// Fetches hazard polygons, green polygons, and pin positions from OSM
// and associates them with each hole to produce per-hole design data.

const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]
const BBOX_PADDING = 0.025 // ~2.5km — fallback only when no leisure=golf_course area is found

// Preferred: clip to the leisure=golf_course area within 400m of the coords.
// This avoids bleeding into neighbouring courses on multi-course properties
// (Medinah, Torrey Pines). Falls back to a bbox query if no area is found.
function buildAreaQuery(lat, lng) {
  return `[out:json][timeout:30];area[leisure=golf_course](around:400,${lat},${lng})->.c;(nwr(area.c)[golf];);out body;>;out skel qt;`
}

function buildBboxQuery(lat, lng) {
  const s = lat - BBOX_PADDING
  const n = lat + BBOX_PADDING
  const w = lng - BBOX_PADDING
  const e = lng + BBOX_PADDING
  return `[out:json][timeout:30];(nwr["golf"](${s},${w},${n},${e}););out body;>;out skel qt;`
}

function toRad(deg) { return deg * Math.PI / 180 }
function toDeg(rad) { return rad * 180 / Math.PI }

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function metersToYards(m) { return m * 1.09361 }

function bearing(lat1, lng1, lat2, lng2) {
  const dLng = toRad(lng2 - lng1)
  const y = Math.sin(dLng) * Math.cos(toRad(lat2))
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng)
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

function centroid(nodes) {
  if (!nodes.length) return null
  const sum = nodes.reduce((a, n) => ({ lat: a.lat + n.lat, lng: a.lng + n.lng }), { lat: 0, lng: 0 })
  return { lat: sum.lat / nodes.length, lng: sum.lng / nodes.length }
}

// Given a hazard centroid and a green centroid, classify relative position
function classifyPosition(hazardLat, hazardLng, greenLat, greenLng, approachBearing) {
  const hazBearing = bearing(greenLat, greenLng, hazardLat, hazardLng)
  // Relative angle: 0 = behind green (back), 180 = in front (approach side)
  let rel = (hazBearing - approachBearing + 360) % 360

  // Distance from green center
  const dist = haversineMeters(greenLat, greenLng, hazardLat, hazardLng)
  if (metersToYards(dist) > 60) return null // too far from green to be relevant

  if (rel >= 315 || rel < 45) return 'back'
  if (rel >= 45 && rel < 135) return 'right'
  if (rel >= 135 && rel < 225) return 'front'
  return 'left'
}

function resolveNodes(wayOrRelation, nodeMap) {
  if (wayOrRelation.type === 'way' && wayOrRelation.nodes) {
    return wayOrRelation.nodes.map(id => nodeMap[id]).filter(Boolean)
  }
  return []
}

async function overpassFetch(query, { signal } = {}) {
  // Race all endpoints; return first successful response.
  // Each attempt gets a 30s AbortController timeout. If the caller also
  // passes a signal (e.g. the enrichment abort), we link both so either
  // cancellation tears down the fetch.
  const attempt = (url) => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 30_000)
    // Forward parent signal
    if (signal) {
      if (signal.aborted) { clearTimeout(timer); ctrl.abort(); }
      else signal.addEventListener('abort', () => { clearTimeout(timer); ctrl.abort() }, { once: true })
    }
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(query),
      signal: ctrl.signal,
    }).then(res => {
      clearTimeout(timer)
      if (!res.ok) throw new Error(`Overpass ${url} HTTP ${res.status}`)
      return res.json()
    }, err => {
      clearTimeout(timer)
      throw err
    })
  }

  return Promise.any(OVERPASS_URLS.map(attempt))
    .catch(() => { throw new Error('Overpass: all endpoints failed') })
}

export async function fetchOSMCourseData(lat, lng, { signal } = {}) {
  if (!lat || !lng) return null

  // Fire area and bbox queries in parallel. The area query is preferred when it
  // returns golf-tagged elements (avoids bleeding into adjacent courses). If it
  // comes back empty we fall back to the bbox result which runs concurrently.
  const [areaResult, bboxResult] = await Promise.allSettled([
    overpassFetch(buildAreaQuery(lat, lng), { signal }),
    overpassFetch(buildBboxQuery(lat, lng), { signal }),
  ])

  let data = null
  const areaData = areaResult.status === 'fulfilled' ? areaResult.value : null
  if (areaData?.elements?.some(e => e.tags?.golf)) {
    data = areaData
  } else if (bboxResult.status === 'fulfilled') {
    data = bboxResult.value
  }

  if (!data) return null
  const elements = data.elements || []

  // Build node lookup
  const nodeMap = {}
  for (const e of elements) {
    if (e.type === 'node' && e.lat != null) {
      nodeMap[e.id] = { lat: e.lat, lng: e.lon }
    }
  }

  // Extract features
  const pins = []
  const bunkers = []
  const waterHazards = []
  const fairways = []
  const greens = []
  const tees = []
  const holes = []

  for (const e of elements) {
    const g = e.tags?.golf
    if (!g) continue

    if (g === 'pin' && e.type === 'node') {
      pins.push({ lat: e.lat, lng: e.lon, ref: e.tags?.ref })
    } else if (g === 'bunker' && e.type === 'way') {
      const nodes = resolveNodes(e, nodeMap)
      const c = centroid(nodes)
      if (c) bunkers.push({ ...c, nodes })
    } else if ((g === 'water_hazard' || g === 'lateral_water_hazard') && e.type === 'way') {
      const nodes = resolveNodes(e, nodeMap)
      const c = centroid(nodes)
      if (c) waterHazards.push({ ...c, nodes })
    } else if (g === 'fairway' && e.type === 'way') {
      const nodes = resolveNodes(e, nodeMap)
      const c = centroid(nodes)
      if (c) fairways.push({ ...c, nodes })
    } else if (g === 'green' && e.type === 'way') {
      const nodes = resolveNodes(e, nodeMap)
      const c = centroid(nodes)
      if (c) greens.push({ ...c, nodes })
    } else if (g === 'tee' && e.type === 'way') {
      const nodes = resolveNodes(e, nodeMap)
      const c = centroid(nodes)
      if (c) tees.push({ ...c, nodes })
    } else if (g === 'hole' && e.type === 'way') {
      const nodes = resolveNodes(e, nodeMap)
      if (nodes.length >= 2) {
        holes.push({
          ref: parseInt(e.tags?.ref) || 0,
          par: parseInt(e.tags?.par) || 0,
          nodes,
        })
      }
    }
  }

  return { pins, bunkers, waterHazards, fairways, greens, tees, holes, raw: elements }
}

// Estimate green dimensions from polygon nodes
function greenDimensions(nodes) {
  if (!nodes || nodes.length < 3) return null
  let maxDist = 0
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const d = haversineMeters(nodes[i].lat, nodes[i].lng, nodes[j].lat, nodes[j].lng)
      if (d > maxDist) maxDist = d
    }
  }
  const area = polygonAreaSqMeters(nodes)
  const width = metersToYards(maxDist)
  const depth = area > 0 ? metersToYards(area / (maxDist || 1)) : 0
  return { width: Math.round(width), depth: Math.round(depth) }
}

function polygonAreaSqMeters(nodes) {
  if (nodes.length < 3) return 0
  let area = 0
  for (let i = 0; i < nodes.length; i++) {
    const j = (i + 1) % nodes.length
    area += toRad(nodes[j].lng - nodes[i].lng) * (2 + Math.sin(toRad(nodes[i].lat)) + Math.sin(toRad(nodes[j].lat)))
  }
  return Math.abs(area * 6371000 * 6371000 / 2)
}

// Match OSM features to the app's 18-hole structure using pin positions
// Pins are matched to holes by sorting both by a consistent spatial criterion
export function enrichHolesWithOSM(courseHoles, osmData) {
  if (!osmData || !courseHoles?.length) return { holes: courseHoles, hasDesignData: false }

  const { pins, bunkers, waterHazards, greens, tees, holes: osmHoles } = osmData

  // Strategy: match pins to holes
  // If we have golf=hole ways with ref tags, use those directly
  // Otherwise, use pin positions and try to match by proximity to greens

  // First, try to match using golf=hole ways if available
  if (osmHoles.length >= courseHoles.length * 0.8) {
    return enrichFromHoleWays(courseHoles, osmHoles, bunkers, waterHazards, greens)
  }

  // Fallback: match pins to greens, then associate hazards
  if (pins.length < 3) return { holes: courseHoles, hasDesignData: false }

  // Find the closest green polygon to each pin
  const pinGreens = pins.map(pin => {
    let bestGreen = null, bestDist = Infinity
    for (const g of greens) {
      const d = haversineMeters(pin.lat, pin.lng, g.lat, g.lng)
      if (d < bestDist) { bestDist = d; bestGreen = g }
    }
    return { pin, green: bestDist < 50 ? bestGreen : null }
  })

  // Sort pins spatially and match to holes by order
  // This is imperfect but works for many courses where pins are in order
  // Try ref tags first
  const refPins = pins.filter(p => p.ref && parseInt(p.ref) >= 1 && parseInt(p.ref) <= 18)
  const orderedPins = refPins.length >= courseHoles.length
    ? refPins.sort((a, b) => parseInt(a.ref) - parseInt(b.ref))
    : null

  if (!orderedPins && pins.length < courseHoles.length) {
    return { holes: courseHoles, hasDesignData: false }
  }

  const matchedPins = orderedPins || matchPinsToHoleOrder(pins, tees, courseHoles.length)
  if (!matchedPins) return { holes: courseHoles, hasDesignData: false }

  const enrichedHoles = courseHoles.map((hole, i) => {
    if (i >= matchedPins.length) return hole

    const pin = matchedPins[i]
    const greenData = pinGreens.find(pg => pg.pin === pin)

    // Find nearest tee to estimate approach bearing
    let approachBearing = 0
    let bestTeeDist = Infinity
    for (const tee of tees) {
      const d = haversineMeters(tee.lat, tee.lng, pin.lat, pin.lng)
      if (d < bestTeeDist && d > 30) { // must be at least 30m away (not the same green's tee)
        bestTeeDist = d
        approachBearing = bearing(tee.lat, tee.lng, pin.lat, pin.lng)
      }
    }

    // Find hazards near this green
    const holeHazards = []
    for (const b of bunkers) {
      const loc = classifyPosition(b.lat, b.lng, pin.lat, pin.lng, approachBearing)
      if (loc) holeHazards.push({ type: 'bunker', loc })
    }
    for (const w of waterHazards) {
      const loc = classifyPosition(w.lat, w.lng, pin.lat, pin.lng, approachBearing)
      if (loc) holeHazards.push({ type: 'water', loc })
    }

    // Green dimensions
    const dims = greenData?.green ? greenDimensions(greenData.green.nodes) : null

    // Build design notes from verified OSM data
    const osmNotes = holeHazards.map(h => `${h.type} ${h.loc}`).join(', ')

    // Merge with existing notes (user notes take precedence)
    const existingNotes = hole.notes || ''
    const mergedNotes = existingNotes
      ? existingNotes
      : osmNotes || ''

    return {
      ...hole,
      notes: mergedNotes,
      osmDesign: {
        hazards: holeHazards,
        greenWidth: dims?.width || null,
        greenDepth: dims?.depth || null,
        pinLat: pin.lat,
        pinLng: pin.lng,
        approachBearing: Math.round(approachBearing),
        source: 'OpenStreetMap',
      },
    }
  })

  const hasData = enrichedHoles.some(h => h.osmDesign?.hazards?.length > 0 || h.osmDesign?.greenWidth)
  return { holes: enrichedHoles, hasDesignData: hasData }
}

function enrichFromHoleWays(courseHoles, osmHoles, bunkers, waterHazards, greens) {
  const byRef = {}
  for (const h of osmHoles) {
    if (h.ref >= 1 && h.ref <= 18) byRef[h.ref] = h
  }

  const enrichedHoles = courseHoles.map((hole, i) => {
    const osmHole = byRef[i + 1]
    if (!osmHole || osmHole.nodes.length < 2) return hole

    const greenNode = osmHole.nodes[osmHole.nodes.length - 1]
    const teeNode = osmHole.nodes[0]
    const approachBearing = bearing(teeNode.lat, teeNode.lng, greenNode.lat, greenNode.lng)

    // Dogleg detection from intermediate nodes
    let dogleg = null
    if (osmHole.nodes.length >= 3) {
      const mid = osmHole.nodes[Math.floor(osmHole.nodes.length / 2)]
      const bearToMid = bearing(teeNode.lat, teeNode.lng, mid.lat, mid.lng)
      const bearMidToGreen = bearing(mid.lat, mid.lng, greenNode.lat, greenNode.lng)
      const turn = ((bearMidToGreen - bearToMid + 540) % 360) - 180
      if (Math.abs(turn) > 15) dogleg = turn > 0 ? 'right' : 'left'
    }

    // Hazards near green
    const holeHazards = []
    for (const b of bunkers) {
      const loc = classifyPosition(b.lat, b.lng, greenNode.lat, greenNode.lng, approachBearing)
      if (loc) holeHazards.push({ type: 'bunker', loc })
    }
    for (const w of waterHazards) {
      const loc = classifyPosition(w.lat, w.lng, greenNode.lat, greenNode.lng, approachBearing)
      if (loc) holeHazards.push({ type: 'water', loc })
    }

    // Green dimensions
    let dims = null
    let bestGreenDist = Infinity
    for (const g of greens) {
      const d = haversineMeters(greenNode.lat, greenNode.lng, g.lat, g.lng)
      if (d < bestGreenDist) { bestGreenDist = d; dims = greenDimensions(g.nodes) }
    }
    if (bestGreenDist > 50) dims = null

    const osmNotes = [
      ...(dogleg ? [`dogleg ${dogleg}`] : []),
      ...holeHazards.map(h => `${h.type} ${h.loc}`),
    ].join(', ')

    const existingNotes = hole.notes || ''

    return {
      ...hole,
      notes: existingNotes || osmNotes || '',
      osmDesign: {
        hazards: holeHazards,
        dogleg,
        greenWidth: dims?.width || null,
        greenDepth: dims?.depth || null,
        bearingDeg: Math.round(approachBearing),
        source: 'OpenStreetMap',
      },
    }
  })

  const hasData = enrichedHoles.some(h => h.osmDesign?.hazards?.length > 0 || h.osmDesign?.dogleg)
  return { holes: enrichedHoles, hasDesignData: hasData }
}

// Attempt to order pins to match hole routing
// Uses nearest-neighbor traversal starting from a heuristic first tee
function matchPinsToHoleOrder(pins, tees, numHoles) {
  if (pins.length < numHoles) return null

  // Cluster pins — if there are more than numHoles, pick the ones most likely to be this course
  // For now, just take the first numHoles pins by nearest-neighbor chain
  const used = new Set()
  const ordered = []

  // Start from pin nearest to any tee (likely hole 1)
  let startPin = pins[0]
  let bestStartDist = Infinity
  for (const pin of pins) {
    for (const tee of tees) {
      const d = haversineMeters(pin.lat, pin.lng, tee.lat, tee.lng)
      if (d < bestStartDist && d > 30) {
        bestStartDist = d
        startPin = pin
      }
    }
  }

  // If we can't find a good start, just pick the northernmost pin
  if (bestStartDist === Infinity) {
    startPin = pins.reduce((best, p) => p.lat > best.lat ? p : best, pins[0])
  }

  ordered.push(startPin)
  used.add(pins.indexOf(startPin))

  // Nearest-neighbor chain
  for (let step = 1; step < numHoles && step < pins.length; step++) {
    const last = ordered[ordered.length - 1]
    let bestDist = Infinity, bestIdx = -1
    for (let j = 0; j < pins.length; j++) {
      if (used.has(j)) continue
      const d = haversineMeters(last.lat, last.lng, pins[j].lat, pins[j].lng)
      if (d < bestDist) { bestDist = d; bestIdx = j }
    }
    if (bestIdx < 0) break
    ordered.push(pins[bestIdx])
    used.add(bestIdx)
  }

  return ordered.length >= numHoles ? ordered : null
}

// ─── GeoJSON exporter ────────────────────────────────────────────────────────
// Converts the parsed OSM data into a normalized FeatureCollection plus a
// per-hole bbox map. Polygon rings are closed and emitted as [lng, lat].
// holeRef is assigned by proximity to golf=hole centerlines; features that
// can't be confidently associated keep holeRef: null and are still emitted.

function ringFromNodes(nodes) {
  if (!nodes || nodes.length < 3) return null
  const ring = nodes.map(n => [n.lng, n.lat])
  const first = ring[0], last = ring[ring.length - 1]
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]])
  return ring
}

function lineFromNodes(nodes) {
  if (!nodes || nodes.length < 2) return null
  return nodes.map(n => [n.lng, n.lat])
}

function bboxFromCoords(coords) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
  for (const c of coords) {
    if (c[0] < w) w = c[0]; if (c[0] > e) e = c[0]
    if (c[1] < s) s = c[1]; if (c[1] > n) n = c[1]
  }
  return [w, s, e, n]
}

function unionBbox(a, b) {
  if (!a) return b; if (!b) return a
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]
}

function buildFlatHoleIndex(holeIndex) {
  // Flatten {ref, nodes} into [{ref, lat, lng}] once so callers don't re-walk
  // the nested structure on every feature lookup.
  const flat = []
  for (const { ref, nodes } of holeIndex) {
    for (const n of nodes) flat.push({ ref, lat: n.lat, lng: n.lng })
  }
  return flat
}

function nearestHoleRef(lat, lng, flatIndex) {
  let bestRef = null, bestDist = Infinity
  for (const n of flatIndex) {
    const d = haversineMeters(lat, lng, n.lat, n.lng)
    if (d < bestDist) { bestDist = d; bestRef = n.ref }
  }
  return { ref: bestRef, distM: bestDist }
}

export function exportCourseGeoJSON(osmData /*, courseHoles */) {
  if (!osmData) return { type: 'FeatureCollection', features: [], bboxByHole: {} }

  const { pins = [], bunkers = [], waterHazards = [], fairways = [], greens = [], tees = [], holes = [] } = osmData

  // Build a hole index from golf=hole ways with valid refs (1–18).
  const holeIndex = holes
    .filter(h => h.nodes?.length >= 2 && h.ref >= 1 && h.ref <= 18)
    .map(h => ({ ref: h.ref, par: h.par || 0, nodes: h.nodes }))
  const flatHoleIndex = buildFlatHoleIndex(holeIndex)

  const features = []
  const bboxByHole = {}

  const addBboxForHole = (ref, coords) => {
    if (ref == null) return
    bboxByHole[ref] = unionBbox(bboxByHole[ref], bboxFromCoords(coords))
  }

  // Centerlines from golf=hole ways.
  for (const h of holeIndex) {
    const line = lineFromNodes(h.nodes)
    if (!line) continue
    features.push({
      type: 'Feature',
      properties: { kind: 'centerline', holeRef: h.ref, par: h.par },
      geometry: { type: 'LineString', coordinates: line },
    })
    addBboxForHole(h.ref, line)
  }

  // Polygons (green/fairway/bunker/water/tee). Association rules:
  // - green: nearest hole within 80m
  // - fairway: nearest hole within 150m
  // - bunker: nearest hole within 60m
  // - water:  nearest hole within 120m
  // - tee:    nearest hole within 80m (also closest to its tee-side node)
  const polyKinds = [
    { list: greens,       kind: 'green',   maxM: 80  },
    { list: fairways,     kind: 'fairway', maxM: 150 },
    { list: bunkers,      kind: 'bunker',  maxM: 60  },
    { list: waterHazards, kind: 'water',   maxM: 120 },
    { list: tees,         kind: 'tee',     maxM: 80  },
  ]
  for (const { list, kind, maxM } of polyKinds) {
    for (const item of list) {
      const ring = ringFromNodes(item.nodes)
      if (!ring) continue
      let holeRef = null
      if (holeIndex.length) {
        const { ref, distM } = nearestHoleRef(item.lat, item.lng, flatHoleIndex)
        if (distM <= maxM) holeRef = ref
      }
      features.push({
        type: 'Feature',
        properties: { kind, holeRef },
        geometry: { type: 'Polygon', coordinates: [ring] },
      })
      if (holeRef != null) addBboxForHole(holeRef, ring)
    }
  }

  // Pins as Points; associate to nearest hole within 30m.
  for (const p of pins) {
    let holeRef = null
    if (p.ref && parseInt(p.ref) >= 1 && parseInt(p.ref) <= 18) {
      holeRef = parseInt(p.ref)
    } else if (holeIndex.length) {
      const { ref, distM } = nearestHoleRef(p.lat, p.lng, flatHoleIndex)
      if (distM <= 30) holeRef = ref
    }
    features.push({
      type: 'Feature',
      properties: { kind: 'pin', holeRef },
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
    })
    if (holeRef != null) addBboxForHole(holeRef, [[p.lng, p.lat]])
  }

  return { type: 'FeatureCollection', features, bboxByHole }
}

// ─── Tier classifier ─────────────────────────────────────────────────────────
// Returns 1, 2, or 3 based on geometry coverage. Driven entirely by the
// FeatureCollection so callers don't need to re-walk the raw osmData.
export function classifyTier(geojson, courseHoles) {
  if (!geojson || !Array.isArray(geojson.features)) return 3
  const N = courseHoles?.length || 18

  const holeRefs = (kind) => {
    const refs = new Set()
    for (const f of geojson.features) {
      if (f.properties?.kind === kind && f.properties.holeRef != null) refs.add(f.properties.holeRef)
    }
    return refs
  }
  const greens   = holeRefs('green')
  const holeways = holeRefs('centerline')
  const fairways = holeRefs('fairway')

  if (greens.size >= 0.7 * N && (holeways.size >= 0.7 * N || fairways.size >= 0.5 * N)) return 1
  if (greens.size >= 3 || holeways.size >= 3) return 2
  return 3
}

// ─── Coverage map ────────────────────────────────────────────────────────────
// Per-hole map of which feature kinds were rendered. Used by the UI for the
// coverage badge in Tier 2 and to decide where to drop the GreenView inset.
export function computeCoverage(geojson, courseHoles) {
  const N = courseHoles?.length || 18
  const out = {}
  for (let i = 1; i <= N; i++) out[i] = { green: false, fairway: false, centerline: false, bunker: false, water: false, tee: false, pin: false }
  if (!geojson?.features) return out
  for (const f of geojson.features) {
    const ref = f.properties?.holeRef
    const kind = f.properties?.kind
    if (ref == null || !out[ref] || !kind) continue
    out[ref][kind] = true
  }
  return out
}
