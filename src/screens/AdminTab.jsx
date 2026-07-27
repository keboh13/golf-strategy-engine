import { useState, Component } from 'react'
import { C, F } from '../theme.js'
import { SectionHead } from '../components/ui.jsx'
import AdminOverviewPanel from '../components/AdminOverviewPanel.jsx'
import AdminUsersPanel from '../components/AdminUsersPanel.jsx'
import AdminCoursesPanel from '../components/AdminCoursesPanel.jsx'
import AdminUsagePanel from '../components/AdminUsagePanel.jsx'
import AdminAuditPanel from '../components/AdminAuditPanel.jsx'
import AdminOrgsPanel  from '../components/AdminOrgsPanel.jsx'

// Lightweight error boundary scoped to a single admin sub-panel so one
// crashing panel doesn't take down the whole Admin tab.
class PanelBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(e) { return { error: e } }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 10, padding: '24px 20px', textAlign: 'center' }}>
        <p style={{ color: C.red, fontWeight: 600, margin: '0 0 6px' }}>Panel error</p>
        <p style={{ color: C.textMuted, fontSize: 13, margin: '0 0 14px' }}>{this.state.error?.message || 'Unexpected error'}</p>
        <button
          onClick={() => this.setState({ error: null })}
          style={{ background: C.accent, color: C.bg, border: 'none', borderRadius: 8, padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: F }}
        >
          Retry
        </button>
      </div>
    )
  }
}

const ADMIN_SUBS = [
  { id: 'overview', label: 'Overview', icon: '📊' },
  { id: 'users',    label: 'Users',    icon: '👥' },
  { id: 'courses',  label: 'Courses',  icon: '⛳' },
  { id: 'usage',    label: 'Usage',    icon: '📈' },
  { id: 'audit',    label: 'Audit',    icon: '📜' },
  { id: 'orgs',     label: 'Orgs',     icon: '🏢' },
]

export default function AdminTab({ isMobile, authToken, currentUserId, onEditCourse, onCourseChanged, activeOrgId, onOrgChange }) {
  const [sub, setSub] = useState('overview')

  const handleSubNav = (tab) => {
    if (ADMIN_SUBS.some(s => s.id === tab)) setSub(tab)
  }

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

      {sub === 'overview' && <PanelBoundary><AdminOverviewPanel authToken={authToken} onSubNav={handleSubNav} /></PanelBoundary>}
      {sub === 'users'    && <PanelBoundary><AdminUsersPanel    authToken={authToken} currentUserId={currentUserId} /></PanelBoundary>}
      {sub === 'courses'  && <PanelBoundary><AdminCoursesPanel  authToken={authToken} onEditCourse={onEditCourse} onCourseChanged={onCourseChanged} /></PanelBoundary>}
      {sub === 'usage'    && <PanelBoundary><AdminUsagePanel    authToken={authToken} /></PanelBoundary>}
      {sub === 'audit'    && <PanelBoundary><AdminAuditPanel    authToken={authToken} /></PanelBoundary>}
      {sub === 'orgs'     && <PanelBoundary><AdminOrgsPanel     authToken={authToken} currentUserId={currentUserId} activeOrgId={activeOrgId} onOrgChange={onOrgChange} /></PanelBoundary>}
    </div>
  )
}
