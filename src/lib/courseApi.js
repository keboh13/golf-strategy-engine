export async function geocodeViaClaudeSearch(authToken, courseName, location) {
  const res = await fetch('/api/course-ai', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: JSON.stringify({ action: 'geocode', courseName, location: location || '' }),
  })
  const data = await res.json()
  if (!res.ok || data.error) throw new Error(data.error || 'Geocode failed')
  const r = data.result
  if (r.lat && r.lng) return { lat: parseFloat(r.lat), lng: parseFloat(r.lng) }
  throw new Error('Could not parse coordinates from response')
}

export async function searchOpenGolfAPI(query, { signal } = {}) {
  const res = await fetch(`https://api.opengolfapi.org/v1/courses/search?q=${encodeURIComponent(query)}&limit=5`, { signal })
  if (!res.ok) throw new Error(`OpenGolfAPI search error: ${res.status}`)
  return res.json()
}

export async function fetchOpenGolfAPICourse(id, { signal } = {}) {
  const res = await fetch(`https://api.opengolfapi.org/v1/courses/${id}`, { signal })
  if (!res.ok) throw new Error(`OpenGolfAPI course fetch error: ${res.status}`)
  return res.json()
}

export function normalizeOpenGolfCourse(raw) {
  const tees = raw.tees || raw.tee_sets || []
  const chosen = tees.find(t => /black|championship|tournament/i.test(t.name))
    || tees.find(t => /blue/i.test(t.name))
    || tees[0]

  let holes
  if (chosen?.holes?.length) {
    holes = chosen.holes.map((h, i) => ({
      par:      h.par || 4,
      yardage:  String(h.yardage || h.yards || ''),
      handicap: h.handicap || h.stroke_index || i + 1,
      notes:    '',
    }))
  } else if (raw.scorecard?.length) {
    holes = raw.scorecard
      .slice()
      .sort((a, b) => (a.hole_number || 0) - (b.hole_number || 0))
      .map((h, i) => ({
        par:      h.par || 4,
        yardage:  String(h.yardage || h.yards || ''),
        handicap: h.handicap_index || h.handicap || h.stroke_index || i + 1,
        notes:    '',
      }))
  } else {
    throw new Error('No hole data found in OpenGolfAPI response — try entering yardages manually')
  }

  while (holes.length < 18) holes.push({ par: 4, yardage: '', handicap: holes.length + 1, notes: '' })

  const totalYardage = chosen?.total_yardage
    || holes.reduce((s, h) => s + (parseInt(h.yardage) || 0), 0)
    || raw.total_yardage
    || ''

  return {
    name:     raw.name || raw.course_name || raw.club_name,
    location: [raw.city, raw.state].filter(Boolean).join(', '),
    yardage:  String(totalYardage),
    rating:   String(raw.course_rating || chosen?.course_rating || ''),
    slope:    String(raw.slope_rating  || chosen?.slope_rating  || ''),
    par:      raw.par || chosen?.par_total || holes.reduce((s, h) => s + h.par, 0),
    source:   'OpenGolfAPI',
    holes,
  }
}

export async function searchGolfCourseAPI(query, authToken, { signal } = {}) {
  const res = await fetch('/api/course-search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: JSON.stringify({ query }),
    signal,
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || `GolfCourseAPI search error: ${res.status}`)
  }
  const data = await res.json()
  return data.courses || []
}

export function normalizeGolfCourseAPICourse(raw, selectedTee) {
  const maleTees   = raw.tees?.male   || []
  const femaleTees = raw.tees?.female || []
  const allTees    = [...maleTees, ...femaleTees]

  const chosen = selectedTee
    || allTees.find(t => /black|championship|tournament/i.test(t.tee_name))
    || allTees.find(t => /blue/i.test(t.tee_name))
    || allTees.reduce((best, t) => (!best || t.total_yards > best.total_yards) ? t : best, null)

  if (!chosen) throw new Error('No tee data in response')

  const holes = (chosen.holes || []).map((h, i) => ({
    par:      h.par      || 4,
    yardage:  String(h.yardage || ''),
    handicap: h.handicap || i + 1,
    notes:    '',
  }))

  while (holes.length < 18) holes.push({ par: 4, yardage: '', handicap: holes.length + 1, notes: '' })

  const loc = raw.location || {}
  return {
    name:     raw.course_name || raw.club_name,
    location: [loc.city, loc.state].filter(Boolean).join(', '),
    yardage:  String(chosen.total_yards || ''),
    rating:   String(chosen.course_rating || ''),
    slope:    String(chosen.slope_rating  || ''),
    par:      chosen.par_total || holes.reduce((s, h) => s + h.par, 0),
    lat:      loc.latitude,
    lng:      loc.longitude,
    selectedTee: chosen.tee_name || '',
    tees:     allTees.map(t => ({ name: t.tee_name, yardage: t.total_yards || '', rating: t.course_rating || '', slope: t.slope_rating || '', par: t.par_total || '', holes: (t.holes || []).map((h, i) => ({ par: h.par || 4, yardage: String(h.yardage || ''), handicap: h.handicap || i + 1 })) })),
    source:   'GolfCourseAPI',
    holes,
  }
}

