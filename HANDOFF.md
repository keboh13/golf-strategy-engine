# Handoff: Import Data Pipeline — Worktree Continuation Plan

**Date:** 2026-06-10
**Repo:** `/Users/rachelhorvath/Downloads/golf-strategy-engine` (github: keboh13/golf-strategy-engine)
**Main checkout branch:** `feat/mvp-spec-implementation` — PR #7 (settings tab, admin gating, course-load fix, optional 2FA) was just merged to `main` and is deploying to production via Vercel git integration.

## Overall objective

The app is a golf strategy engine (React + Vite SPA, nearly all UI in the large `src/App.jsx`, serverless functions in `api/`, AI recommendations via `api/generate.js`, persistence via localStorage + Supabase auth). The goal of this work stream is to **enrich the data feeding the AI recommendation**:

1. **Richer player/bag data** — import real per-club performance stats from launch-monitor exports (Garmin R10, FlightScope, Rapsodo/SkyTrak) instead of hand-entered distances.
2. **Score history import** — paste-import of round history (GHIN, CSV, freeform) into the app's scoring history.
3. **AI-assisted import fallback** — an LLM endpoint that parses messy/unrecognized pasted data when the deterministic parsers can't.
4. **(Not started)** Better course-level data: scorecard + hole-specific info, especially **hole spatial direction/bearing**, so weather (wind) can be applied per-hole in recommendations. Low-cost options were the goal — OpenStreetMap golf tagging (hole ways with geometry → derive bearings) is the leading candidate.

The work lives in agent worktrees under `.claude/worktrees/`, each on its own branch. Run `git worktree list` to see them.

## Per-worktree status & objectives

### ✅ DONE (committed on their worktree branches, NOT pushed, NOT merged)

#### 1. Score-history paste import — `agent-a0502546790bd0cd5`, commit `ac03304`
- **File:** `src/lib/scoreImport.js` + `src/lib/scoreImport.test.js` (30 tests passing)
- Pure module, no app imports. Parses pasted score history into round objects matching the app's scoring-history shape (`src/App.jsx` ~line 1689: `{ course, location, date, score, par, toPar, roundType, conditions, notes }`; `toParStr` mirrors App.jsx:185).
- Handles: GHIN.com Score History rows (T/C round type letters, rating/slope into notes), CSV/TSV/" - "-delimited lines in any column order, freeform "date course score [par]" lines, broad date normalization (ISO, M/D/YYYY, D/M fallback, 2-digit years, "Jun 8, 2026" variants), dedupe within paste and against an `existingRounds` array, throws `Error('No rounds found')` on garbage.

#### 2. Shot store (aggregation layer) — `agent-ad282b87f57f9459c`, commit `6571c9c`
- **Files:** `src/lib/golfdata/shotStore.js` + `shotStore.test.js` (32 tests passing)
- `createShotStore(storage)` factory + lazy default bound to `localStorage` (key `gse_shots`), matching the app's persistence style (`LS_PLAYER`/`LS_PROFILES` keys in App.jsx).
- API: `appendSession(normalizedSession)` → `{added, duplicates}` (dedupe by `source|timestamp|clubKey|carryYds`, 5000-shot cap with oldest-session eviction, QuotaExceededError recovery); `getClubStats(options)` / pure `aggregateClubStats(sessions, options)` → per-club `{count, sources, lastShotAt, carry/total/offline {mean, std, min, max, n}, ball/club speed means}` with exponential recency weighting (90-day half-life, disable via `{recencyWeighting: false}`); `exportData()`/`importData(snapshot)` (merge-safe); `getSessions()`, `getAllShots()`, `getDropInfo()`, `clear()`.

#### 3. Garmin parser — `agent-a5dcc39bc2dd54a41`, commit `3153b35`
- **Files:** `src/lib/importers/garmin.parser.js`, `garmin.parser.test.js`, `__fixtures__/garmin.csv`
- Garmin R10 / Garmin Golf CSV import with per-club stats. Pure module, normalized per-club output (club, carry/total, dispersion, ball speed etc.). Committed; was the furthest-along parser.

#### 4. AI-assisted import fallback — `agent-a964b7da439f58b3e`, commit `52c94a8`
- **Files:** `api/parse-import.js` (new serverless endpoint), `src/lib/aiImport.js`, `src/lib/aiImport.test.js`, `.env.example` additions, small `api/generate.js` change.
- LLM-based parsing of unrecognized launch-monitor/score data, schema-validated structured output, auth/error handling consistent with `api/generate.js`. Tests mock the network.

