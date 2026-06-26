import { useState } from 'react'
import { C, F, card, lbl } from '../theme.js'
import { SectionHead } from '../components/ui.jsx'
import AdminUsersPanel from '../components/AdminUsersPanel.jsx'
import AdminCoursesPanel from '../components/AdminCoursesPanel.jsx'
import AdminUsagePanel from '../components/AdminUsagePanel.jsx'
import AdminAuditPanel from '../components/AdminAuditPanel.jsx'

// Top-level Admin area. Part 4 step 9 of the optimization plan — promotes
// admin out of the Settings tab into its own first-class section with a
// stable sub-tab layout. This first PR ships the scaffold + sub-nav; the
// existing admin features (User Management, Shared Course Scorecards) are
// migrated out of SettingsTab into the matching sub-tabs in a follow-up.
//
// Visibility is gated by `isAdmin === true` at the App level; this component
// trusts that gate and renders unconditionally.

const ADMIN_SUBS = [
  { id: 'overview', label: 'Overview', icon: '📊', desc: 'KPIs and quick stats' },
  { id: 'users',    label: 'Users',    icon: '👥', desc: 'List, grant roles, delete' },
  { id: 'courses',  label: 'Courses',  icon: '⛳', desc: 'Edit metadata, upload scorecards, reparse' },
  { id: 'data',     label: 'Data',     icon: '🗂', desc: 'Cache browser, OSM refresh, contributions' },
  { id: 'usage',    label: 'Usage',    icon: '📈', desc: 'API usage, recommendation quality' },
  { id: 'audit',    label: 'Audit',    icon: '📜', desc: 'Who changed what & when' },
]

function PlaceholderCard({ title, sub, hint }) {
  return (
    <div style={{ ...card, padding: '1.5rem 1.75rem', textAlign: 'left' }}>
      <p style={{ ...lbl, margin: '0 0 4px' }}>{title}</p>
      <p style={{ fontSize: 13, color: C.textMuted, margin: '0 0 12px', lineHeight: 1.5 }}>{sub}</p>
      <p style={{ fontSize: 12, color: C.textFaint, margin: 0, fontStyle: 'italic' }}>{hint}</p>
    </div>
  )
}

export default function AdminTab({ isMobile, authToken, currentUserId, onEditCourse }) {
  const [sub, setSub] = useState('overview')

  return (
    <div>
      <SectionHead title="🛡️ Admin" sub="Owner / admin tooling. Not visible to standard users." />

      {/* Sub-tab navigation */}
      <div role="tablist" aria-label="Admin sections" style={{ display: 'flex', gap: 4, marginBottom: 16, background: C.bgInput, borderRadius: 10, padding: 4, overflowX: 'auto' }}>
        {ADMIN_SUBS.map(s => (
          <button
            key={s.id}
            role="tab"
            aria-selected={sub === s.id}
            onClick={() => setSub(s.id)}
            style={{
              flex: isMobile ? 1 : 'none',
              padding: isMobile ? '10px 6px' : '10px 16px',
              fontSize: isMobile ? 11 : 13, fontWeight: 500, fontFamily: F,
              border: 'none', borderRadius: 8, cursor: 'pointer',
              background: sub === s.id ? C.accent : 'transparent',
              color: sub === s.id ? C.bg : C.textMuted,
              whiteSpace: 'nowrap', transition: 'all 0.15s', minHeight: 44,
            }}
          >
            {s.icon} {isMobile ? s.label.split(' ')[0] : s.label}
          </button>
        ))}
      </div>

      {/* Sub-tab content. Each panel starts as a placeholder describing what
          lands in the follow-up PRs (Part 4 steps 10–12 of the optimization
          plan). Keeps the IA stable while the features migrate. */}
      {sub === 'overview' && (
        <PlaceholderCard
          title="Overview"
          sub="High-level KPIs at a glance: total users, courses cached, recommendations today, errors today, p50/p95 generation duration."
          hint="Wires up alongside the Usage sub-tab in the next admin PR."
        />
      )}
      {sub === 'users' && (
        <AdminUsersPanel authToken={authToken} currentUserId={currentUserId} />
      )}
      {sub === 'courses' && (
        <AdminCoursesPanel authToken={authToken} onEditCourse={onEditCourse} />
      )}
      {sub === 'data' && (
        <PlaceholderCard
          title="Data"
          sub="Course cache browser (currently in Settings), per-course OSM refresh, contributions queue, Tier-3 diagnostic, manual scorecard PDF upload."
          hint="Settings → Course Cache moves here."
        />
      )}
      {sub === 'usage' && (
        <AdminUsagePanel authToken={authToken} />
      )}
      {sub === 'audit' && (
        <AdminAuditPanel authToken={authToken} />
      )}
    </div>
  )
}
