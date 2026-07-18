import { supabase } from '../lib/supabase.js'
import { loadCourseCache, saveCourseCache, cacheKey } from '../lib/courseCache.js'
import { AVAILABLE_MODELS, LS_COURSE_CACHE } from '../lib/appConstants.js'
import { C, F, card, inp, lbl, btnP, btnG } from '../theme.js'
import { Badge } from '../components/ui.jsx'

export default function SettingsTab({
  isMobile, user, session, onSignOut,
  selectedModel, setSelectedModel,
  acctSection, setAcctSection,
  acctLoading, setAcctLoading,
  acctMsg, setAcctMsg,
  acctNewPass, setAcctNewPass,
  acctConfirmPass, setAcctConfirmPass,
  acctNewEmail, setAcctNewEmail,
  setCacheVersion,
  setTab, setPrepStep,
  applyScorecard,
  onRunOnboarding,
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

      {/* ── Setup wizard ── */}
      {onRunOnboarding && (
        <div style={{ ...card, marginBottom: 16 }}>
          {sectionHead('Setup wizard', 'Re-run the guided first-time setup: player profile → bag → recent rounds → sample brief.')}
          <button style={btnG} onClick={onRunOnboarding}>Run setup wizard →</button>
        </div>
      )}

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
    </div>
  )
}