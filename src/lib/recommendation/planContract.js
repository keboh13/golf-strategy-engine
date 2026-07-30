// Output contract validator for generated game plans.
//
// Before this lived in code, the plan parser regex (App.jsx ~line 1014)
// silently truncated plans that didn't include all 18 holes. This module
// asserts the plan meets the structural contract the UI expects, and returns
// machine-readable issues + a human banner string.

const REQUIRED_SECTIONS = ['Round strategy', 'Scoring roadmap', 'Hole-by-hole']

const HOLE_HEADING = /^###?\s*Hole\s+(\d+)/gim
const HOLE_FIELDS = ['Tee', 'Approach', 'Caddy']
const GREEN_JSON_BLOCK = /```green-json\s*\n([\s\S]*?)\n```/gi

export function validatePlanContract(text, options = {}) {
  const issues = []
  if (typeof text !== 'string' || !text.trim()) {
    return { ok: false, issues: ['empty_plan'], banner: 'Plan generation returned no text.' }
  }

  // Required top-level sections
  for (const heading of REQUIRED_SECTIONS) {
    if (!new RegExp(`^##\\s+${heading}`, 'im').test(text)) {
      issues.push(`missing_section:${heading}`)
    }
  }

  // 18 hole headings, indexed 1..18
  const found = new Set()
  let m
  HOLE_HEADING.lastIndex = 0
  while ((m = HOLE_HEADING.exec(text)) !== null) {
    found.add(parseInt(m[1]))
  }
  const missing = []
  for (let i = 1; i <= 18; i++) if (!found.has(i)) missing.push(i)
  if (missing.length) issues.push(`missing_holes:${missing.join(',')}`)

  // Per-hole fields — coarse check that each Hole section has the three labels
  const sections = text.split(/^###?\s*Hole\s+\d+/im).slice(1)
  let missingFieldCount = 0
  for (const sec of sections) {
    for (const f of HOLE_FIELDS) {
      if (!new RegExp(`\\*\\*${f}[^*]*\\*\\*|${f}:`, 'i').test(sec)) {
        missingFieldCount++
        break
      }
    }
  }
  if (missingFieldCount) issues.push(`incomplete_hole_sections:${missingFieldCount}`)

  // green-json blocks — count and parseability
  let greenBlocks = 0, greenBad = 0
  GREEN_JSON_BLOCK.lastIndex = 0
  while ((m = GREEN_JSON_BLOCK.exec(text)) !== null) {
    greenBlocks++
    try { JSON.parse(m[1]) } catch { greenBad++ }
  }
  if (greenBlocks < 18) issues.push(`green_json_count:${greenBlocks}`)
  if (greenBad) issues.push(`green_json_malformed:${greenBad}`)

  const ok = issues.length === 0

  // Issue #207: content quality validation
  const contentWarnings = validateContentQuality(text, options)

  return {
    ok,
    issues,
    contentWarnings,
    banner: ok ? null : buildBanner(issues),
    counts: { holesPresent: found.size, sectionsMissing: REQUIRED_SECTIONS.filter(h => issues.includes(`missing_section:${h}`)).length, greenBlocks, greenBad },
  }
}

// ── Issue #207: Content quality heuristics ────────────────────────────────
const TEE_CLUB_PATTERN = /\*\*Tee\*\*:\s*(\S+)/gi

/**
 * Validate content quality of a generated plan. Returns warnings (not hard
 * failures) as an array of strings.
 *
 * @param {string} text - the plan text
 * @param {object} options
 * @param {Array}  [options.playerClubs] - clubs in the player's bag [{club}]
 * @param {boolean} [options.hasWindData] - whether wind data was provided
 */
export function validateContentQuality(text, options = {}) {
  const warnings = []
  if (typeof text !== 'string' || !text.trim()) return warnings

  const { playerClubs, hasWindData } = options

  // 1. Club variety: check clubs mentioned come from player's bag
  if (Array.isArray(playerClubs) && playerClubs.length > 0) {
    const bagNames = new Set(playerClubs.map(c => (c.club || '').toLowerCase()))

    // Extract tee clubs from the plan
    const teeClubs = []
    TEE_CLUB_PATTERN.lastIndex = 0
    let match
    while ((match = TEE_CLUB_PATTERN.exec(text)) !== null) {
      teeClubs.push(match[1].replace(/,$/,''))
    }

    // Flag unknown clubs
    const unknownClubs = new Set()
    for (const tc of teeClubs) {
      const normalized = tc.toLowerCase()
      // Check if any bag club name contains or matches the plan's club reference
      const found = [...bagNames].some(b =>
        b === normalized || b.includes(normalized) || normalized.includes(b)
      )
      if (!found) unknownClubs.add(tc)
    }
    if (unknownClubs.size > 0) {
      warnings.push(`unknown_clubs: ${[...unknownClubs].join(', ')} not found in player bag`)
    }

    // Flag if same club on >80% of tee shots
    if (teeClubs.length >= 10) {
      const counts = {}
      for (const c of teeClubs) {
        const key = c.toLowerCase()
        counts[key] = (counts[key] || 0) + 1
      }
      for (const [club, count] of Object.entries(counts)) {
        if (count / teeClubs.length > 0.8) {
          warnings.push(`low_club_variety: ${club} used on ${Math.round(count / teeClubs.length * 100)}% of tee shots`)
        }
      }
    }
  }

  // 2. Wind references: when wind data provided, plan should mention wind
  if (hasWindData) {
    const windMentions = (text.match(/wind|headwind|tailwind|crosswind|into.*wind|downwind/gi) || []).length
    if (windMentions === 0) {
      warnings.push('wind_ignored: wind data was provided but plan never mentions wind')
    }
  }

  // 3. Repetition detection: flag if identical recommendation text appears on multiple holes
  const holeSections = text.split(/^###?\s*Hole\s+\d+/im).slice(1)
  if (holeSections.length >= 2) {
    // Extract tee recommendation lines
    const teeLines = holeSections.map(sec => {
      const m = sec.match(/\*\*Tee\*\*:\s*(.+)/i)
      return m ? m[1].trim() : null
    }).filter(Boolean)

    const lineCounts = {}
    for (const line of teeLines) {
      lineCounts[line] = (lineCounts[line] || 0) + 1
    }
    for (const [line, count] of Object.entries(lineCounts)) {
      if (count >= 3) {
        warnings.push(`repetition: identical tee recommendation "${line.slice(0, 60)}..." appears on ${count} holes`)
      }
    }
  }

  return warnings
}

function buildBanner(issues) {
  const reasons = []
  for (const i of issues) {
    if (i.startsWith('missing_holes:')) {
      const list = i.slice('missing_holes:'.length)
      reasons.push(`missing holes ${list}`)
    } else if (i.startsWith('missing_section:')) {
      reasons.push(`missing section "${i.slice('missing_section:'.length)}"`)
    } else if (i.startsWith('incomplete_hole_sections:')) {
      reasons.push(`${i.slice('incomplete_hole_sections:'.length)} hole(s) missing required fields`)
    } else if (i.startsWith('green_json_count:')) {
      const n = i.slice('green_json_count:'.length)
      reasons.push(`only ${n} green-json blocks (expected 18)`)
    } else if (i.startsWith('green_json_malformed:')) {
      reasons.push(`${i.slice('green_json_malformed:'.length)} malformed green-json block(s)`)
    } else {
      reasons.push(i)
    }
  }
  return `Plan validation failed: ${reasons.join('; ')}. Regenerate recommended.`
}
