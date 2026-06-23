// Wind decomposition: turn a (windDir, windSpeed) + hole bearing into the
// head/tail/cross components a caddy actually cares about, so the LLM doesn't
// have to do trig in its head (which it does unreliably).
//
// Conventions (matching src/lib/weather.js):
//   - windDir is the direction the wind is COMING FROM, in degrees from North,
//     clockwise (meteorological convention, same as windDir() in weather.js).
//   - bearingDeg is the direction the hole PLAYS TOWARD (tee→pin), degrees
//     clockwise from North (same as osmDesign.bearingDeg).
//   - windSpeed in mph.
//
// Returned components are signed:
//   - head:    positive = headwind (into face),    negative = tailwind
//   - cross:   positive = wind coming from the LEFT (pushes ball right),
//              negative = wind coming from the RIGHT (pushes ball left)
//   - Rounded to whole mph for prompt readability.

const RAD = Math.PI / 180

export function decomposeWind({ windDir, windSpeed, bearingDeg }) {
  if (windDir == null || windSpeed == null || bearingDeg == null) return null
  if (!Number.isFinite(windDir) || !Number.isFinite(windSpeed) || !Number.isFinite(bearingDeg)) return null
  if (windSpeed <= 0) return { headMph: 0, crossMph: 0, label: 'calm' }

  // Vector wind is BLOWING TOWARD (windDir + 180). Decompose along the hole
  // axis (bearingDeg) and perpendicular (bearingDeg + 90, i.e. the right side).
  const blowingToward = (windDir + 180) % 360
  const theta = (blowingToward - bearingDeg) * RAD
  const along = windSpeed * Math.cos(theta)        // +along  = tailwind
  const right = windSpeed * Math.sin(theta)        // +right  = wind pushing ball to the right (coming from the LEFT)

  // + 0 trick avoids JS -0 leaking into output / equality checks
  const headMph = Math.round(-along) + 0
  const crossMph = Math.round(right) + 0

  const parts = []
  if (Math.abs(headMph) >= 1) {
    parts.push(`${Math.abs(headMph)}mph ${headMph > 0 ? 'headwind' : 'tailwind'}`)
  }
  if (Math.abs(crossMph) >= 1) {
    parts.push(`${Math.abs(crossMph)}mph ${crossMph > 0 ? 'L→R cross' : 'R→L cross'}`)
  }
  const label = parts.length ? parts.join(', ') : 'calm'

  return { headMph, crossMph, label }
}

// Rough rule-of-thumb adjustment in YARDS for a straight headwind/tailwind on
// an iron shot — useful as a hint, never as gospel. ~1% of carry per 1mph
// headwind for a high-launching iron, ~0.7% with tailwind (PGA tour caddy
// heuristic; conservative on tailwind because it doesn't help as much as wind
// hurts). Crosswinds don't change distance much — they change line.
export function windDistanceAdjustmentYds(headMph, carryYds) {
  if (!Number.isFinite(headMph) || !Number.isFinite(carryYds)) return 0
  if (carryYds <= 0) return 0
  const pct = headMph > 0 ? 0.01 : 0.007
  return Math.round(headMph * pct * carryYds)
}
