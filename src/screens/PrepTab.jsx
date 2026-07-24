import { rollupConfidence } from '../lib/recommendation/confidence.js'
import { validateCourseTotals } from '../lib/recommendation/courseValidation.js'
import { extractGreenForHole, mergeGreen } from '../lib/greenGeometry.js'
import { AVAILABLE_MODELS } from '../lib/appConstants.js'
import { C, F, card, inp, lbl, btnP, btnG } from '../theme.js'
import { Badge, Spin, SectionHead, DataAccuracyTier } from '../components/ui.jsx'
import ProgressTracker from '../components/ProgressTracker.jsx'
import PrepContextStrip from '../components/PrepContextStrip.jsx'
import { ENRICH_STEPS } from '../lib/enrichSteps.js'
import { GENERATION_STEPS } from '../lib/generationPhases.js'
import GreenView from '../components/GreenView.jsx'
import CourseHoleMap from '../components/CourseHoleMap.jsx'
import CourseSearch from '../components/CourseSearch.jsx'
import ScorecardPreview from '../components/ScorecardPreview.jsx'
import WeatherPanel from '../components/WeatherPanel.jsx'
import BriefRating from '../components/BriefRating.jsx'

const PREP_STEPS = [
  { num: 1, label: 'Select Course',    icon: '🔍' },
  { num: 2, label: 'Scorecard & Tees', icon: '📋' },
  { num: 3, label: 'Weather & Time',   icon: '🌤' },
  { num: 4, label: 'Generate Report',  icon: '⚡' },
]

