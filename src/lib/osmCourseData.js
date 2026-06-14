// ─── OpenStreetMap course design data via Overpass API ──────────────────────
// Fetches hazard polygons, green polygons, and pin positions from OSM
// and associates them with each hole to produce per-hole design data.

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'
const BBOX_PADDING = 0.025 // ~2.5km padding — covers large multi-course properties like Medinah, Torrey Pines

function buildQuery(lat, lng) {
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

export async function fetchOSMCourseData(lat, lng) {
  if (!lat || !lng) return null

  const query = buildQuery(lat, lng)
  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'data=' + encodeURIComponent(query),
  })

  if (!res.ok) return null
  const data = await res.json()
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
      if (c) bunkers.push(c)
    } else if ((g === 'water_hazard' || g === 'lateral_water_hazard') && e.type === 'way') {
      const nodes = resolveNodes(e, nodeMap)
      const c = centroid(nodes)
      if (c) waterHazards.push(c)
    } else if (g === 'green' && e.type === 'way') {
      const nodes = resolveNodes(e, nodeMap)
      const c = centroid(nodes)
      if (c) greens.push({ ...c, nodes })
    } else if (g === 'tee' && e.type === 'way') {
      const nodes = resolveNodes(e, nodeMap)
      const c = centroid(nodes)
      if (c) tees.push(c)
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

  return { pins, bunkers, waterHazards, greens, tees, holes, raw: elements }
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
