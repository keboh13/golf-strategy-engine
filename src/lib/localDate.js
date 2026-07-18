// Local-date helpers. Existing sites reached for `new Date().toISOString().slice(0, 10)`,
// which returns the *UTC* calendar day — a brief generated at 7 pm US west
// coast (2 am UTC next day) was tagged with tomorrow's date in History. We
// only ever want the user's *local* calendar day for display and default
// values; wall-clock timestamps still use ISO / epoch elsewhere.

export function todayLocalIso(now = new Date()) {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
