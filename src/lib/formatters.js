// Shared formatting utilities used across admin panels, library, and drawers.
// Extracted from AdminOverviewPanel, AdminUsagePanel, AdminCoursesPanel,
// CourseDetailDrawer, AdminUsersPanel, and LibraryTab to eliminate duplication.

import { C } from '../theme.js'

/**
 * Format a duration in milliseconds for display.
 * @param {number|null|undefined} ms
 * @returns {string}
 */
export function fmtMs(ms) {
  if (ms == null || ms === 0) return '—'
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

/**
 * Format a date ISO string as a short locale date.
 * @param {string|null|undefined} iso
 * @returns {string}
 */
export function shortDate(iso) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return iso }
}

/**
 * Return badge props { label, bg, fg } for a course source string.
 * @param {string} source
 * @returns {{ label: string, bg: string, fg: string }}
 */
export function sourceBadge(source) {
  if (source === 'GolfCourseAPI') return { label: '✓ GolfCourseAPI', bg: C.greenMuted,  fg: C.green }
  if (source === 'yardage_book')  return { label: '📄 Yardage book',  bg: C.blueMuted,   fg: C.blue }
  if (source === 'OpenGolfAPI')   return { label: '~ OpenGolf',       bg: C.amberMuted,  fg: C.amber }
  if (source === 'Claude')        return { label: '⚡ AI-derived',     bg: C.accentMuted, fg: C.accent }
  return { label: source || 'Unknown', bg: C.bgInput, fg: C.textMuted }
}