export async function fetchScorecardViaClaudeSearch(authToken, courseName, location, { signal } = {}) {
  const res = await fetch('/api/course-ai', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: JSON.stringify({ action: 'scorecard-search', courseName, location: location || '' }),
    signal,
  })
  const data = await res.json()
  if (!res.ok || data.error) throw new Error(data.error || 'Scorecard search failed')
  return { ...data.result, source: data.result.source || 'web search' }
}

export async function fetchYardageBookViaClaudeSearch(authToken, courseName, location, { signal } = {}) {
  const res = await fetch('/api/course-ai', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: JSON.stringify({ action: 'yardage-book', courseName, location: location || '' }),
    signal,
  })
  const data = await res.json()
  if (!res.ok || data.error) throw new Error(data.error || 'Yardage-book search failed')
  const r = data.result
  const hazardsByHole = r.hazardsByHole || []
  return {
    name: r.name || courseName,
    location: r.location || location || '',
    yardage: String(r.yardage || ''),
    rating: String(r.rating || ''),
    slope: String(r.slope || ''),
    par: r.par || (r.holes || []).reduce((s, h) => s + (h.par || 0), 0),
    selectedTee: r.selectedTee || '',
    source: r.source || r._sourcePdf || 'yardage book',
    holes: (r.holes || []).map((h, i) => ({
      par: h.par || 4,
      yardage: String(h.yardage || ''),
      handicap: h.handicap || i + 1,
      notes: '',
      hzDesign: hazardsByHole.find(z => z?.hole === i + 1) || null,
    })),
    hazardsByHole,
    _source: 'yardage_book',
    _sourcePdf: r._sourcePdf || null,
    _sourceHtml: r._sourceHtml || null,
    _discoveryTitle: r._discoveryTitle || null,
    _confidence: r._confidence || 'low',
    _validationIssues: r._validationIssues || [],
  }
}

// Admin-only: upload a PDF scorecard for an existing cached course, then trigger
// server-side parse + persist. The server enforces the admin check (HTTP 403 if
// the user isn't in the admins table). The new scorecard + hazards are written
// to the shared course_cache and course_hole_hazards tables, so every user sees
// the enriched data on the next lookup.
export async function adminUploadScorecardPdf(authToken, { courseName, location, pdfUrl, onProgress }) {
  if (!pdfUrl) throw new Error('Missing pdfUrl')
  onProgress?.('Parsing PDF with Claude…')
  const courseKey = `${(courseName || '').toLowerCase().trim()}|${(location || '').toLowerCase().trim()}`
  const res = await fetch('/api/course-ai', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: JSON.stringify({
      action: 'parse-yardage-book-pdf',
      courseName,
      location: location || '',
      pdf_url: pdfUrl,
      course_key: courseKey,
      persist: true,
    }),
  })
  const raw = await res.text()
  let data
  try { data = JSON.parse(raw) } catch {
    const snippet = raw.slice(0, 200).replace(/\s+/g, ' ').trim()
    throw new Error(res.status === 504 || /timeout/i.test(snippet)
      ? `PDF parse timed out (HTTP ${res.status}). Try a smaller PDF or retry.`
      : `PDF parse failed (HTTP ${res.status}): ${snippet || 'no response body'}`)
  }
  if (!res.ok || data.error) throw new Error(data.error || `PDF parse failed (HTTP ${res.status})`)
  return data.result
}

// Admin-only: patch course metadata in place. Bumps edit_version so clients
// lazily refresh their localStorage entries. Server rejects name/location
// changes — use adminRenameCourse for those.
export async function adminUpdateMetadata(authToken, { course_key, patch, hazardsByHole }) {
  if (!course_key) throw new Error('Missing course_key')
  const res = await fetch('/api/admin-course', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: JSON.stringify({ action: 'update-metadata', course_key, patch, hazardsByHole }),
  })
  const data = await res.json()
  if (!res.ok || data.error) throw new Error(data.error || `update failed (HTTP ${res.status})`)
  return data
}

// Admin-only: atomically rename a course. Migrates cache_key across
// course_cache, course_hole_hazards, course_geo, course_hole_contrib +
// inserts a course_aliases row so old-name searches still resolve.
export async function adminRenameCourse(authToken, { old_key, new_name, new_location, new_course_data }) {
  if (!old_key || !new_name) throw new Error('Missing old_key or new_name')
  const res = await fetch('/api/admin-course', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: JSON.stringify({ action: 'rename', old_key, new_name, new_location, new_course_data }),
  })
  const data = await res.json()
  if (!res.ok || data.error) throw new Error(data.error || `rename failed (HTTP ${res.status})`)
  return data
}

