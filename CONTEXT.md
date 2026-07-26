# Golf Strategy Engine

A golf round-prep tool: players load a course, get hole-by-hole strategy from an AI caddy, informed by verified course data and their own game stats.

## Language

### Course data provenance

Per-hole design data comes from three sources of decreasing trust. All three can coexist on one hole; higher trust wins when rendering.

**hzDesign**:
Per-hole hazard/design data extracted from a yardage-book PDF (vision) or a single hole-diagram photo. Highest-trust source — grounded in an actual document/image. Carries `dogleg`, `hazards[]`, `green_notes`, `greenDepth`, `holeName`, `description` (verbatim book text), `visualNotes` (diagram observations), `distanceMarkers`, and a `_confidence` rating.
_Avoid_: "yardage book data", "PDF data" (use the field name — it's also produced by single-image hazard extraction, not only PDFs)

**osmDesign**:
Per-hole design data derived from OpenStreetMap geometry (golf=hole/green/bunker/water ways via Overpass). Verified/measured — real polygons, not modeled or guessed. Includes `dogleg` (computed from centerline bend), `bearingDeg`, `hazards[]` (classified by position), `greenWidth`/`greenDepth` (measured from the green polygon).
_Avoid_: "OSM data" alone (ambiguous with raw Overpass response)

**webDesign**:
Per-hole design data from a Claude web-search pass over course-guide/review sites. Lowest-trust source — prose summarized by a model, no image grounding, used only as a fallback when OSM coverage is sparse.
_Avoid_: "AI design data" (hzDesign and the AI-generated green shape are also AI-produced; this term is specifically the web-search fallback)

### Tier

A course's OpenStreetMap geometry coverage, computed by `classifyTier()`: **1** = ≥70% of holes have both a green polygon and a centerline/fairway (real shapes render for most holes), **2** = at least 3 holes have partial geometry, **3** = effectively no usable OSM geometry (satellite-only). Drives which UI banner/CTA shows on the course map.
_Avoid_: "coverage level"

### course_key

The canonical identity for a course everywhere in the data layer: `"<name lower>|<location lower>"`. Used as the primary key across `course_cache`, `course_geo`, `course_hole_hazards`, `course_hole_contrib`. Renaming a course migrates all four via the `admin_rename_course` RPC and leaves a `course_aliases` row so old-name searches still resolve.
_Avoid_: "cache key" (that's the literal column name in `course_cache` only; `course_key` is the cross-table concept)

### Confidence

A `low | medium | high` rating attached to a parsed/extracted result (scorecard or hazards), reflecting how much the source data matched validation expectations — not a measure of source trustworthiness (see provenance above for that axis).
_Avoid_: "quality" (reserve for describing the fix/initiative itself, not a data attribute)

### Enrichment pipeline

The sequential background process that runs when a course is loaded for Round Prep, filling in data layers the scorecard doesn't carry: geocode → OSM geometry → hole design (web search) → community contributions → hazard intel. Each step is defined in `enrichSteps.js` with an `expectedMs` p50; the ProgressTracker surfaces latency warnings when a step exceeds its budget.
_Avoid_: "loading steps" (enrichment is specifically data-layer augmentation, not UI loading)

### edit_version

An integer on `course_cache` rows, bumped by admin edits (metadata patch, PDF reparse approval, rename). Client-side localStorage entries carry `_editVersion`; on boot, `purgeOrphanedLocalEntries` compares every local entry against the DB and evicts any whose version trails. This is the staleness mechanism that propagates admin changes to all users without requiring a push channel.
_Avoid_: "cache version" (that term is used for unrelated React state in App.jsx)

### postRound

The structured per-hole feedback a player records after completing a round: `{ scores: { [holeNum]: number }, notes: { [holeNum]: string }, generalNotes: string }`. Stored on `savedBriefs[].postRound` in localStorage. `getLatestPostRoundForCourse` selects the freshest entry for a course and `renderPriorRoundBlock` turns it into a prompt section so the next brief can reference specific prior-round mistakes. A separate `postRound_draft_{courseKey}` localStorage entry survives mobile tab eviction.
_Avoid_: "round notes" (ambiguous with the legacy freeform `notes` field on the same brief)

### AI-generated green

The `h.green` object attached to a hole by the recommendation response itself (pin position, slope, tier count) — invented fresh by the model on every plan generation, not derived from any real data source. Merged with `osmGreen` (real OSM polygon, when available) via `mergeGreen()` before rendering in `GreenView`. As of 2026-07-23, decided to stop displaying this fabricated layer — see [ADR-0001](./docs/adr/0001-suppress-fabricated-green-data.md).
_Avoid_: "green data" alone (ambiguous between this and the real, measured green polygon)