### ⏳ WAS IN FLIGHT (check `git -C <worktree> log --oneline -1` — if still at `11ddc3f`, work is uncommitted/incomplete)

#### 5. FlightScope parser — `agent-a0416bd2bf071a478`
- **Files:** `src/lib/importers/flightscope.parser.js` (~400 lines existed), `__fixtures__/flightscope.csv`
- **Objective:** FlightScope CSV import following the same conventions as the Garmin parser (pure module, named exports, normalized per-club stats). Needs: edge cases (units, locale decimals, missing columns), a `flightscope.parser.test.js` vitest suite against the fixture, green tests, commit.

#### 6. Rapsodo/SkyTrak parser — `agent-a40ac50738241c4ac`
- **Files:** `src/lib/importers/rapsodo-skytrak.parser.js` (~530 lines existed), no fixtures/tests yet
- **Objective:** handle both Rapsodo (MLM/MLM2PRO) and SkyTrak export formats; create realistic fixtures under `__fixtures__/` (one per format) + `rapsodo-skytrak.parser.test.js`; green tests; commit.

#### 7. UI integration — `agent-a6bbef60c0128218d`
- **Files:** modified `src/App.jsx`, new `src/components/`, snapshot copies of `src/lib/golfdata/` and `src/lib/importers/`, package.json + vitest.config.js
- **Objective:** import UX in the player/bag section — paste or file-upload, format auto-detect via the importer modules, preview of parsed per-club stats, confirm-merge into bag state with the app's existing persistence. IMPORTANT: the lib modules in this worktree are snapshots; the canonical versions are in worktrees 1–6 above. Treat the lib API as the interface and merge canonical versions in. Must build (`npx vite build`).

### Related, already committed earlier (separate, review/merge candidates)
- `agent-a09a1d4f7fdd55597` branch `feat/persist-clubs-with-profile` commit `e767917` — persist club data with player profile across sessions.
- `agent-ab1635317dff92464` commit `610714e` — enrich recommendation prompt (`api/generate.js`) with per-club imported stats. This is the piece that makes the imported data actually affect recommendations.

### Empty/disposable worktrees
- `agent-a5aa1d4e6e4c88f6d`, `agent-ae452c5ce1ada7380` — nothing but settings.local.json noise; safe to remove.
- `agent-acc80000ca2cefb7b` — only vitest config, duplicated elsewhere; safe to remove.

## Merge plan (dependency order)

Create an integration branch off `main`, then merge/cherry-pick in this order, running tests at each step:

1. **Parsers + score import + shot store** (independent, any order): commits `3153b35` (garmin), `ac03304` (score import), `6571c9c` (shot store), plus FlightScope & Rapsodo commits once done. Conflicts will be trivial except package.json/vitest.config.js — unify the vitest setup once.
2. **AI fallback**: `52c94a8` (touches api/ + .env.example; check `api/generate.js` overlap with what's now on main).
3. **Club persistence + prompt enrichment**: `e767917`, `610714e`.
4. **UI integration** (`agent-a6bbef60c0128218d` work) last — replace its lib snapshots with the canonical merged modules, wire UI to the merged shot store API, build, manual test.
5. Open a PR to `main`. Do NOT commit `.claude/settings.local.json` anywhere (it contains a GolfCourseAPI key in its allowlist; the key is also in repo history — consider rotating + gitignoring).

## Not started: course/hole spatial data (the remaining objective)

Goal: per-hole direction/bearing + scorecard data so wind direction can be applied per-hole in `api/generate.js` recommendations. Low-cost options to evaluate:
- **OpenStreetMap** (free): golf tagging (`golf=hole` ways with geometry) via Overpass API → compute hole bearing from tee→green line; coverage varies by course.
- GolfCourseAPI (already integrated for course search; key in settings allowlist) — check what scorecard/hole data its tiers expose.
- USGA course rating DB / scraping scorecards — last resort.
Deliverable shape: per-hole `{number, par, yardage, bearingDeg}` stored with the course, consumed by the recommendation prompt alongside weather wind direction.

## Practical notes for the next session
- Each worktree has its own `node_modules` state; run `npm install` inside a worktree before `npm test`.
- Worktrees are locked (`git worktree list` shows `locked`); unlock with `git worktree unlock <path>` if removal is needed (`git worktree remove --force` for the disposable ones).
- All worktree branches are local-only — nothing pushed. Don't lose them when cleaning up: merge first, delete after.
