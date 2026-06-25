import {
  supabase,
  getAllCachedCoursesDB,
  listCoursePdfs,
  uploadCoursePdfToBucket,
  deleteAllCoursePdfs,
  clearCachedScorecardPdfRef,
  deleteCourseHazards,
  loadCourseHazards,
  setCachedCourseDB,
} from '../lib/supabase.js'
import { adminUploadScorecardPdf } from '../lib/courseApi.js'
import { loadCourseCache, saveCourseCache, setCachedCourse, cacheKey } from '../lib/courseCache.js'
import { mergeUploadedScorecard, isSameCourseKey } from '../lib/scorecardMerge.js'
import { AVAILABLE_MODELS, LS_COURSE_CACHE } from '../lib/appConstants.js'
import { C, F, card, inp, lbl, btnP, btnG } from '../theme.js'
import { Badge } from '../components/ui.jsx'

export default function SettingsTab({
  isMobile, isAdmin, user, session, onSignOut,
  course, setCourse,
  selectedModel, setSelectedModel,
  acctSection, setAcctSection,
  acctLoading, setAcctLoading,
  acctMsg, setAcctMsg,
  acctNewPass, setAcctNewPass,
  acctConfirmPass, setAcctConfirmPass,
  acctNewEmail, setAcctNewEmail,
  sharedCache, setSharedCache,
  sharedCacheLoading, setSharedCacheLoading,
  sharedCacheError, setSharedCacheError,
  scorecardBusyKey, setScorecardBusyKey,
  scorecardMsg, setScorecardMsg,
  adminUsers, setAdminUsers,
  adminUsersLoading, setAdminUsersLoading,
  adminUsersError, setAdminUsersError,
  adminDeleteMsg, setAdminDeleteMsg,
  adminGrantMsg, setAdminGrantMsg,
  setCacheVersion,
  setEditorCourse,
  setTab, setPrepStep,
  applyScorecard,
}) {
  const cache = loadCourseCache()
  const entries = Object.values(cache).sort((a, b) => (b._cachedAt || 0) - (a._cachedAt || 0))

  const acctAction = async (fn) => {
    setAcctLoading(true); setAcctMsg(null)
    try {
      await fn()
    } catch (e) {
      setAcctMsg({ type: 'err', text: e.message })
    } finally {
      setAcctLoading(false)
    }
  }

  const handleChangePassword = () => acctAction(async () => {
    if (acctNewPass.length < 8) throw new Error('Password must be at least 8 characters.')
    if (acctNewPass !== acctConfirmPass) throw new Error('Passwords do not match.')
    const { error } = await supabase.auth.updateUser({ password: acctNewPass })
    if (error) throw error
    setAcctMsg({ type: 'ok', text: 'Password updated successfully.' })
    setAcctNewPass(''); setAcctConfirmPass(''); setAcctSection(null)
  })

  const handleChangeEmail = () => acctAction(async () => {
    if (!acctNewEmail || !acctNewEmail.includes('@')) throw new Error('Enter a valid email address.')
    const { error } = await supabase.auth.updateUser({ email: acctNewEmail })
    if (error) throw error
    setAcctMsg({ type: 'ok', text: 'Confirmation sent to your new email. Check your inbox.' })
    setAcctNewEmail(''); setAcctSection(null)
  })

  const handleDeleteAccount = () => acctAction(async () => {
    const authToken = session?.access_token || ''
    const res = await fetch('/api/delete-account', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      throw new Error(d.error || `Request failed (${res.status})`)
    }
    await supabase.auth.signOut()
    if (onSignOut) onSignOut()
  })

  const loadAdminUsers = async () => {
    setAdminUsersLoading(true); setAdminUsersError(''); setAdminDeleteMsg(''); setAdminGrantMsg('')
    const authToken = session?.access_token || ''
    try {
      const res = await fetch('/api/admin-users', { headers: { Authorization: `Bearer ${authToken}` } })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || `${res.status}`)
      }
      setAdminUsers(await res.json())
    } catch (e) {
      setAdminUsersError(e.message)
    }
    setAdminUsersLoading(false)
  }

  const handleDeleteUser = async (userId, email) => {
    if (!window.confirm(`Permanently delete user ${email}? This cannot be undone.`)) return
    setAdminDeleteMsg('')
    const authToken = session?.access_token || ''
    try {
      const res = await fetch('/api/admin-users', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ userId }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || `${res.status}`)
      }
      setAdminDeleteMsg(`Deleted ${email}`)
      setAdminUsers(prev => prev ? prev.filter(u => u.id !== userId) : prev)
    } catch (e) {
      setAdminDeleteMsg(`Error: ${e.message}`)
    }
  }

  const sectionHead = (title, sub) => (
    <div style={{ marginBottom: 14 }}>
      <h3 style={{ fontSize: 15, fontWeight: 600, color: C.text, margin: 0 }}>{title}</h3>
      {sub && <p style={{ fontSize: 12, color: C.textMuted, margin: '3px 0 0' }}>{sub}</p>}
    </div>
  )

  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 600, color: C.text, margin: '0 0 20px' }}>Settings</h2>

      {/* ── Account ── */}
      <div style={{ ...card, marginBottom: 16 }}>
        {sectionHead('Your account')}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
          <div>
            <p style={{ fontSize: 13, color: C.textMuted, margin: 0 }}>Signed in as</p>
            <p style={{ fontSize: 14, fontWeight: 600, color: C.text, margin: '2px 0 0' }}>{user?.email}</p>
          </div>
          <button style={{ ...btnG, color: C.red, borderColor: C.red }}
            onClick={async () => {
              if (window.confirm('Sign out of Golf Strategy Engine?')) {
                await supabase.auth.signOut()
                if (onSignOut) onSignOut()
              }
            }}>
            Sign out
          </button>
        </div>

        {acctMsg && (
          <div style={{ padding: '8px 12px', borderRadius: 8, marginBottom: 12, fontSize: 13,
            background: acctMsg.type === 'ok' ? C.greenMuted : C.redMuted,
            border: `1px solid ${acctMsg.type === 'ok' ? C.green : C.red}`,
            color: acctMsg.type === 'ok' ? C.green : C.red,
          }}>{acctMsg.text}</div>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button style={btnG} onClick={() => { setAcctSection(acctSection === 'password' ? null : 'password'); setAcctMsg(null) }}>
            Change password
          </button>
          <button style={btnG} onClick={() => { setAcctSection(acctSection === 'email' ? null : 'email'); setAcctMsg(null) }}>
            Change email
          </button>
          <button style={{ ...btnG, color: C.red, borderColor: C.red, marginLeft: 'auto' }}
            onClick={() => { setAcctSection(acctSection === 'delete' ? null : 'delete'); setAcctMsg(null) }}>
            Delete account
          </button>
        </div>

        {acctSection === 'password' && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10, marginBottom: 10 }}>
              <div>
                <label style={lbl}>New password</label>
                <input type="password" style={inp} placeholder="8+ characters" value={acctNewPass}
                  onChange={e => setAcctNewPass(e.target.value)} autoFocus />
              </div>
              <div>
                <label style={lbl}>Confirm new password</label>
                <input type="password" style={inp} placeholder="Repeat password" value={acctConfirmPass}
                  onChange={e => setAcctConfirmPass(e.target.value)} />
              </div>
            </div>
            <button style={{ ...btnP, width: 'auto', padding: '8px 18px' }}
              onClick={handleChangePassword} disabled={acctLoading}>
              {acctLoading ? 'Updating…' : 'Update password'}
            </button>
          </div>
        )}

        {acctSection === 'email' && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
            <p style={{ fontSize: 12, color: C.textMuted, margin: '0 0 10px' }}>
              A confirmation link will be sent to the new address. Your current email remains active until confirmed.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr auto', gap: 10, alignItems: 'flex-end' }}>
              <div>
                <label style={lbl}>New email address</label>
                <input type="email" style={inp} placeholder="new@email.com" value={acctNewEmail}
                  onChange={e => setAcctNewEmail(e.target.value)} autoFocus />
              </div>
              <button style={{ ...btnP, padding: '8px 18px', whiteSpace: 'nowrap', ...(isMobile && { width: '100%' }) }}
                onClick={handleChangeEmail} disabled={acctLoading}>
                {acctLoading ? 'Sending…' : 'Send confirmation'}
              </button>
            </div>
          </div>
        )}

        {acctSection === 'delete' && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
            <div style={{ padding: '10px 14px', background: C.redMuted, border: `1px solid ${C.red}`, borderRadius: 8, marginBottom: 12 }}>
              <p style={{ fontSize: 13, color: C.red, margin: 0, fontWeight: 600 }}>⚠ This permanently deletes your account and all data</p>
              <p style={{ fontSize: 12, color: C.red, margin: '4px 0 0' }}>All profiles, scoring history, and settings will be erased. This cannot be undone.</p>
            </div>
            <div style={{ marginBottom: 10 }}>
              <label style={{ ...lbl, color: C.red }}>Type DELETE to confirm</label>
              <input style={{ ...inp, borderColor: C.red }} placeholder="DELETE" id="delete-confirm"
                onChange={e => { e.target.dataset.ready = e.target.value === 'DELETE' ? '1' : '' }} />
            </div>
            <button style={{ background: C.red, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: F }}
              onClick={() => { const el = document.getElementById('delete-confirm'); if (el?.dataset.ready === '1') handleDeleteAccount() }}
              disabled={acctLoading}>
              {acctLoading ? 'Deleting…' : 'Yes, delete my account'}
            </button>
          </div>
        )}
      </div>

      {/* ── AI Model ── */}
      <div style={{ ...card, marginBottom: 16 }}>
        {sectionHead('AI model', 'Choose which Claude model generates your game plans. More capable models produce deeper analysis.')}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
          {AVAILABLE_MODELS.map(m => {
            const active = selectedModel === m.id
            return (
              <button key={m.id} onClick={() => setSelectedModel(m.id)} style={{
                background: active ? C.accentMuted : C.bgInput,
                border: `1px solid ${active ? C.accent : C.border}`,
                borderRadius: 10, padding: '12px 14px', cursor: 'pointer', textAlign: 'left',
                fontFamily: F, transition: 'border-color .15s',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: active ? C.accent : C.text }}>{m.name}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 99,
                    background: m.tier === 'Free' ? C.greenMuted : m.tier === 'Standard' ? C.blueMuted : C.amberMuted,
                    color:      m.tier === 'Free' ? C.green      : m.tier === 'Standard' ? C.blue      : C.amber,
                  }}>{m.tier}</span>
                </div>
                <p style={{ fontSize: 12, color: C.textMuted, margin: 0, lineHeight: 1.4 }}>{m.desc}</p>
                <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
                  <span style={{ fontSize: 10, color: C.textFaint }}>Speed: {m.speed}</span>
                  <span style={{ fontSize: 10, color: C.textFaint }}>Cost: {m.cost}</span>
                </div>
              </button>
            )
          })}
        </div>
        <p style={{ fontSize: 11, color: C.textFaint, margin: '12px 0 0' }}>
          Current selection: <strong style={{ color: C.text }}>{AVAILABLE_MODELS.find(m => m.id === selectedModel)?.name || selectedModel}</strong> — counts toward your daily rate limit per generation.
        </p>
      </div>

      {/* ── API Keys ── */}
      <div style={{ ...card, marginBottom: 16 }}>
        {sectionHead('API Keys', 'Optional — course search uses a free API by default. Add keys for premium data sources.')}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
          <div style={{ padding: '10px 14px', background: C.greenMuted, border: `1px solid ${C.green}`, borderRadius: 8 }}>
            <p style={{ fontSize: 12, color: C.green, margin: 0 }}>All API keys are managed server-side. No client-side keys needed.</p>
            <p style={{ fontSize: 11, color: C.textMuted, margin: '4px 0 0' }}>GolfCourseAPI and Anthropic keys are configured in Vercel environment variables.</p>
          </div>
        </div>
      </div>

      {/* ── Course cache ── */}
      <div style={{ ...card, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            {sectionHead('Course cache', `${entries.length} course${entries.length !== 1 ? 's' : ''} stored — loaded instantly, no API call needed`)}
          </div>
          {entries.length > 0 && (
            <button style={{ ...btnG, color: C.red, borderColor: C.red, flexShrink: 0 }}
              onClick={() => { if (window.confirm('Clear all cached courses?')) { localStorage.removeItem(LS_COURSE_CACHE); setCacheVersion(v => v + 1) } }}>
              Clear all
            </button>
          )}
        </div>
        {entries.length === 0 ? (
          <p style={{ fontSize: 12, color: C.textFaint, fontStyle: 'italic', textAlign: 'center', padding: '1rem 0', margin: 0 }}>
            No courses cached yet — courses save automatically after the first search.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {entries.map((c, i) => (
              <div key={i} style={{ background: C.bgInput, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: C.text, margin: 0 }}>{c.name}</p>
                    <Badge
                      label={c.source === 'GolfCourseAPI' ? '✓ Verified' : '⚠ Web search'}
                      bg={c.source === 'GolfCourseAPI' ? C.greenMuted : C.amberMuted}
                      fg={c.source === 'GolfCourseAPI' ? C.green : C.amber}
                    />
                  </div>
                  <p style={{ fontSize: 11, color: C.textMuted, margin: 0 }}>
                    {c.location} · Par {c.par} · {c.yardage ? Number(c.yardage).toLocaleString() + 'y' : '—'}
                    {c.rating ? ` · ${c.rating}/${c.slope}` : ''}
                    {' · '}Cached {c._cachedAt ? new Date(c._cachedAt).toLocaleDateString() : '—'}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 8, marginLeft: 12, flexShrink: 0 }}>
                  <button style={btnG} onClick={() => { applyScorecard(c); setTab('prep'); setPrepStep(2) }}>Load →</button>
                  <button style={{ ...btnG, color: C.red, borderColor: C.red }}
                    onClick={() => {
                      const updated = loadCourseCache()
                      delete updated[cacheKey(c.name, c.location)]
                      saveCourseCache(updated)
                      setCacheVersion(v => v + 1)
                    }}>
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Shared course scorecards (admin only) ── */}
      {isAdmin === true && (() => {
        const authToken = session?.access_token || ''

        const loadSharedCache = async () => {
          setSharedCacheLoading(true); setSharedCacheError(''); setScorecardMsg('')
          try {
            const rows = await getAllCachedCoursesDB()
            const withPdfs = await Promise.all(rows.map(async (c) => {
              const pdfs = await listCoursePdfs(c.name, c.location).catch(() => [])
              return { ...c, _pdfs: pdfs }
            }))
            setSharedCache(withPdfs)
          } catch (e) {
            setSharedCacheError(e.message)
          }
          setSharedCacheLoading(false)
        }

        const handleUploadScorecard = async (c, file) => {
          if (!file) return
          if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
            setScorecardMsg('Error: file must be a PDF.'); return
          }
          const key = c._cacheKey
          setScorecardBusyKey(key); setScorecardMsg('')
          try {
            setScorecardMsg(`Uploading PDF for ${c.name}…`)
            const { url } = await uploadCoursePdfToBucket(c.name, c.location, file)
            setScorecardMsg(`Parsing PDF for ${c.name}…`)
            const result = await adminUploadScorecardPdf(authToken, {
              courseName: c.name,
              location: c.location,
              pdfUrl: url,
            })
            const conf = result?._confidence || 'medium'

            const merged = { ...result, name: c.name, location: c.location }
            setCachedCourse(merged)
            try { await setCachedCourseDB(merged) } catch {}
            if (isSameCourseKey(course, c)) {
              const hazardsByRef = await loadCourseHazards(c.name, c.location).catch(() => ({}))
              setCourse(prev => mergeUploadedScorecard(prev, result, hazardsByRef))
              setCacheVersion(v => v + 1)
            }

            setScorecardMsg(`✓ Scorecard updated for ${c.name} (confidence: ${conf}). Visible to all users.`)
            await loadSharedCache()
          } catch (e) {
            setScorecardMsg(`Error: ${e.message}`)
          }
          setScorecardBusyKey('')
        }

        const handleRemoveScorecard = async (c) => {
          if (!window.confirm(`Remove the uploaded scorecard PDF + extracted hazards for ${c.name}?\n\nThe course will fall back to API / auto-discovered data on next lookup. All users will see this change.`)) return
          setScorecardBusyKey(c._cacheKey); setScorecardMsg('')
          try {
            const n = await deleteAllCoursePdfs(c.name, c.location)
            await deleteCourseHazards(c.name, c.location)
            await clearCachedScorecardPdfRef(c.name, c.location)
            setScorecardMsg(`✓ Removed ${n} PDF${n === 1 ? '' : 's'} + hazards for ${c.name}. Visible to all users.`)
            await loadSharedCache()
          } catch (e) {
            setScorecardMsg(`Error: ${e.message}`)
          }
          setScorecardBusyKey('')
        }

        return (
          <div style={{ ...card, marginBottom: 16 }}>
            {sectionHead('Shared course scorecards (admin)', 'Upload official yardage book PDFs as a manual backup when auto-discovery falls short. Stored in the shared cache — every user sees the update on next lookup.')}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
              <button style={btnG} onClick={loadSharedCache} disabled={sharedCacheLoading}>
                {sharedCacheLoading ? 'Loading…' : sharedCache ? 'Refresh' : 'Load cached courses'}
              </button>
              {scorecardMsg && (
                <span style={{ fontSize: 12, color: scorecardMsg.startsWith('Error') ? C.red : scorecardMsg.startsWith('✓') ? C.green : C.textMuted }}>
                  {scorecardMsg}
                </span>
              )}
            </div>
            {sharedCacheError && (
              <div style={{ padding: '10px 14px', background: C.redMuted, border: `1px solid ${C.red}`, borderRadius: 8, marginBottom: 10 }}>
                <p style={{ fontSize: 12, color: C.red, margin: 0 }}>⚠ {sharedCacheError}</p>
              </div>
            )}
            {sharedCache && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <p style={{ fontSize: 11, color: C.textMuted, margin: 0 }}>
                  {sharedCache.length} course{sharedCache.length !== 1 ? 's' : ''} in shared cache (Supabase)
                </p>
                {sharedCache.length === 0 && (
                  <p style={{ fontSize: 12, color: C.textFaint, fontStyle: 'italic', textAlign: 'center', padding: '1rem 0', margin: 0 }}>
                    No courses cached yet. After a user resolves a course, it appears here.
                  </p>
                )}
                {sharedCache.map(c => {
                  const busy = scorecardBusyKey === c._cacheKey
                  const hasPdf = c._pdfs?.length > 0 || !!c._sourcePdf
                  return (
                    <div key={c._cacheKey} style={{ background: C.bgInput, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 14px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <div style={{ flex: 1, minWidth: 200 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <p style={{ fontSize: 13, fontWeight: 600, color: C.text, margin: 0 }}>{c.name}</p>
                            <Badge
                              label={c.source === 'GolfCourseAPI' ? '✓ API' : c.source === 'yardage_book' ? '📄 Yardage book' : c.source === 'OpenGolfAPI' ? '~ OpenGolf' : c.source || '—'}
                              bg={c.source === 'GolfCourseAPI' ? C.greenMuted : c.source === 'yardage_book' ? C.blueMuted : C.amberMuted}
                              fg={c.source === 'GolfCourseAPI' ? C.green : c.source === 'yardage_book' ? C.blue : C.amber}
                            />
                            {hasPdf && <Badge label="PDF on file" bg={C.accentMuted} fg={C.accent} />}
                            {c._needs_review && <Badge label="needs review" bg={C.redMuted} fg={C.red} />}
                          </div>
                          <p style={{ fontSize: 11, color: C.textMuted, margin: '2px 0 0' }}>
                            {c.location} · Par {c.par} · {c.yardage ? Number(c.yardage).toLocaleString() + 'y' : '—'}
                            {c._hitCount != null ? ` · ${c._hitCount} hit${c._hitCount === 1 ? '' : 's'}` : ''}
                          </p>
                          {c._pdfs?.length > 0 && (
                            <p style={{ fontSize: 11, color: C.textFaint, margin: '4px 0 0' }}>
                              {c._pdfs.length} PDF{c._pdfs.length === 1 ? '' : 's'} stored ·{' '}
                              <a href={c._pdfs[c._pdfs.length - 1].url} target="_blank" rel="noopener noreferrer" style={{ color: C.accent }}>
                                view latest
                              </a>
                            </p>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
                          <button style={{ ...btnG, padding: '6px 10px' }} disabled={busy}
                            onClick={() => setEditorCourse(c)}>
                            ✎ Edit metadata
                          </button>
                          <label style={{ ...btnG, padding: '6px 10px', cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.5 : 1, pointerEvents: busy ? 'none' : 'auto', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            {busy ? 'Working…' : '📄 Upload PDF'}
                            <input
                              type="file"
                              accept="application/pdf,.pdf"
                              style={{ display: 'none' }}
                              disabled={busy}
                              onChange={e => {
                                const f = e.target.files?.[0]
                                e.target.value = ''
                                if (f) handleUploadScorecard(c, f)
                              }}
                            />
                          </label>
                          {hasPdf && (
                            <button style={{ ...btnG, color: C.red, borderColor: C.red, padding: '6px 10px' }} disabled={busy}
                              onClick={() => handleRemoveScorecard(c)}>
                              Remove PDF
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })()}

      {/* ── User management (admin only — hidden entirely for non-admins) ── */}
      {isAdmin === true && (
        <div style={{ ...card, marginBottom: 16 }}>
          {sectionHead('User management', 'List registered users, grant admin access, and remove accounts.')}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
            <button style={btnG} onClick={loadAdminUsers} disabled={adminUsersLoading}>
              {adminUsersLoading ? 'Loading…' : adminUsers ? 'Refresh' : 'Load users'}
            </button>
            {adminDeleteMsg && (
              <span style={{ fontSize: 12, color: adminDeleteMsg.startsWith('Error') ? C.red : C.green }}>{adminDeleteMsg}</span>
            )}
            {adminGrantMsg && (
              <span style={{ fontSize: 12, color: adminGrantMsg.startsWith('Error') ? C.red : C.green }}>{adminGrantMsg}</span>
            )}
          </div>
          {adminUsersError && (
            <div style={{ padding: '8px 12px', background: C.redMuted, border: `1px solid ${C.red}`, borderRadius: 8, marginBottom: 10 }}>
              <p style={{ fontSize: 12, color: C.red, margin: 0 }}>⚠ {adminUsersError}</p>
            </div>
          )}
          {adminUsers && (
            <div>
              <p style={{ fontSize: 12, color: C.textMuted, margin: '0 0 10px' }}>
                {adminUsers.length} registered user{adminUsers.length !== 1 ? 's' : ''}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {adminUsers.map(u => (
                  <div key={u.id} style={{ background: C.bgInput, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: isMobile ? 'flex-start' : 'center', gap: 10, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <p style={{ fontSize: 13, fontWeight: 600, color: C.text, margin: 0 }}>{u.email}</p>
                        {u.id === user?.id && <Badge label="You" bg={C.accentMuted} fg={C.accent} />}
                        {u.isAdmin && <Badge label="Admin" bg={C.amberMuted} fg={C.amber} />}
                      </div>
                      <p style={{ fontSize: 11, color: C.textMuted, margin: '3px 0 0' }}>
                        Joined {u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}
                        {u.last_sign_in_at ? ` · Last login ${new Date(u.last_sign_in_at).toLocaleDateString()}` : ''}
                      </p>
                      <p style={{ fontSize: 11, color: C.textMuted, margin: '2px 0 0' }}>
                        Today: {u.usage_today ?? 0} calls
                        {u.tokens_today > 0 ? ` · ${u.tokens_today.toLocaleString()} tokens` : ''}
                        {' · '}All-time: {u.usage_total ?? 0} calls
                        {u.tokens_total > 0 ? ` · ${u.tokens_total.toLocaleString()} tokens` : ''}
                      </p>
                    </div>
                    {u.id !== user?.id && (
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        {!u.isAdmin && (
                          <button style={{ ...btnG, fontSize: 11 }}
                            onClick={async () => {
                              setAdminGrantMsg('')
                              const authToken = session?.access_token || ''
                              try {
                                const res = await fetch('/api/admin-users', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
                                  body: JSON.stringify({ grantId: u.id }),
                                })
                                if (!res.ok) throw new Error((await res.json()).error || res.status)
                                setAdminGrantMsg(`Admin granted to ${u.email}`)
                                setAdminUsers(prev => prev ? prev.map(x => x.id === u.id ? { ...x, isAdmin: true } : x) : prev)
                              } catch (e) {
                                setAdminGrantMsg(`Error: ${e.message}`)
                              }
                            }}>
                            Grant admin
                          </button>
                        )}
                        <button style={{ ...btnG, color: C.red, borderColor: C.red, fontSize: 11 }}
                          onClick={() => handleDeleteUser(u.id, u.email)}>
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