export default function PrepTab({
  isMobile,
  session,
  user,
  lastRecLogId,
  prepStep, setPrepStep,
  course, setCourse,
  coords, setCoords,
  teeTime, setTeeTime,
  teeDate, setTeeDate,
  pace, setPace,
  timezone,
  weather, setWeather,
  weatherLoading, setWeatherLoading,
  plan, planLoading, planPhase, planError, planValidationBanner,
  planStyle, setPlanStyle,
  planView, setPlanView,
  enriching, enrichStatus,
  enrichProgress = { states: {}, startsAt: {}, endsAt: {}, errors: {} },
  genProgress    = { states: {}, startsAt: {}, endsAt: {}, errors: {} },
  selectedModel, setSelectedModel,
  copied,
  currentHole, setCurrentHole,
  holeScores, setScore,
  displayGeo,
  contributedHoleSet,
  clubs,
  parsedHoles,
  generate, cancelGenerate,
  copyPlan, printPlan,
  applyScorecard, resetPrep,
  courseSearchResetKey = 0,
  renderPlan,
  handleHoleContribution,
  setTab, setExpandedBrief,
}) {
  return (
    <div>
      <SectionHead title="Round Prep" sub="Set up your round step by step" />

      {/* Step indicator */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 20, overflowX: 'auto' }}>
        {PREP_STEPS.map((s, i) => {
          const isActive = prepStep === s.num
          const isDone = prepStep > s.num || (s.num === 1 && course.name) || (s.num === 2 && course.holes.some(h => h.yardage)) || (s.num === 3 && weather)
          const isClickable = s.num <= prepStep || isDone
          return (
            <div key={s.num} style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
              <button onClick={() => isClickable && setPrepStep(s.num)} style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                padding: isMobile ? '8px 4px' : '10px 12px', border: 'none', cursor: isClickable ? 'pointer' : 'default',
                background: 'transparent', fontFamily: F, flex: 1, minWidth: 0, opacity: isClickable ? 1 : 0.4,
              }}>
                <div style={{
                  width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 14, fontWeight: 600,
                  background: isActive ? C.accent : isDone ? C.greenMuted : C.bgInput,
                  color: isActive ? C.bg : isDone ? C.green : C.textMuted,
                  border: `2px solid ${isActive ? C.accent : isDone ? C.green : C.border}`,
                  transition: 'all 0.2s',
                }}>
                  {isDone && !isActive ? '✓' : s.num}
                </div>
                <span style={{ fontSize: isMobile ? 9 : 11, color: isActive ? C.text : C.textMuted, fontWeight: isActive ? 600 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
                  {isMobile ? s.label.split(' ')[0] : s.label}
                </span>
              </button>
              {i < PREP_STEPS.length - 1 && (
                <div style={{ width: isMobile ? 12 : 24, height: 2, background: isDone ? C.green : C.border, flexShrink: 0 }} />
              )}
            </div>
          )
        })}
      </div>

      {/* Step 1: Select Course */}
      {prepStep === 1 && (
        <div>
          <CourseSearch
            key={courseSearchResetKey}
            authToken={session?.access_token || ''}
            onSelect={(r) => { applyScorecard(r); setPrepStep(2) }}
            onBrowseLibrary={(q) => {
              // Navigate to Library tab; pass the query via a custom event so
              // LibraryTab can pre-fill its search box.
              if (q?.trim()) {
                window.dispatchEvent(new CustomEvent('library:search', { detail: q.trim() }))
              }
              setTab('library')
            }}
          />
          {course.name && (
            <div style={{ ...card, marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <p style={{ fontSize: 14, fontWeight: 600, color: C.text, margin: 0 }}>{course.name}</p>
                <p style={{ fontSize: 12, color: C.textMuted, margin: '2px 0 0' }}>{course.location} · Par {course.par} · {course.yardage ? Number(course.yardage).toLocaleString() + 'y' : ''}</p>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  style={btnG}
                  onClick={resetPrep}
                  aria-label="Clear selected course and start a new search"
                  title="Clear the loaded course and start over"
                >
                  Change course
                </button>
                <button style={btnP} onClick={() => setPrepStep(2)}>Continue →</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Step 2: Scorecard Preview, Tees & Course Details */}
      {prepStep === 2 && (
        <div>
          {course.name && course.osmEnriched && <DataAccuracyTier course={course} style={{ marginBottom: 12 }} />}
          {course.name && !course.osmEnriched && Object.keys(enrichProgress.states).length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <ProgressTracker
                steps={ENRICH_STEPS}
                states={enrichProgress.states}
                startsAt={enrichProgress.startsAt}
                endsAt={enrichProgress.endsAt}
                errors={enrichProgress.errors}
                compact
              />
            </div>
          )}
          {/* Tee selector — switch tees without going back */}
          {course.tees?.length > 1 && (
            <div style={{ ...card, marginBottom: 12 }}>
              <p style={{ ...lbl, marginBottom: 8 }}>Playing tees</p>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {course.tees.map((t, i) => {
                  const active = course.selectedTee === t.name
                  return (
                    <button key={i} onClick={() => {
                      setCourse(prev => ({
                        ...prev,
                        selectedTee: t.name,
                        yardage: String(t.yardage || prev.yardage),
                        rating: String(t.rating || prev.rating),
                        slope: String(t.slope || prev.slope),
                        par: t.par || prev.par,
                        holes: prev.holes.map((h, hi) => ({
                          ...h,
                          yardage: String(t.holes?.[hi]?.yardage || h.yardage || ''),
                          par: t.holes?.[hi]?.par || h.par,
                          handicap: t.holes?.[hi]?.handicap || h.handicap,
                        })),
                      }))
                    }} style={{
                      background: active ? C.accentMuted : C.bgInput,
                      border: `1px solid ${active ? C.accent : C.border}`,
                      borderRadius: 8, padding: '8px 14px', cursor: 'pointer',
                      fontFamily: F, transition: 'all 0.15s',
                    }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: active ? C.accent : C.text }}>{t.name}</span>
                      <span style={{ fontSize: 11, color: active ? C.accent : C.textMuted, marginLeft: 8 }}>{Number(t.yardage).toLocaleString()}y</span>
                      {t.rating && <span style={{ fontSize: 10, color: C.textFaint, marginLeft: 6 }}>{t.rating}/{t.slope}</span>}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
          <div style={{ ...card, marginBottom: 12 }}>
            <p style={{ ...lbl, marginBottom: 12 }}>Course details</p>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '2fr 1fr 1fr 1fr', gap: 10 }}>
              <div><label style={lbl}>Course name</label><input style={inp} value={course.name} onChange={e => setCourse({ ...course, name: e.target.value })} placeholder="e.g. Rhodes Ranch Golf Club" /></div>
              <div><label style={lbl}>City / State</label><input style={inp} value={course.location} onChange={e => setCourse({ ...course, location: e.target.value })} placeholder="Las Vegas, NV" /></div>
              <div><label style={lbl}>Total yardage</label><input style={inp} value={course.yardage} onChange={e => setCourse({ ...course, yardage: e.target.value })} placeholder="6582" /></div>
              <div><label style={lbl}>Rating / Slope</label><input style={inp} value={`${course.rating}${course.slope ? '/' + course.slope : ''}`} onChange={e => { const [r, s] = e.target.value.split('/'); setCourse({ ...course, rating: r?.trim(), slope: s?.trim() || course.slope }) }} placeholder="70.6 / 128" /></div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10, marginTop: 10 }}>
              <div><label style={lbl}>Conditions</label><select style={inp} value={course.conditions} onChange={e => setCourse({ ...course, conditions: e.target.value })}>{['Normal','Firm & fast','Soft','Wet','Dry & links-like'].map(o => <option key={o}>{o}</option>)}</select></div>
              <div><label style={lbl}>Round type</label><select style={inp} value={course.roundType} onChange={e => setCourse({ ...course, roundType: e.target.value })}>{['Stroke play tournament','Match play','Qualifier','Q School','Practice round','Casual round'].map(o => <option key={o}>{o}</option>)}</select></div>
              <div><label style={lbl}>Target score</label><input style={inp} value={course.targetScore} onChange={e => setCourse({ ...course, targetScore: e.target.value })} placeholder="-2 (69)" /></div>
              <div><label style={lbl}>Elevation (ft)</label><input style={inp} type="number" value={course.elevation} onChange={e => setCourse({ ...course, elevation: e.target.value })} placeholder="e.g. 4500" /></div>
            </div>
            <div style={{ marginTop: 10 }}>
              <label style={lbl}>General course notes</label>
              <textarea style={{ ...inp, height: 56, resize: 'vertical' }} value={course.notes} onChange={e => setCourse({ ...course, notes: e.target.value })} placeholder="Green speed, firmness, key local knowledge, previous experience..." />
            </div>
          </div>

          {course.holes && <ScorecardPreview holes={course.holes} />}

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
            <button style={btnG} onClick={() => setPrepStep(1)}>← Back</button>
            <button style={btnP} onClick={() => setPrepStep(3)}>Continue →</button>
          </div>
        </div>
      )}

      {/* Step 3: Weather & Tee Time */}
      {prepStep === 3 && (
        <div>
          <WeatherPanel
            authToken={session?.access_token || ''} course={course}
            coords={coords} setCoords={setCoords}
            teeTime={teeTime} setTeeTime={setTeeTime}
            teeDate={teeDate} setTeeDate={setTeeDate}
            pace={pace} setPace={setPace}
            timezone={timezone}
            weather={weather} setWeather={setWeather}
            weatherLoading={weatherLoading} setWeatherLoading={setWeatherLoading}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
            <button style={btnG} onClick={() => setPrepStep(2)}>← Back</button>
            <button style={btnP} onClick={() => setPrepStep(4)}>Continue →</button>
          </div>
        </div>
      )}

      {/* Step 4: Generate Report */}
      {prepStep === 4 && (
        <div>
          {/* Summary card before generation */}
          {!plan && !planLoading && (
            <div style={{ ...card, textAlign: 'center', padding: '2rem' }}>
              <div style={{ fontSize: 40, marginBottom: 14 }}>⚡</div>
              <h3 style={{ fontSize: 18, fontWeight: 600, color: C.text, margin: '0 0 8px' }}>Ready to generate your round prep report</h3>
              {course.name ? (
                <div style={{ marginBottom: 20 }}>
                  <p style={{ fontSize: 14, color: C.textMuted, margin: '0 0 4px' }}>{course.name} {course.selectedTee ? `(${course.selectedTee})` : ''}</p>
                  <p style={{ fontSize: 12, color: C.textFaint, margin: 0 }}>
                    Par {course.par} · {course.yardage ? Number(course.yardage).toLocaleString() + 'y' : ''} · {course.roundType}
                    {weather ? ' · Weather loaded' : ''}
                  </p>
                </div>
              ) : (
                <p style={{ fontSize: 14, color: C.textMuted, margin: '0 0 20px' }}>No course loaded — Claude will analyze your player profile and scoring patterns</p>
              )}

              {/* Model selector inline */}
              <div style={{ marginBottom: 20, textAlign: 'left', maxWidth: 500, margin: '0 auto 20px' }}>
                <p style={{ ...lbl, marginBottom: 8 }}>AI Model</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                  {AVAILABLE_MODELS.map(m => {
                    const active = selectedModel === m.id
                    return (
                      <button key={m.id} onClick={() => setSelectedModel(m.id)} style={{
                        background: active ? C.accentMuted : C.bgInput,
                        border: `1px solid ${active ? C.accent : C.border}`,
                        borderRadius: 8, padding: '8px 12px', cursor: 'pointer', textAlign: 'left',
                        fontFamily: F, transition: 'border-color .15s',
                      }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: active ? C.accent : C.text }}>{m.name}</span>
                        <span style={{ fontSize: 10, color: C.textFaint, marginLeft: 6 }}>{m.speed}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Plan style selector — balanced / conservative / aggressive */}
              {course.name && (
                <div style={{ marginBottom: 20, textAlign: 'left', maxWidth: 500, margin: '0 auto 20px' }}>
                  <p style={{ ...lbl, marginBottom: 8 }}>Strategy style</p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                    {[
                      { id: 'conservative', label: 'Conservative', desc: 'Safe pars' },
                      { id: 'balanced',     label: 'Balanced',     desc: 'Risk vs dispersion' },
                      { id: 'aggressive',   label: 'Aggressive',   desc: 'Attack birdies' },
                    ].map(s => {
                      const active = planStyle === s.id
                      return (
                        <button key={s.id} onClick={() => setPlanStyle(s.id)} style={{
                          background: active ? C.accentMuted : C.bgInput,
                          border: `1px solid ${active ? C.accent : C.border}`,
                          borderRadius: 8, padding: '8px 10px', cursor: 'pointer', textAlign: 'left',
                          fontFamily: F,
                        }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: active ? C.accent : C.text }}>{s.label}</div>
                          <div style={{ fontSize: 10, color: C.textFaint }}>{s.desc}</div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Course data quality preview */}
              {course.name && (() => {
                const issues = validateCourseTotals(course)
                const conf = rollupConfidence(course)
                const breakdown = Object.entries(conf.breakdown).map(([k, v]) => `${v} ${k.replace(/_/g, ' ')}`).join(', ')
                return (
                  <div style={{ background: issues.length ? '#3a2a1c' : C.bgInput, border: `1px solid ${issues.length ? C.amber : C.border}`, borderRadius: 8, padding: '8px 12px', marginBottom: 16, textAlign: 'left' }}>
                    <p style={{ fontSize: 11, color: C.textMuted, margin: 0 }}>
                      <strong style={{ color: issues.length ? C.amber : C.green }}>Data:</strong> {breakdown || 'no holes'}
                    </p>
                    {issues.length > 0 && (
                      <p style={{ fontSize: 11, color: C.amber, margin: '4px 0 0' }}>
                        {issues.length} validation issue{issues.length === 1 ? '' : 's'}: {issues.slice(0, 3).join(', ')}{issues.length > 3 ? '…' : ''}
                      </p>
                    )}
                  </div>
                )
              })()}

              {(enriching || Object.keys(enrichProgress.states).length > 0) && (
                <div style={{ marginBottom: 16 }}>
                  <ProgressTracker
                    steps={ENRICH_STEPS}
                    states={enrichProgress.states}
                    startsAt={enrichProgress.startsAt}
                    endsAt={enrichProgress.endsAt}
                    errors={enrichProgress.errors}
                  />
                </div>
              )}
              <button style={{ ...btnP, padding: '12px 32px', fontSize: 15 }} onClick={generate} aria-label="Generate round prep report">Generate Round Prep Report →</button>
            </div>
          )}

          {/* Loading / streaming state */}
          {planLoading && (
            <div style={{ ...card, padding: '2rem' }}>
              <div style={{ marginBottom: 16 }}>
                <ProgressTracker
                  steps={GENERATION_STEPS}
                  states={genProgress.states}
                  startsAt={genProgress.startsAt}
                  endsAt={genProgress.endsAt}
                  errors={genProgress.errors}
                  onCancel={cancelGenerate}
                  cancelLabel="Cancel generation"
                />
              </div>
              {plan && (
                <div style={{ textAlign: 'left' }}>
                  {renderPlan(plan)}
                  <span style={{ display: 'inline-block', width: 7, height: 15, background: C.accent, animation: 'blink 0.8s step-end infinite', marginLeft: 2, verticalAlign: 'middle' }} />
                </div>
              )}
            </div>
          )}

          {/* Completed plan display */}
          {plan && !planLoading && (<>
            {/* Success confirmation banner */}
            <div style={{ ...card, background: C.greenMuted, borderColor: C.green, marginBottom: 14, padding: '16px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <p style={{ fontSize: 15, fontWeight: 600, color: C.green, margin: '0 0 4px' }}>Report saved to history</p>
                  <p style={{ fontSize: 12, color: C.textMuted, margin: 0 }}>{course.name || 'Profile brief'} · {new Date().toLocaleDateString()}</p>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button style={btnP} onClick={() => { setExpandedBrief(0); setTab('history'); resetPrep() }}>View in History →</button>
                  <button style={{ ...btnG, background: C.green, color: '#fff', borderColor: C.green }} onClick={() => { resetPrep(); setTab('prep') }}>New Round Prep</button>
                </div>
              </div>
            </div>

            {/* In-flow rating — captures the reaction at the moment, not later */}
            <BriefRating user={user} recLogId={lastRecLogId} />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Badge label="Report Ready" bg={C.greenMuted} fg={C.green} />
                <span style={{ fontSize: 13, color: C.textMuted }}>{course.name || 'Profile brief'}</span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={btnG} onClick={copyPlan}>{copied ? '✓ Copied' : 'Copy text'}</button>
                <button style={btnG} onClick={printPlan}>Print / PDF</button>
                <button style={btnG} onClick={() => generate({ bypassCache: true })} title="Fetch a fresh brief (skip cache)">↺ Regenerate</button>
              </div>
            </div>

            {parsedHoles.holes.length > 0 && (
              <div style={{ display: 'flex', gap: 4, marginBottom: 12, background: C.bgInput, borderRadius: 8, padding: 3 }}>
                {[['companion', 'Round companion'], ['briefing', 'Full briefing']].map(([id, label]) => (
                  <button key={id} onClick={() => setPlanView(id)} style={{
                    flex: 1, padding: '8px 12px', fontSize: 12, fontWeight: 500, fontFamily: F,
                    border: 'none', borderRadius: 6, cursor: 'pointer',
                    background: planView === id ? C.accent : 'transparent',
                    color: planView === id ? C.bg : C.textMuted,
                  }}>{label}</button>
                ))}
              </div>
            )}

            {planView === 'companion' && parsedHoles.holes.length > 0 ? (
              <div
                onTouchStart={e => { e.currentTarget._swipeX = e.touches[0].clientX }}
                onTouchEnd={e => {
                  const dx = e.changedTouches[0].clientX - (e.currentTarget._swipeX || 0)
                  if (Math.abs(dx) > 60) {
                    if (dx < 0 && currentHole < parsedHoles.holes.length - 1) setCurrentHole(h => h + 1)
                    if (dx > 0 && currentHole > 0) setCurrentHole(h => h - 1)
                  }
                }}>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 12 }}>
                  {parsedHoles.holes.map((h, i) => (
                    <button key={h.num} onClick={() => setCurrentHole(i)} style={{
                      width: 36, height: 36, borderRadius: 8, border: `1px solid ${currentHole === i ? C.accent : C.border}`,
                      background: currentHole === i ? C.accentMuted : C.bgInput,
                      color: currentHole === i ? C.accent : C.textMuted,
                      fontSize: 13, fontWeight: 600, fontFamily: F, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>{h.num}</button>
                  ))}
                </div>
                {(() => {
                  const holesPlayed = parsedHoles.holes.filter(h => holeScores[h.num] != null)
                  if (!holesPlayed.length && !holeScores[parsedHoles.holes[currentHole]?.num]) return null
                  const totalStrokes = holesPlayed.reduce((sum, h) => sum + (holeScores[h.num] || 0), 0)
                  const totalPar = holesPlayed.reduce((sum, h) => { const m = h.content.match(/Par\s+(\d)/i); return sum + (m ? parseInt(m[1]) : 4) }, 0)
                  const diff = totalStrokes - totalPar
                  return (
                    <div style={{ background: C.bgInput, borderRadius: 8, padding: '8px 14px', marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: diff <= 0 ? C.green : diff <= 3 ? C.amber : C.red }}>
                        {diff === 0 ? 'E' : diff > 0 ? `+${diff}` : diff} thru {holesPlayed.length}
                      </span>
                      <span style={{ fontSize: 11, color: C.textMuted }}>Strokes: {totalStrokes} · Par: {totalPar}</span>
                    </div>
                  )
                })()}
                <div style={card}>
                  {currentHole === 0 && parsedHoles.preamble && <div style={{ marginBottom: 16, paddingBottom: 12, borderBottom: `1px solid ${C.border}` }}>{renderPlan(parsedHoles.preamble)}</div>}
                  {renderPlan(parsedHoles.holes[currentHole]?.content || '')}
                  {(() => {
                    const num = parsedHoles.holes[currentHole]?.num
                    if (num == null || !coords?.lat) return null
                    return (
                      <CourseHoleMap
                        courseName={course.name}
                        coords={coords}
                        geojson={displayGeo.geojson}
                        bboxByHole={displayGeo.bboxByHole}
                        coverage={course?.coverage}
                        tier={course?.tier}
                        clubs={clubs}
                        holes={parsedHoles.holes}
                        extraHazardsByHole={(() => {
                          const out = {}
                          for (const h of (course?.holes || [])) {
                            if (h?.hzDesign?.hazards?.length) out[h.ref || h.num] = h.hzDesign
                          }
                          return out
                        })()}
                        hazardMappedHoles={course?.hazardsLoaded ? new Set(
                          (course?.holes || []).filter(h => h?.hzDesign).map(h => h.ref || h.num)
                        ) : undefined}
                        selectedHole={num}
                        onSelectHole={(n) => {
                          const idx = parsedHoles.holes.findIndex(h => h.num === n)
                          if (idx >= 0) setCurrentHole(idx)
                        }}
                        onContribute={handleHoleContribution}
                        contributedHoles={contributedHoleSet}
                      />
                    )
                  })()}
                  {(() => {
                    const h = parsedHoles.holes[currentHole]
                    if (!h?.num) return null
                    const osmGreen = extractGreenForHole(displayGeo.geojson, h.num)
                    return <GreenView green={mergeGreen(h.green, osmGreen)} holeNum={h.num} />
                  })()}
                  {(() => {
                    const hNum = parsedHoles.holes[currentHole]?.num; if (!hNum) return null
                    const parMatch = (parsedHoles.holes[currentHole]?.content || '').match(/Par\s+(\d)/i)
                    const par = parMatch ? parseInt(parMatch[1]) : 4; const score = holeScores[hNum]
                    return (
                      <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 12, paddingTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 12, color: C.textMuted, fontWeight: 500 }}>Score (par {par})</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <button onClick={() => setScore(hNum, (score || par) - 1)} style={{ width: 32, height: 32, borderRadius: 8, border: `1px solid ${C.border}`, background: C.bgInput, color: C.text, fontSize: 16, fontFamily: F, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                          <span style={{ width: 36, textAlign: 'center', fontSize: 18, fontWeight: 700, fontFamily: F, color: score == null ? C.textFaint : score < par ? C.green : score === par ? C.text : score === par + 1 ? C.amber : C.red }}>{score ?? '–'}</span>
                          <button onClick={() => setScore(hNum, (score || par) + 1)} style={{ width: 32, height: 32, borderRadius: 8, border: `1px solid ${C.border}`, background: C.bgInput, color: C.text, fontSize: 16, fontFamily: F, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                          {score != null && <span style={{ fontSize: 11, color: score < par ? C.green : score === par ? C.textMuted : C.red, minWidth: 40 }}>{score < par ? `${score - par}` : score === par ? 'Par' : `+${score - par}`}</span>}
                        </div>
                      </div>
                    )
                  })()}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, gap: 8 }}>
                  <button style={{ ...btnG, flex: 1, opacity: currentHole === 0 ? 0.4 : 1, textAlign: 'center' }} disabled={currentHole === 0} onClick={() => setCurrentHole(h => Math.max(0, h - 1))}>← Hole {parsedHoles.holes[currentHole - 1]?.num || ''}</button>
                  <button style={{ ...btnG, flex: 1, opacity: currentHole >= parsedHoles.holes.length - 1 ? 0.4 : 1, textAlign: 'center' }} disabled={currentHole >= parsedHoles.holes.length - 1} onClick={() => setCurrentHole(h => Math.min(parsedHoles.holes.length - 1, h + 1))}>Hole {parsedHoles.holes[currentHole + 1]?.num || ''} →</button>
                </div>
                {parsedHoles.postamble.trim() && <div style={{ ...card, marginTop: 12 }}>{renderPlan(parsedHoles.postamble)}</div>}
              </div>
            ) : parsedHoles.holes.length > 0 ? (
              <div>
                {parsedHoles.preamble.trim() && <div style={{ ...card, marginBottom: 12 }}>{renderPlan(parsedHoles.preamble)}</div>}
                {parsedHoles.holes.map((h) => {
                  const osmGreen = extractGreenForHole(displayGeo.geojson, h.num)
                  return (
                    <div key={h.num} style={{ ...card, marginBottom: 12 }}>
                      {renderPlan(h.content)}
                      <GreenView green={mergeGreen(h.green, osmGreen)} holeNum={h.num} />
                    </div>
                  )
                })}
                {parsedHoles.postamble.trim() && <div style={{ ...card, marginTop: 0 }}>{renderPlan(parsedHoles.postamble)}</div>}
              </div>
            ) : (
              <div style={card}>
                {renderPlan(plan)}
              </div>
            )}
          </>)}

          {planError && (
            <div style={{ ...card, borderColor: C.red, marginTop: 12 }}>
              <p style={{ color: C.red, fontSize: 13, margin: 0 }}>⚠ {planError}</p>
            </div>
          )}

          {planValidationBanner && (
            <div style={{ ...card, borderColor: C.amber, marginTop: 12 }}>
              <p style={{ color: C.amber, fontSize: 13, margin: '0 0 8px', fontWeight: 600 }}>⚠ {planValidationBanner}</p>
              <button style={{ ...btnP, padding: '6px 14px', fontSize: 12 }} onClick={() => generate({ bypassCache: true })}>
                Regenerate
              </button>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: 16 }}>
            <button style={btnG} onClick={() => setPrepStep(3)}>← Back</button>
          </div>
        </div>
      )}

      {/* Persistent context strip (Part 1.2) — visible across every Prep step. */}
      <PrepContextStrip
        course={course}
        coords={coords}
        teeTime={teeTime}
        teeDate={teeDate}
        weather={weather}
        prepStep={prepStep}
        setPrepStep={setPrepStep}
      />
    </div>
  )
}
