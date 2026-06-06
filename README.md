# Golf Strategy Engine

AI-powered course prep for competitive golf — Q School edition.

**Features**
- Verified hole-by-hole scorecard data via OpenGolfAPI (15,667+ US courses, no key needed)
- Live weather per hole based on tee time and pace of play (Open-Meteo, free)
- Scoring history analysis with trend detection
- AI game plan via Claude — hole-by-hole strategy, weather adjustments, Q School pressure management
- Google Maps satellite embed (optional)

---

## Quick start

### 1. Prerequisites
- Node.js 18+
- An Anthropic API key — get one at [console.anthropic.com](https://console.anthropic.com/api-keys)

### 2. Install & run

```bash
# Clone or unzip the project folder
cd golf-strategy-engine

# Install dependencies
npm install

# Copy the env template and fill in your key
cp .env.example .env
# Edit .env — add your VITE_ANTHROPIC_API_KEY

# Start the app
npm run dev
# Opens at http://localhost:3000
```

### 3. Environment variables

```bash
# .env
VITE_ANTHROPIC_API_KEY=sk-ant-...        # Required
VITE_GOOGLE_MAPS_KEY=AIza...             # Optional — enables inline satellite view
```

Both variables are loaded at build time by Vite. The API key is only ever sent
to `api.anthropic.com` from your local browser — it never leaves your machine.

---

## Tab flow

**1 → Bag & player** Set club distances, shot shape, miss tendency, swing notes.

**2 → Scoring history** Enter recent rounds. Claude weights these to calibrate target score and birdie/bogey strategy.

**3 → Course setup** Search verified scorecard → auto-populates all 18 holes. Add caddy notes per hole. Set tee time and fetch live weather.

**4 → Course map** Satellite view centered on the course (requires Google Maps key, or opens Google Maps directly).

**5 → Game plan** Hit ⚡ Generate — Claude produces a full hole-by-hole brief.

---

## Scorecard data sources

### Primary: OpenGolfAPI
[OpenGolfAPI](https://opengolfapi.org) is a free, open REST API with 15,667+ US courses.
No API key required. ODbL licensed (same as OpenStreetMap).

```
Search:  GET https://api.opengolfapi.org/v1/courses/search?q=rhodes+ranch
Course:  GET https://api.opengolfapi.org/v1/courses/{id}
State:   GET https://api.opengolfapi.org/v1/courses/state/NV
```

The API returns tee sets with hole-by-hole yardage, par, and handicap index.
The app selects the championship/back tee automatically.

**Data quality:** Community-maintained, generally accurate for US public and semi-private courses.
For courses missing from OpenGolfAPI you can [contribute data](https://github.com/opengolfapi).

### Fallback: Claude web search → greenskeeper.org
If OpenGolfAPI returns no results, the app uses Claude with web search to find
the scorecard on greenskeeper.org or the course's own website. This requires
your Anthropic API key and is used automatically.

### Last resort: manual entry
Every hole field is editable. If neither source finds the course, enter yardages
manually from the course's own scorecard (website, PDF, or physical card).

### Data verification tip
Always cross-check yardages against the course's official website before a
tournament round. OpenGolfAPI data may lag behind recent tee changes.

---

## Weather fetch — troubleshooting

The app uses a **3-tier fallback chain** for geocoding the course location,
then fetches from [Open-Meteo](https://open-meteo.com) (free, no key required).

### Tier 1 — Coordinates from OpenGolfAPI (automatic)
When you load a course via the scorecard search, OpenGolfAPI returns lat/lng
with the course data. These are used directly. **Most reliable — use the
scorecard search first.**

### Tier 2 — Claude web search geocode (automatic fallback)
If no coordinates are available, the app asks Claude to search for the course
coordinates. Requires `VITE_ANTHROPIC_API_KEY` in `.env`.

**This is the most common failure point.** It fails when:
- The API key is missing or invalid
- The course name is ambiguous (e.g. "Pines Golf Club" matches dozens of courses)
- Claude's web search doesn't return coordinate data in the expected format

**Fix:** Make the course name more specific. Add city/state in the Course Setup
location field. Example: "Rhodes Ranch Golf Club" + "Las Vegas, NV" not just "Rhodes Ranch".

### Tier 3 — Manual coordinates (shown as UI fallback)
If both automatic tiers fail, the app shows a manual entry form.

**How to find coordinates:**
1. Go to [google.com/maps](https://maps.google.com)
2. Search for the course name
3. Right-click on the course → click the coordinates shown at the top of the popup
4. Paste into the Latitude / Longitude fields in the app

**Example for Rhodes Ranch:** `36.0430, -115.2889`

### Open-Meteo errors
Open-Meteo is free with no rate limits for typical usage. If it fails:
- Check your internet connection
- Try again — transient errors are common
- Open-Meteo's status: [status.open-meteo.com](https://status.open-meteo.com)

### Weather not matching expected hole times
- Verify the tee date is set correctly (defaults to today)
- Check the pace setting (default 11 min/hole)
- Weather is shown in your local browser timezone

---

## Google Maps satellite view

Add `VITE_GOOGLE_MAPS_KEY` to `.env`.

**Getting a Maps Embed API key (free tier is sufficient):**
1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create or select a project
3. Enable the **Maps Embed API**
4. Create an API key under Credentials
5. Restrict the key to your localhost URL for security
6. Add to `.env`: `VITE_GOOGLE_MAPS_KEY=AIza...`

Without the key, the app shows a direct link to open the course in Google Maps satellite view instead.

---

## Architecture

```
src/
  main.jsx          React entry point
  App.jsx           Full application — all components and logic

External APIs (all CORS-enabled, called directly from browser):
  api.opengolfapi.org         Scorecard data (no key)
  api.anthropic.com           Claude — game plan, geocode, scorecard fallback
  api.open-meteo.com          Weather forecast (no key)
  nominatim.openstreetmap.org NOT used (blocks browser requests without User-Agent)
```

---

## Updating course data

If OpenGolfAPI is missing a course or has incorrect yardages, you can contribute:
- GitHub: [github.com/opengolfapi](https://github.com/opengolfapi)
- The dataset is community-edited (ODbL license)

For immediate use, enter yardages manually in the hole table — all fields are editable
after a scorecard is loaded.

---

## Running in Claude Code

```bash
# From within Claude Code terminal
cd golf-strategy-engine
npm install
npm run dev
```

Claude Code can also help you:
- Add new courses to the local dataset
- Export game plans as PDF
- Integrate GHIN scoring history import (requires USGA partner agreement)
- Add push notifications for weather changes on round day
