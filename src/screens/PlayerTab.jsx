import { C, F, card, inp, lbl, btnP, btnG } from '../theme.js'
import { SectionHead } from '../components/ui.jsx'
import ImportTab from '../components/ImportTab.jsx'
import { toParStr } from '../lib/weather.js'
import { DEFAULT_CLUBS } from '../lib/appConstants.js'

const PLAYER_SUBS = [
  { id: 'details', label: 'Player Details',  icon: '👤' },
  { id: 'clubs',   label: 'Club Distances',  icon: '🏌️' },
  { id: 'import',  label: 'Data Import',     icon: '📥' },
  { id: 'scoring', label: 'Scoring History', icon: '📊' },
]

export default function PlayerTab({
  isMobile,
  playerInfo, setPlayerInfo,
  clubs, setClubs,
  expandedClubs, setExpandedClubs,
  playerSubTab, setPlayerSubTab,
  scoringHistory, setScoringHistory,
  historySearch, updateHS, historySearchCourse, attachCourseToRound,
}) {
  return (
    <div>
      <SectionHead
        title="My Player"
        sub="Your profile, bag, and scoring data — synced with your account."
      />

      {/* Sub-tab navigation */}
      <div role="tablist" aria-label="Player sections" style={{ display: 'flex', gap: 4, marginBottom: 16, background: C.bgInput, borderRadius: 10, padding: 4, overflowX: 'auto' }}>
        {PLAYER_SUBS.map(s => (
          <button key={s.id} role="tab" aria-selected={playerSubTab === s.id} onClick={() => setPlayerSubTab(s.id)} style={{
            flex: isMobile ? 1 : 'none',
            padding: isMobile ? '10px 8px' : '10px 18px',
            fontSize: isMobile ? 11 : 13, fontWeight: 500, fontFamily: F,
            border: 'none', borderRadius: 8, cursor: 'pointer',
            background: playerSubTab === s.id ? C.accent : 'transparent',
            color: playerSubTab === s.id ? C.bg : C.textMuted,
            whiteSpace: 'nowrap', transition: 'all 0.15s', minHeight: 44,
          }}>
            {s.icon} {isMobile ? s.label.split(' ')[0] : s.label}
          </button>
        ))}
      </div>

      {/* ── Player Details sub-tab ── */}
      {playerSubTab === 'details' && (
        <div>
          <div style={{ ...card, marginBottom: 12 }}>
            {/* Identity section - collapsible on mobile */}
            <details open style={{ marginBottom: 14 }}>
              <summary style={{ padding: '8px 0', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, listStyle: 'none', WebkitAppearance: 'none', borderBottom: `1px solid ${C.border}`, paddingBottom: 10, marginBottom: 10 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>Identity & Handicap</span>
                <span style={{ fontSize: 11, color: C.textMuted }}>{playerInfo.name || 'Not set'} · HCP {playerInfo.handicap}</span>
              </summary>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
                {[['Name','name','Player name'],['Handicap Index','handicap','e.g. 4.2'],['GHIN number','ghin','Optional — for lookup']].map(([l2,k,ph]) => (
                  <div key={k}>
                    <label style={lbl}>{l2}</label>
                    <input style={inp} value={playerInfo[k]} onChange={e => setPlayerInfo({ ...playerInfo, [k]: e.target.value })} placeholder={ph} />
                  </div>
                ))}
              </div>
              <p style={{ fontSize: 11, color: C.textFaint, margin: '8px 0 0' }}>
                Handicap Index is a USGA/GHIN portable number (e.g. 4.2). Course Handicap is auto-calculated when a course is loaded.
              </p>
            </details>

            {/* Shot profile section - collapsible */}
            <details open style={{ marginBottom: 14 }}>
              <summary style={{ padding: '8px 0', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, listStyle: 'none', WebkitAppearance: 'none', borderBottom: `1px solid ${C.border}`, paddingBottom: 10, marginBottom: 10 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>Shot Profile</span>
                <span style={{ fontSize: 11, color: C.textMuted }}>{playerInfo.handedness || 'Right'}-handed · {playerInfo.ballFlight}</span>
              </summary>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: 10 }}>
                <div>
                  <label style={lbl}>Handedness</label>
                  <select style={inp} value={playerInfo.handedness || 'Right'} onChange={e => setPlayerInfo({ ...playerInfo, handedness: e.target.value })}>
                    {['Right','Left'].map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl}>Typical miss</label>
                  <select style={inp} value={playerInfo.miss} onChange={e => setPlayerInfo({ ...playerInfo, miss: e.target.value })}>
                    {['Left','Right','Both (fade misses right under pressure)','Low and left','Thin / right'].map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl}>Ball flight</label>
                  <select style={inp} value={playerInfo.ballFlight} onChange={e => setPlayerInfo({ ...playerInfo, ballFlight: e.target.value })}>
                    {['Fade','Draw','Straight','Slight fade','Slight draw'].map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
              </div>
            </details>

            {/* Goals & strengths section - collapsible */}
            <details open={!isMobile}>
              <summary style={{ padding: '8px 0', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, listStyle: 'none', WebkitAppearance: 'none', borderBottom: `1px solid ${C.border}`, paddingBottom: 10, marginBottom: 10 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>Goals, Strengths & Notes</span>
                <span style={{ fontSize: 11, color: C.textMuted }}>Fed directly into AI strategy</span>
              </summary>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={lbl}>Goals</label>
                  <textarea style={{ ...inp, height: 68, resize: 'vertical' }} value={playerInfo.goals || ''}
                    onChange={e => setPlayerInfo({ ...playerInfo, goals: e.target.value })}
                    placeholder="e.g. Stop leaking shots on par 3s, hold my game together on back 9 in tournaments..." />
                </div>
                <div>
                  <label style={lbl}>Strengths</label>
                  <textarea style={{ ...inp, height: 68, resize: 'vertical' }} value={playerInfo.strengths || ''}
                    onChange={e => setPlayerInfo({ ...playerInfo, strengths: e.target.value })}
                    placeholder="e.g. Reliable iron player, strong lag putter, good SW from 80y..." />
                </div>
              </div>
              <div style={{ marginTop: 10 }}>
                <label style={lbl}>Swing notes</label>
                <textarea style={{ ...inp, height: 56, resize: 'vertical' }} value={playerInfo.swingNotes}
                  onChange={e => setPlayerInfo({ ...playerInfo, swingNotes: e.target.value })}
                  placeholder="e.g. Gets steep under pressure, slight over-the-top move, left miss when tired on driver..." />
              </div>
            </details>
          </div>
        </div>
      )}

      {/* ── Club Distances sub-tab ── */}
      {playerSubTab === 'clubs' && (
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, flexWrap: 'wrap', gap: 8 }}>
            <p style={{ ...lbl, margin: 0 }}>Club distances</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: C.textFaint }}>Saved automatically</span>
              <button style={{ ...btnG, fontSize: 11, padding: '4px 10px' }}
                onClick={() => setClubs(c => [...c, { club: 'New club', carry: '', shape: 'Straight' }])}>
                + Add club
              </button>
              <button style={{ ...btnG, fontSize: 11, padding: '4px 10px' }}
                onClick={() => { if (window.confirm('Reset bag to defaults?')) { setClubs(DEFAULT_CLUBS); setExpandedClubs({}) } }}>
                Reset
              </button>
            </div>
          </div>
          {isMobile ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
              {clubs.map((c, i) => (
                <details key={i} style={{ background: C.bgInput, border: `1px solid ${C.border}`, borderRadius: 8 }}>
                  <summary style={{ padding: '10px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', listStyle: 'none', WebkitAppearance: 'none' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 13, fontWeight: 500, color: C.text }}>{c.club}</span>
                      <span style={{ fontSize: 12, color: C.accent, fontWeight: 600 }}>{c.carry}y</span>
                      <span style={{ fontSize: 11, color: C.textFaint }}>{c.shape}</span>
                    </div>
                    <button onClick={e => { e.preventDefault(); setClubs(clubs.filter((_, j) => j !== i)) }}
                      style={{ background: 'none', border: 'none', color: C.textFaint, cursor: 'pointer', fontSize: 15, padding: 0 }}>×</button>
                  </summary>
                  <div style={{ padding: '8px 12px 12px', borderTop: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <input style={{ ...inp, padding: '6px 10px', fontSize: 13 }} value={c.club} placeholder="Club name"
                      onChange={e => setClubs(clubs.map((cl, j) => j === i ? { ...cl, club: e.target.value } : cl))} />
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input type="number" style={{ ...inp, padding: '6px 10px', fontSize: 13, flex: 1 }} value={c.carry} placeholder="Carry (yds)"
                        onChange={e => setClubs(clubs.map((cl, j) => j === i ? { ...cl, carry: e.target.value } : cl))} />
                      <select style={{ ...inp, padding: '6px 10px', fontSize: 13, flex: 1 }} value={c.shape}
                        onChange={e => setClubs(clubs.map((cl, j) => j === i ? { ...cl, shape: e.target.value } : cl))}>
                        {['Fade','Draw','Straight','Slight fade','Slight draw'].map(s => <option key={s}>{s}</option>)}
                      </select>
                    </div>
                  </div>
                </details>
              ))}
            </div>
          ) : (<>
          <div style={{ display: 'grid', gridTemplateColumns: '24px 2fr 1fr 1.5fr 24px', gap: '5px 10px', marginBottom: 6, marginTop: 12 }}>
            {['','Club','Carry (yds)','Shot shape',''].map((h, i) => <span key={i} style={{ fontSize: 10, color: C.textFaint, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{h}</span>)}
          </div>
          {clubs.map((c, i) => {
            const isOpen = !!expandedClubs[i]
            const analyticsInp = { ...inp, padding: '4px 6px', fontSize: 12 }
            return (
              <div key={i} style={{ marginBottom: 4 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '24px 2fr 1fr 1.5fr 24px', gap: '4px 10px', alignItems: 'center' }}>
                  <button
                    onClick={() => setExpandedClubs(prev => ({ ...prev, [i]: !prev[i] }))}
                    style={{ background: 'none', border: 'none', color: C.textFaint, cursor: 'pointer', fontSize: 10, padding: 0, textAlign: 'center', transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}
                    title="Expand analytics"
                  >▼</button>
                  <input style={{ ...inp, padding: '5px 8px', fontSize: 13 }} value={c.club}
                    onChange={e => setClubs(clubs.map((cl, j) => j === i ? { ...cl, club: e.target.value } : cl))} />
                  <input type="number" style={{ ...inp, textAlign: 'center', padding: '5px 8px' }} value={c.carry}
                    onChange={e => setClubs(clubs.map((cl, j) => j === i ? { ...cl, carry: e.target.value } : cl))} />
                  <select style={{ ...inp, padding: '5px 8px' }} value={c.shape}
                    onChange={e => setClubs(clubs.map((cl, j) => j === i ? { ...cl, shape: e.target.value } : cl))}>
                    {['Fade','Draw','Straight','Slight fade','Slight draw'].map(s => <option key={s}>{s}</option>)}
                  </select>
                  <button
                    onClick={() => { setClubs(clubs.filter((_, j) => j !== i)); setExpandedClubs(prev => { const n = {}; Object.keys(prev).forEach(k => { if (Number(k) < i) n[k] = prev[k]; else if (Number(k) > i) n[Number(k)-1] = prev[k] }); return n }) }}
                    style={{ background: 'none', border: 'none', color: C.textFaint, cursor: 'pointer', fontSize: 15, padding: 0, textAlign: 'center' }}
                    title="Remove club"
                  >×</button>
                </div>
                {isOpen && (
                  <div style={{ marginLeft: 34, marginTop: 4, marginBottom: 6, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: '4px 8px' }}>
                    {[
                      { key: 'ballSpeed',   label: 'Ball speed (mph)', placeholder: '158' },
                      { key: 'launchAngle', label: 'Launch angle (°)',  placeholder: '10.5' },
                      { key: 'spinRate',    label: 'Spin rate (rpm)',   placeholder: '2600' },
                      { key: 'dispLeft',    label: 'Left disp. (yd)',   placeholder: '12' },
                      { key: 'dispRight',   label: 'Right disp. (yd)', placeholder: '8' },
                    ].map(({ key, label, placeholder }) => (
                      <div key={key}>
                        <div style={{ fontSize: 9, color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 2 }}>{label}</div>
                        <input type="number" style={analyticsInp} placeholder={placeholder} value={c[key] || ''}
                          onChange={e => setClubs(clubs.map((cl, j) => j === i ? { ...cl, [key]: e.target.value } : cl))} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
          </>)}
        </div>
      )}

      {/* ── Data Import sub-tab ── */}
      {playerSubTab === 'import' && (
        <ImportTab clubs={clubs} setClubs={setClubs} C={C} card={card} inp={inp} lbl={lbl} btnP={btnP} btnG={btnG} />
      )}

      {/* ── Scoring History sub-tab ── */}
      {playerSubTab === 'scoring' && (
        <div>
          <div style={{ ...card, marginBottom: 12, borderColor: C.accentMuted }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
              <p style={{ fontSize: 13, color: C.textMuted, margin: 0, lineHeight: 1.6, maxWidth: 600 }}>
                Enter your most recent competitive and practice rounds. Claude identifies scoring patterns
                and adjusts today's target and strategy accordingly.
              </p>
              <button style={{ ...btnG, whiteSpace: 'nowrap', flexShrink: 0 }}
                onClick={() => setScoringHistory(h => [...h, { course: '', location: '', date: '', score: '', par: 72, toPar: '', roundType: 'Tournament', conditions: '', notes: '' }])}>
                + Add round
              </button>
            </div>

            {scoringHistory.length === 0 ? (
              <p style={{ fontSize: 12, color: C.textFaint, fontStyle: 'italic', textAlign: 'center', padding: '1rem 0' }}>
                No rounds yet — hit "+ Add round" to start tracking scoring history.
              </p>
            ) : isMobile ? (
              /* Mobile scoring history - same as before */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {scoringHistory.map((r, i) => {
                  const hs = historySearch[i] || {}
                  return (
                    <div key={i} style={{ background: C.bgInput, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px' }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                        <input style={{ ...inp, flex: 1, padding: '6px 10px', fontSize: 13 }} value={r.course}
                          onChange={e => setScoringHistory(h => h.map((rr, j) => j === i ? { ...rr, course: e.target.value } : rr))}
                          placeholder="Course name" />
                        <button style={{ background: 'transparent', border: 'none', color: C.textFaint, cursor: 'pointer', fontSize: 18, padding: '2px 6px', flexShrink: 0 }}
                          onClick={() => setScoringHistory(h => h.filter((_, j) => j !== i))} title="Remove">×</button>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 8px', marginBottom: 8 }}>
                        <div><label style={lbl}>City / State</label><input style={{ ...inp, padding: '5px 8px', fontSize: 12 }} value={r.location} onChange={e => setScoringHistory(h => h.map((rr, j) => j === i ? { ...rr, location: e.target.value } : rr))} placeholder="City, ST" /></div>
                        <div><label style={lbl}>Date</label><input type="date" style={{ ...inp, padding: '5px 8px', fontSize: 12 }} value={r.date} onChange={e => setScoringHistory(h => h.map((rr, j) => j === i ? { ...rr, date: e.target.value } : rr))} /></div>
                        <div><label style={lbl}>Score</label><input type="number" style={{ ...inp, padding: '5px 8px', fontSize: 12 }} value={r.score} onChange={e => { const score = e.target.value; setScoringHistory(h => h.map((rr, j) => j === i ? { ...rr, score, toPar: !rr.toPar || rr.toPar === toParStr(rr.score, rr.par || 72) ? toParStr(score, rr.par || 72) : rr.toPar } : rr)) }} placeholder="70" /></div>
                        <div><label style={lbl}>+/- vs par</label><input style={{ ...inp, padding: '5px 8px', fontSize: 12 }} value={r.toPar} onChange={e => setScoringHistory(h => h.map((rr, j) => j === i ? { ...rr, toPar: e.target.value } : rr))} placeholder="E" /></div>
                        <div><label style={lbl}>Round type</label><select style={{ ...inp, padding: '5px 6px', fontSize: 12 }} value={r.roundType || ''} onChange={e => setScoringHistory(h => h.map((rr, j) => j === i ? { ...rr, roundType: e.target.value } : rr))}><option value="">Type</option>{['Tournament','Qualifier','Stroke play','Match play','Practice round','Casual'].map(o => <option key={o}>{o}</option>)}</select></div>
                        <div><label style={lbl}>Conditions</label><select style={{ ...inp, padding: '5px 6px', fontSize: 12 }} value={r.conditions} onChange={e => setScoringHistory(h => h.map((rr, j) => j === i ? { ...rr, conditions: e.target.value } : rr))}><option value="">Conditions</option>{['Normal','Firm & fast','Soft','Windy','Hot & dry','Wet'].map(o => <option key={o}>{o}</option>)}</select></div>
                      </div>
                      <div style={{ marginBottom: 8 }}>
                        <label style={lbl}>Notes</label>
                        <input style={{ ...inp, padding: '5px 8px', fontSize: 12 }} value={r.notes} onChange={e => setScoringHistory(h => h.map((rr, j) => j === i ? { ...rr, notes: e.target.value } : rr))} placeholder="Drove it well, 3-putted twice..." />
                      </div>
                      {r.courseData ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 11, color: C.green }}>⛳ {r.courseData.name} linked</span>
                          <button style={{ background: 'none', border: 'none', color: C.red, fontSize: 10, cursor: 'pointer', padding: 0 }}
                            onClick={() => setScoringHistory(h => h.map((rr, j) => j === i ? { ...rr, courseData: null } : rr))}>remove</button>
                        </div>
                      ) : (
                        <div>
                          {!hs.open ? (
                            <button style={{ ...btnG, fontSize: 10, padding: '4px 10px' }} onClick={() => updateHS(i, { open: true, query: r.course || '', results: [], error: '' })}>+ Link scorecard</button>
                          ) : (
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                              <input style={{ ...inp, fontSize: 12, padding: '3px 8px', flex: 1, minWidth: 120 }} placeholder="Search course name..." value={hs.query || ''} onChange={e => updateHS(i, { query: e.target.value })} onKeyDown={e => e.key === 'Enter' && historySearchCourse(i, hs.query)} />
                              <button style={{ ...btnP, fontSize: 11, padding: '4px 12px' }} onClick={() => historySearchCourse(i, hs.query)}>{hs.loading ? '...' : 'Search'}</button>
                              <button style={{ ...btnG, fontSize: 10, padding: '3px 8px' }} onClick={() => updateHS(i, { open: false })}>Cancel</button>
                              {hs.error && <span style={{ fontSize: 11, color: C.red }}>{hs.error}</span>}
                            </div>
                          )}
                          {(hs.results || []).length > 0 && (
                            <div style={{ marginTop: 4, background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 6, overflow: 'hidden' }}>
                              {hs.results.slice(0, 5).map((r2, k) => (
                                <button key={k} style={{ display: 'block', width: '100%', background: 'none', border: 'none', borderBottom: `1px solid ${C.border}`, color: C.text, textAlign: 'left', padding: '8px 10px', fontSize: 12, cursor: 'pointer', fontFamily: F }}
                                  onClick={() => attachCourseToRound(i, r2)}>
                                  {r2.course_name || r2.name} {r2.location ? `— ${r2.location}` : ''}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : (
              /* Desktop scoring history - same as before */
              <div style={{ overflowX: 'auto' }}>
                <div style={{ minWidth: 740 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '140px 90px 105px 46px 40px 40px 105px 105px 1fr 28px', gap: '4px 8px', marginBottom: 6 }}>
                    {['Course','City / State','Date','Score','Par','+/-','Round type','Conditions','Notes',''].map((h, i) =>
                      <span key={i} style={{ fontSize: 10, color: C.textFaint, letterSpacing: '0.07em', textTransform: 'uppercase' }}>{h}</span>
                    )}
                  </div>
                  {scoringHistory.map((r, i) => (
                    <div key={i} style={{ marginBottom: 6 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '140px 90px 105px 46px 40px 40px 105px 105px 1fr 28px', gap: '3px 8px', alignItems: 'center' }}>
                      <input style={{ ...inp, padding: '4px 8px', fontSize: 12 }} value={r.course} onChange={e => setScoringHistory(h => h.map((rr, j) => j === i ? { ...rr, course: e.target.value } : rr))} placeholder="Course name" />
                      <input style={{ ...inp, padding: '4px 8px', fontSize: 12 }} value={r.location} onChange={e => setScoringHistory(h => h.map((rr, j) => j === i ? { ...rr, location: e.target.value } : rr))} placeholder="City, ST" />
                      <input type="date" style={{ ...inp, padding: '4px 8px', fontSize: 12 }} value={r.date} onChange={e => setScoringHistory(h => h.map((rr, j) => j === i ? { ...rr, date: e.target.value } : rr))} />
                      <input type="number" style={{ ...inp, padding: '4px 6px', fontSize: 12, textAlign: 'center' }} value={r.score} onChange={e => { const score = e.target.value; setScoringHistory(h => h.map((rr, j) => j === i ? { ...rr, score, toPar: !rr.toPar || rr.toPar === toParStr(rr.score, rr.par || 72) ? toParStr(score, rr.par || 72) : rr.toPar } : rr)) }} placeholder="70" />
                      <input type="number" style={{ ...inp, padding: '4px 6px', fontSize: 12, textAlign: 'center' }} value={r.par ?? 72} onChange={e => { const par = Number(e.target.value) || 72; setScoringHistory(h => h.map((rr, j) => j === i ? { ...rr, par, toPar: rr.score ? toParStr(rr.score, par) : rr.toPar } : rr)) }} placeholder="72" />
                      <input style={{ ...inp, padding: '4px 6px', fontSize: 12, textAlign: 'center' }} value={r.toPar} onChange={e => setScoringHistory(h => h.map((rr, j) => j === i ? { ...rr, toPar: e.target.value } : rr))} placeholder="E" />
                      <select style={{ ...inp, padding: '4px 6px', fontSize: 12 }} value={r.roundType || ''} onChange={e => setScoringHistory(h => h.map((rr, j) => j === i ? { ...rr, roundType: e.target.value } : rr))}><option value="">Type</option>{['Tournament','Qualifier','Stroke play','Match play','Practice round','Casual'].map(o => <option key={o}>{o}</option>)}</select>
                      <select style={{ ...inp, padding: '4px 6px', fontSize: 12 }} value={r.conditions} onChange={e => setScoringHistory(h => h.map((rr, j) => j === i ? { ...rr, conditions: e.target.value } : rr))}><option value="">Conditions</option>{['Normal','Firm & fast','Soft','Windy','Hot & dry','Wet'].map(o => <option key={o}>{o}</option>)}</select>
                      <input style={{ ...inp, padding: '4px 8px', fontSize: 12 }} value={r.notes} onChange={e => setScoringHistory(h => h.map((rr, j) => j === i ? { ...rr, notes: e.target.value } : rr))} placeholder="Drove it well, 3-putted twice..." />
                      <button style={{ background: 'transparent', border: 'none', color: C.textFaint, cursor: 'pointer', fontSize: 16, padding: '2px 4px' }} onClick={() => setScoringHistory(h => h.filter((_, j) => j !== i))} title="Remove">×</button>
                    </div>
                    {(() => {
                      const hs = historySearch[i] || {}
                      return (
                        <div style={{ marginTop: 3, marginBottom: 2 }}>
                          {r.courseData ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 2 }}>
                              <span style={{ fontSize: 11, color: C.green }}>⛳ Scorecard linked: {r.courseData.name} ({r.courseData.holes?.length || 18} holes)</span>
                              <button style={{ background: 'none', border: 'none', color: C.red, fontSize: 10, cursor: 'pointer', padding: 0 }} onClick={() => setScoringHistory(h => h.map((rr, j) => j === i ? { ...rr, courseData: null } : rr))}>remove</button>
                            </div>
                          ) : (
                            <div>
                              {!hs.open ? (
                                <button style={{ ...btnG, fontSize: 10, padding: '2px 10px' }} onClick={() => updateHS(i, { open: true, query: r.course || '', results: [], error: '' })}>+ Link scorecard</button>
                              ) : (
                                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                                  <input style={{ ...inp, fontSize: 12, padding: '3px 8px', width: 220 }} placeholder="Search course name..." value={hs.query || ''} onChange={e => updateHS(i, { query: e.target.value })} onKeyDown={e => e.key === 'Enter' && historySearchCourse(i, hs.query)} />
                                  <button style={{ ...btnP, fontSize: 11, padding: '4px 12px' }} onClick={() => historySearchCourse(i, hs.query)}>{hs.loading ? '...' : 'Search'}</button>
                                  <button style={{ ...btnG, fontSize: 10, padding: '3px 8px' }} onClick={() => updateHS(i, { open: false })}>Cancel</button>
                                  {hs.error && <span style={{ fontSize: 11, color: C.red }}>{hs.error}</span>}
                                </div>
                              )}
                              {(hs.results || []).length > 0 && (
                                <div style={{ marginTop: 4, background: C.bgInput, border: `1px solid ${C.border}`, borderRadius: 6, overflow: 'hidden' }}>
                                  {hs.results.slice(0, 5).map((r2, k) => (
                                    <button key={k} style={{ display: 'block', width: '100%', background: 'none', border: 'none', borderBottom: `1px solid ${C.border}`, color: C.text, textAlign: 'left', padding: '6px 10px', fontSize: 12, cursor: 'pointer', fontFamily: F }}
                                      onClick={() => attachCourseToRound(i, r2)}>
                                      {r2.course_name || r2.name} {r2.location ? `— ${r2.location}` : ''}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })()}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Stats summary */}
          {scoringHistory.filter(r => r.score && r.toPar).length >= 2 && (() => {
            const valid  = scoringHistory.filter(r => r.score && r.toPar)
            const toNum  = r => r.toPar === 'E' ? 0 : parseFloat(r.toPar)
            const scores = valid.map(toNum).filter(n => !isNaN(n))
            if (scores.length < 2) return null
            const avg   = (scores.reduce((a,b)=>a+b,0)/scores.length).toFixed(1)
            const best  = Math.min(...scores)
            const worst = Math.max(...scores)
            const recent3 = scores.slice(-3), older3 = scores.slice(0,3)
            const trend = recent3.length>=2 && older3.length>=2
              ? recent3.reduce((a,b)=>a+b,0)/recent3.length < older3.reduce((a,b)=>a+b,0)/older3.length ? 'Improving' : 'Declining' : '—'
            const fmt  = n => n===0?'E':n>0?`+${n}`:String(n)
            const fmtF = n => n==null?'—':parseFloat(n)===0?'E':parseFloat(n)>0?`+${n}`:String(n)
            const avgOf = arr => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : null
            const tourNums = valid.filter(r=>r.roundType==='Tournament'||r.roundType==='Qualifier').map(toNum).filter(n=>!isNaN(n))
            const casNums  = valid.filter(r=>r.roundType==='Casual'||r.roundType==='Practice round').map(toNum).filter(n=>!isNaN(n))
            const statCard = (label, val, color, sub) => (
              <div key={label} style={{ background: C.bgInput, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 14px' }}>
                <p style={{ ...lbl, margin: '0 0 4px' }}>{label}</p>
                <p style={{ fontSize: 20, fontWeight: 600, color, margin: 0 }}>{val}</p>
                {sub && <p style={{ fontSize: 10, color: C.textFaint, margin: '3px 0 0' }}>{sub}</p>}
              </div>
            )
            return (
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10, marginBottom: 8 }}>
                  {statCard('Overall avg', fmtF(avg), C.text, `${scores.length} rounds`)}
                  {statCard('Best round',  fmt(best),  C.green)}
                  {statCard('Worst round', fmt(worst), worst>2?C.red:C.textMuted)}
                  {statCard('Recent trend', trend, trend==='Improving'?C.green:trend==='Declining'?C.amber:C.textMuted)}
                </div>
                {(tourNums.length>=1||casNums.length>=1) && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                    {tourNums.length>=1 && statCard('Tournament avg', fmtF(avgOf(tourNums)?.toFixed(1)), C.amber, `${tourNums.length} competitive rounds`)}
                    {casNums.length>=1  && statCard('Casual avg',     fmtF(avgOf(casNums)?.toFixed(1)),  C.textMuted, `${casNums.length} casual / practice rounds`)}
                  </div>
                )}
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}