// Admin-only: purge a course from the shared cache. Server uses the service
// role to also clear course_geo / course_hole_hazards / course_hole_contrib
// (which have no RLS delete policy for authenticated users) plus any PDFs in
// storage. Caller is expected to invalidate its own localStorage cache too.
export async function adminDeleteCourse(authToken, { course_key }) {
  if (!course_key) throw new Error('Missing course_key')
  const res = await fetch('/api/admin-course', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: JSON.stringify({ action: 'delete-course', course_key }),
  })
  const data = await res.json()
  if (!res.ok || data.error) throw new Error(data.error || `delete failed (HTTP ${res.status})`)
  return data
}

// Admin-only: re-run Claude vision parse against the course's stored PDF.
// Returns { parsed, diff, pdfUrl } — admin reviews diff, accepts selected
// fields via adminUpdateMetadata.
export async function adminReparsePdf(authToken, { course_key }) {
  if (!course_key) throw new Error('Missing course_key')
  const res = await fetch('/api/admin-course', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: JSON.stringify({ action: 'reparse-pdf', course_key }),
  })
  const data = await res.json()
  if (!res.ok || data.error) throw new Error(data.error || `re-parse failed (HTTP ${res.status})`)
  return data
}

export async function extractHazardsForHole(authToken, { course_key, hole, image_url, image_base64, image_media_type, persist }) {
  const res = await fetch('/api/course-ai', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: JSON.stringify({ action: 'hazard-extract', course_key, hole, image_url, image_base64, image_media_type, persist: persist !== false }),
  })
  const data = await res.json()
  if (!res.ok || data.error) throw new Error(data.error || 'Hazard extraction failed')
  return data.result
}

export async function fetchHoleDesignViaSearch(authToken, courseName, location) {
  const res = await fetch('/api/course-ai', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: JSON.stringify({ action: 'hole-design-search', courseName, location: location || '' }),
  })
  const data = await res.json()
  if (!res.ok || data.error) throw new Error(data.error || 'Hole design search failed')
  return data.result
}

// Normalize a web-search hole design entry into the structured hazard format
// used by PDF parsing. Handles both the old loose-string schema (water, bunkers,
// ob as strings) and the new structured schema (hazards array). This lets the
// dispersion calculator and prompt builder consume either source interchangeably.
export function normalizeWebDesignHazards(design) {
  if (!design) return design
  // Already has structured hazards array — pass through
  if (Array.isArray(design.hazards) && design.hazards.length) return design

  const hazards = []
  if (design.water) {
    hazards.push({
      type: 'water',
      side: /left/i.test(design.water) ? 'L' : /right/i.test(design.water) ? 'R' : /front/i.test(design.water) ? 'front' : /back/i.test(design.water) ? 'back' : 'C',
      category: /green/i.test(design.water) ? 'greenside' : 'fairway',
      carry_yards: null,
      position_description: design.water,
      notes: design.water,
    })
  }
  if (design.bunkers) {
    hazards.push({
      type: 'bunker',
      side: /left/i.test(design.bunkers) ? 'L' : /right/i.test(design.bunkers) ? 'R' : /front/i.test(design.bunkers) ? 'front' : /back/i.test(design.bunkers) ? 'back' : 'C',
      category: /green/i.test(design.bunkers) ? 'greenside' : 'fairway',
      carry_yards: null,
      position_description: design.bunkers,
      notes: design.bunkers,
    })
  }
  if (design.ob) {
    hazards.push({
      type: 'OB',
      side: design.ob === 'both' ? 'C' : /left/i.test(design.ob) ? 'L' : /right/i.test(design.ob) ? 'R' : 'C',
      category: 'fairway',
      carry_yards: null,
      position_description: `OB ${design.ob}`,
      notes: `OB ${design.ob}`,
    })
  }
  return { ...design, hazards }
}

export function mergeDesignDataIntoHoles(courseHoles, designData) {
  if (!designData?.holes?.length) return courseHoles
  return courseHoles.map((hole, i) => {
    const rawDesign = designData.holes.find(d => d.hole === i + 1)
    if (!rawDesign) return hole
    const design = normalizeWebDesignHazards(rawDesign)

    const parts = []
    if (design.dogleg && design.dogleg !== 'straight') parts.push(`dogleg ${design.dogleg}`)
    // Use structured hazards for the text summary
    if (Array.isArray(design.hazards) && design.hazards.length) {
      for (const hz of design.hazards) {
        const desc = hz.position_description || hz.notes || `${hz.type} ${hz.side}`
        parts.push(`${hz.type}: ${desc}`)
      }
    }
    if (design.green_notes) parts.push(`green: ${design.green_notes}`)

    if (!parts.length) return hole

    const webNotes = parts.join(', ')
    const existingNotes = hole.notes || ''
    const mergedNotes = existingNotes || webNotes

    return {
      ...hole,
      notes: mergedNotes,
      webDesign: {
        ...design,
        source: designData.source || 'web search',
      },
    }
  })
}
