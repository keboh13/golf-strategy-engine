// Prompt builders for course-related Claude API calls.
// Extracted from course-ai.js — buildScorecardTeesMessages and
// buildHazardDesignMessages live in pdfParseMessages.js instead.

export function buildGeocodeMessages(courseName, location) {
  return [{
    role: 'user',
    content: `What are the GPS coordinates of ${courseName} golf course${location ? ' in ' + location : ''}? Return ONLY JSON: {"lat": 36.043, "lng": -115.289}`,
  }]
}

export function buildScorecardMessages(courseName, location) {
  return [{
    role: 'user',
    content: `Search greenskeeper.org and the course website for the verified scorecard of "${courseName}"${location ? ` in ${location}` : ''}.

Find REAL hole-by-hole yardages, pars, and handicap indexes. Do NOT guess.

Return ONLY this JSON (no markdown):
{
  "name": "Full course name",
  "location": "City, State",
  "yardage": <integer>,
  "rating": <float>,
  "slope": <integer>,
  "par": <integer>,
  "source": "greenskeeper.org or course website URL",
  "holes": [{"par":4,"yardage":379,"handicap":7}, ...all 18]
}

If not found: {"error": "No verified scorecard found"}`,
  }]
}

export function buildHoleDesignMessages(courseName, location) {
  return [{
    role: 'user',
    content: `Find hole-by-hole design details for "${courseName}"${location ? ` in ${location}` : ''}.

Efficiency (this is the hot path — users are waiting):
- Run ONE web_search: "${courseName}${location ? ' ' + location : ''} hole by hole guide". If the top 1-2 results have a hole-by-hole breakdown, extract from them and stop. Only issue a second search if the first returned nothing usable.
- Prefer the course's own site, greenskeeper.org, bluegolf.com, and reputable review sites in that order.
- Do NOT open more than 3 pages total.

For EACH hole (1-18), extract ONLY what's actually stated in the search results:
- Dogleg direction (left, right, or straight)
- All hazards (water, bunkers, OB, trees, native areas) as structured objects
- Notable green features (severely sloped, multi-tier, island green, etc.)

For each hazard, create a structured object with:
- "type": "bunker"|"water"|"creek"|"native"|"OB"|"trees"
- "side": "L"|"R"|"C"|"front"|"back"
- "category": "greenside"|"fairway"|"tee" (where in the hole architecture)
- "carry_yards": distance in yards if mentioned, otherwise null
- "position_description": caddie-style positional description from the source text, or null
- "notes": short positional label

CRITICAL: Include ONLY information you actually found. Any hole with no verified detail must be null. Do NOT guess or fabricate — accuracy over completeness.

Return ONLY this JSON (no markdown):
{
  "course": "Full course name",
  "source": "URL where you found the most detail",
  "holes": [
    {"hole":1,"dogleg":"left|right|straight|null","hazards":[{"type":"water","side":"L","category":"fairway","carry_yards":null,"position_description":"water left of fairway","notes":"left side"}],"green_notes":"description or null"},
    ...all 18 holes, use null for any hole you cannot find info about
  ]
}

If nothing usable turned up: {"error": "No hole design data found"}`,
  }]
}

export function buildPdfDiscoveryMessages(courseName, location, exclude = []) {
  const excludeBlock = exclude.length
    ? `\nDO NOT return any of these URLs — they were already tried and failed:\n${exclude.map(u => `- ${u}`).join('\n')}\n`
    : ''
  return [{
    role: 'user',
    content: `Find the most authoritative PDF link for "${courseName}"${location ? ` in ${location}` : ''}.

Use web_search to locate ONE of (in priority order):
1. The course's official yardage book PDF (often hosted on the course's own site or on a CDN like cdn.sanity.io, cloudfront, contentful).
2. The course's official scorecard PDF.
3. A PGA / USGA / state-association tournament packet PDF that covers this course.
4. A reputable third-party scorecard — prefer course.bluegolf.com (very reliable, structured per-tee scorecards), then greenskeeper.org, ncrdb, swingu.

CRITICAL:
- Prefer a DIRECT URL to a .pdf file. Verify the link actually serves a PDF (CDN-hosted PDFs on cdn.sanity.io, *.cloudfront.net, contentful, etc. are usually reliable; older pages on course websites have often been moved or deleted).
- If the only available scorecard is an HTML page (not a PDF), return the HTML URL and set "kind": "html". course.bluegolf.com detailedscorecard.htm pages are excellent HTML sources.
- If nothing usable exists, return {"error": "..."}.
${excludeBlock}
Return ONLY this JSON (no markdown):
{"url": "https://…/course.pdf", "kind": "pdf|html", "title": "short description of the source"}`,
  }]
}

export function buildHazardExtractMessages(holeNumber, imageRef) {
  const imageBlock = imageRef.kind === 'url'
    ? { type: 'image', source: { type: 'url', url: imageRef.value } }
    : { type: 'image', source: { type: 'base64', media_type: imageRef.media_type || 'image/png', data: imageRef.value } }
  return [{
    role: 'user',
    content: [
      imageBlock,
      { type: 'text', text: `This is a yardage-book diagram for hole ${holeNumber}. Extract hazards and design features as structured JSON.

Identify every hazard visible on the diagram. For each hazard set:
- "type": one of "bunker" | "water" | "creek" | "native" | "OB" | "trees"
- "side": "L" | "R" | "C" | "front" | "back" (where C = centerline, in play)
- "category": "greenside" | "fairway" | "tee" — where in the hole architecture the hazard lives
- "carry_yards": carry distance from the back tee if labeled on the diagram, otherwise null
- "distances_by_tee": object mapping tee names to distances (e.g. {"blue": 230}), only when labeled. Omit or {} if not labeled.
- "position_description": caddie-style positional description (e.g. "fairway bunkers on right side ~230 yards from blue tees"). null if not determinable.
- "notes": short label or position note (e.g. "fairway 240-260", "greenside")

Also identify:
- "dogleg": "left" | "right" | "straight"
- "green_notes": tier/slope/shape notes if visible
- "recommended_line": short caddie-style advice if a clear ideal line is implied

Return ONLY this JSON:
{
  "hole": ${holeNumber},
  "dogleg": "left|right|straight",
  "hazards": [{"type":"bunker","side":"R","category":"fairway","carry_yards":235,"distances_by_tee":{"blue":230},"position_description":"fairway bunker right side ~235 yards","notes":"fairway"}],
  "green_notes": "",
  "recommended_line": ""
}` },
    ],
  }]
}
