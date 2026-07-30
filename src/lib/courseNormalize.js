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
