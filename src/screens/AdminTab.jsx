import { useEffect, useState } from 'react'
import { C, F } from '../theme.js'
import { SectionHead } from '../components/ui.jsx'
import AdminOverviewPanel from '../components/AdminOverviewPanel.jsx'
import AdminUsersPanel from '../components/AdminUsersPanel.jsx'
import AdminCoursesPanel from '../components/AdminCoursesPanel.jsx'
import AdminDataPanel from '../components/AdminDataPanel.jsx'
import AdminUsagePanel from '../components/AdminUsagePanel.jsx'
import AdminAuditPanel from '../components/AdminAuditPanel.jsx'
import AdminOrgsPanel  from '../components/AdminOrgsPanel.jsx'

const ADMIN_SUBS = [
  { id: 'overview', label: 'Overview', icon: '📊' },
  { id: 'users',    label: 'Users',    icon: '👥' },
  { id: 'courses',  label: 'Courses',  icon: '⛳' },
  { id: 'data',     label: 'Data',     icon: '🗂' },
  { id: 'usage',    label: 'Usage',    icon: '📈' },
  { id: 'audit',    label: 'Audit',    icon: '📜' },
  { id: 'orgs',     label: 'Orgs',     icon: '🏢' },
]

export default function AdminTab({ isMobile, authToken, currentUserId, onEditCourse, activeOrgId, onOrgChange }) {
  const [sub, setSub] = useState('overview')

  // AdminOverviewPanel emits 'admin:sub' events so its quick-link buttons can
  // navigate to sibling sub-tabs without needing a prop callback chain.
  useEffect(() => {
    const handler = (e) => {
      if (ADMIN_SUBS.some(s => s.id === e.detail)) setSub(e.detail)
    }
    window.addEventListener('admin:sub', handler)
    return () => window.removeEventListener('admin:sub', handler)
  }, [])

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

      {sub === 'overview' && <AdminOverviewPanel authToken={authToken} />}
      {sub === 'users'    && <AdminUsersPanel    authToken={authToken} currentUserId={currentUserId} />}
      {sub === 'courses'  && <AdminCoursesPanel  authToken={authToken} onEditCourse={onEditCourse} />}
      {sub === 'data'     && <AdminDataPanel     onNavigate={setSub} />}
      {sub === 'usage'    && <AdminUsagePanel    authToken={authToken} />}
      {sub === 'audit'    && <AdminAuditPanel    authToken={authToken} />}
      {sub === 'orgs'     && <AdminOrgsPanel     authToken={authToken} currentUserId={currentUserId} activeOrgId={activeOrgId} onOrgChange={onOrgChange} />}
    </div>
  )
}
