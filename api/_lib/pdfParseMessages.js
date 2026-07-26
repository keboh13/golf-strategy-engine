export function buildScorecardTeesMessages(pdfUrl, courseName, location) {
  return [{
    role: 'user',
    content: [
      { type: 'document', source: { type: 'url', url: pdfUrl } },
      { type: 'text', text: `This PDF is the official yardage book / scorecard for "${courseName}"${location ? ` in ${location}` : ''}.

Extract EVERY tee option printed on the scorecard as a "tees" array. A scorecard typically lists 3-6 tee sets across men's/women's rows (Black, Blue, White, Gold, Red, Green, Championship, Member, Forward, etc.). For EACH tee capture:
   - "name": the tee label as printed ("Black", "Blue", "White", "Gold", "Championship", "Ladies", etc.)
   - "color": lowercase color word if the tee is color-coded on the scorecard ("black", "blue", "white", "gold", "red", "green", "silver", "copper"), else null
   - "yardage": total yards from this tee (integer)
   - "rating": course rating for this tee (float), or null if not printed
   - "slope": slope rating for this tee (integer), or null if not printed
   - "par": par total for this tee if printed (usually same as course par)
   - "holes": array of 18 entries {par, yardage, handicap} with the per-hole values FROM THIS SPECIFIC TEE — the yardage column that corresponds to this tee row. handicap (stroke index) is shared across tees on most scorecards.
   Also populate the top-level "selectedTee" with the LONGEST tee's name (Championship / Tournament / Black / Tips) — this is the default view.

The top-level scorecard fields (yardage, rating, slope, par, holes[]) MUST mirror the entry in tees[] whose name equals selectedTee — this is what renders when a user hasn't switched tees yet.

CRITICAL: never guess. If a number isn't in the PDF, leave null and lower confidence. Confidence rubric: "high" only when every hole was matched against the document; "medium" when most were; "low" when partial.

Return ONLY this JSON (no markdown):
{
  "name": "Full course name",
  "location": "City, State",
  "yardage": <int total>,
  "rating": <float>,
  "slope": <int>,
  "par": <int total>,
  "selectedTee": "Championship",
  "source": "PDF (uploaded yardage book)",
  "_confidence": "high|medium|low",
  "tees": [
    {"name":"Black","color":"black","yardage":7150,"rating":74.2,"slope":140,"par":72,"holes":[{"par":4,"yardage":410,"handicap":7}, ...all 18]}
  ],
  "holes": [{"par":4,"yardage":379,"handicap":7}, ...all 18]
}

If the PDF doesn't contain a usable scorecard: {"error":"PDF did not contain a parseable scorecard"}` },
    ],
  }]
}

export function buildHazardDesignMessages(pdfUrl, courseName, location) {
  return [{
    role: 'user',
    content: [
      { type: 'document', source: { type: 'url', url: pdfUrl } },
      { type: 'text', text: `This PDF is the official yardage book for "${courseName}"${location ? ` in ${location}` : ''}.

For EACH hole 1-18, extract hazards, design features, written content, and a visual analysis of the hole diagram/illustration.

(1) **Per-hole written content from the PDF text:**
   - "holeName": the caddie/marketing nickname for the hole if one is printed near the hole number (e.g. "Mind the Gap", "All of Texas", "Cascades"). Use null if no nickname exists.
   - "description": the full prose paragraph that describes the hole's strategy / design / approach. Capture it VERBATIM from the PDF — do not paraphrase or shorten. Use null if absent.
   - "greenDepth": the printed green depth in yards (often shown as "DEPTH = 31"). Integer. Use null if absent.

(2) **Visual analysis of the hole diagram (the picture).** Study the actual hole illustration / overhead diagram and extract observations a caddie would make from looking at the image:
   - "visualNotes": 2-4 concise observations as a single string, semicolon-separated. Focus on (a) distance numbers visible on the diagram that aren't covered by hazards/carry_yards — sprinkler-to-landmark yardages, distances to bunker centers, distance to forced carries; (b) fairway shape — pinches, widening, doglegs visible from the overhead; (c) green shape and orientation (kidney, round, peanut, angled L-R, etc.); (d) elevation / cross-slope cues if drawn. Use null if the diagram has no visible markers worth noting.
   - "distanceMarkers": array of {label, yards} for sprinkler/landmark distances clearly readable on the diagram. Empty array if none readable.

(3) **Hazards and dogleg**, in "hazardsByHole":
   - "dogleg": "left" | "right" | "straight"
   - "hazards": array of {"type": "bunker"|"water"|"creek"|"native"|"OB"|"trees", "side": "L"|"R"|"C"|"front"|"back", "carry_yards": <int or null>, "notes": short positional label}
   - "green_notes": tier/slope/shape notes if visible
   - "recommended_line": short caddie-style advice if a clear ideal line is implied

CRITICAL: never guess. If a hole's diagram is illegible or a field isn't found, use null for that field rather than inventing content, but still include an entry for the hole with whatever you found. Capture the description paragraph EXACTLY as printed.

Return ONLY this JSON (no markdown):
{
  "hazardsByHole": [
    {"hole":1,"holeName":"Outward Right","description":"This medium-length, dogleg right plays along…","greenDepth":31,"visualNotes":"FW narrows to ~28y at 240; cross-bunker carved into inside corner; green angled left-to-right with hollow short-left","distanceMarkers":[{"label":"sprinkler to front green","yards":62},{"label":"sprinkler to back","yards":108}],"dogleg":"left","hazards":[{"type":"bunker","side":"R","carry_yards":235,"notes":"fairway"}],"green_notes":"","recommended_line":""},
    ...all 18
  ]
}

If the PDF doesn't contain usable hole diagrams: {"error":"PDF did not contain parseable hole detail"}` },
    ],
  }]
}
