// Elevation effective yardage.
//
// Two distinct adjustments:
//   1) Course altitude (feet above sea level) → thinner air → ball flies
//      farther. A common caddy rule is ~2% per 1000 ft for full shots.
//      Effective yardage shrinks: 150y at 5000ft plays like ~135y at sea level.
//   2) Per-hole tee-to-green elevation delta (feet uphill +, downhill –).
//      Rule of thumb: ~1 yard per foot of elevation change. Add yards uphill,
//      subtract downhill.
//
// We return effective playing yardage (always rounded) and a short label.

export function altitudeAdjustment(rawYds, elevationFt) {
  if (!Number.isFinite(rawYds) || rawYds <= 0) return 0
  if (!Number.isFinite(elevationFt) || elevationFt <= 0) return 0
  // -2% per 1000 ft (negative because effective yardage shrinks)
  return -Math.round(rawYds * 0.02 * (elevationFt / 1000))
}

export function holeElevationDeltaYds(deltaFt) {
  if (!Number.isFinite(deltaFt)) return 0
  // ~1 yard per foot, uphill adds (positive), downhill subtracts
  return Math.round(deltaFt)
}

export function effectiveYardage({ rawYds, courseElevationFt, holeDeltaFt }) {
  if (!Number.isFinite(rawYds) || rawYds <= 0) return null
  const altAdj = altitudeAdjustment(rawYds, courseElevationFt)
  const holeAdj = holeElevationDeltaYds(holeDeltaFt)
  const eff = rawYds + altAdj + holeAdj
  const adjustments = []
  if (altAdj !== 0) adjustments.push(`alt ${altAdj > 0 ? '+' : ''}${altAdj}y`)
  if (holeAdj !== 0) adjustments.push(`elev ${holeAdj > 0 ? '+' : ''}${holeAdj}y`)
  return {
    effectiveYds: Math.max(1, Math.round(eff)),
    rawYds: Math.round(rawYds),
    deltaYds: Math.round(eff - rawYds),
    label: adjustments.length ? adjustments.join(', ') : null,
  }
}
