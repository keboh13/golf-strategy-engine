import React, { useState, useEffect } from 'react'
import { parseScorePaste } from '../lib/scoreImport.js'

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 640)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)')
    const handler = (e) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return isMobile
}

// Default 14-club bag the user can adjust on Step 2 (or skip). Carry blanks
// are intentional — the user is supposed to fill in their own. The promptly-
// imported plan still works with blanks; the AI just uses the club ladder.
const DEFAULT_CLUBS = [
  { club: 'Driver',  carry: '', shape: 'Straight' },
  { club: '3-wood',  carry: '', shape: 'Straight' },
  { club: '5-wood',  carry: '', shape: 'Straight' },
  { club: '4-iron',  carry: '', shape: 'Straight' },
  { club: '5-iron',  carry: '', shape: 'Straight' },
  { club: '6-iron',  carry: '', shape: 'Straight' },
  { club: '7-iron',  carry: '', shape: 'Straight' },
  { club: '8-iron',  carry: '', shape: 'Straight' },
  { club: '9-iron',  carry: '', shape: 'Straight' },
  { club: 'PW',      carry: '', shape: 'Straight' },
  { club: 'GW',      carry: '', shape: 'Straight' },
  { club: 'SW',      carry: '', shape: 'Straight' },
  { club: 'LW',      carry: '', shape: 'Straight' },
]

const SHAPES = ['Draw', 'Straight', 'Fade']
const MISS   = ['Left', 'Right', 'Short', 'Long', 'Pull', 'Push']
const BALL   = ['High', 'Mid', 'Low']

const S = {
  wrap: {
    minHeight: '100dvh',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    background: 'linear-gradient(135deg,#0f1117 0%,#1a1f2e 100%)',
    padding: '32px 16px 48px',
    fontFamily: 'Inter,system-ui,sans-serif',
  },
  card: {
    background: '#1e2130',
    border: '1px solid #2a2f45',
    borderRadius: 16,
    padding: '36px 32px',
    width: '100%',
    maxWidth: 560,
    boxShadow: '0 24px 64px rgba(0,0,0,.45)',
  },
  header: { textAlign: 'center', marginBottom: 28 },
  title: { fontSize: 22, fontWeight: 700, color: '#f1f5f9', margin: '0 0 6px' },
  sub:   { fontSize: 13, color: '#64748b', margin: 0 },
  progress: { display: 'flex', gap: 6, marginBottom: 32, justifyContent: 'center' },
  dot: (active, done) => ({
    width: done ? 28 : active ? 28 : 8,
    height: 8,
    borderRadius: 4,
    background: done ? '#22c55e' : active ? '#3b82f6' : '#2a2f45',
    transition: 'all .25s',
  }),
  stepTitle: { fontSize: 17, fontWeight: 700, color: '#f1f5f9', marginBottom: 4 },
  stepSub:   { fontSize: 13, color: '#64748b', marginBottom: 20 },
  label: {
    display: 'block', fontSize: 12, fontWeight: 600,
    color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.06em',
    marginBottom: 6,
  },
  input: {
    width: '100%', padding: '10px 12px',
    background: '#141720', border: '1px solid #2a2f45', borderRadius: 8,
    color: '#f1f5f9', fontSize: 14, outline: 'none',
    marginBottom: 16, boxSizing: 'border-box',
  },
  select: {
    width: '100%', padding: '10px 12px',
    background: '#141720', border: '1px solid #2a2f45', borderRadius: 8,
    color: '#f1f5f9', fontSize: 14, outline: 'none',
    marginBottom: 16, boxSizing: 'border-box',
  },
  textarea: {
    width: '100%', padding: '10px 12px',
    background: '#141720', border: '1px solid #2a2f45', borderRadius: 8,
    color: '#f1f5f9', fontSize: 14, outline: 'none',
    marginBottom: 16, boxSizing: 'border-box',
    resize: 'vertical', minHeight: 72, fontFamily: 'inherit',
  },
  grid2: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
    gap: 12, marginBottom: 4,
  },
  row: {
    display: 'flex', alignItems: 'center', gap: 8,
    marginBottom: 6, padding: '6px 8px',
    background: '#141720', borderRadius: 8, border: '1px solid #2a2f45',
  },
  clubInput: (width) => ({
    background: 'transparent', border: 'none',
    color: '#f1f5f9', fontSize: 13, width, outline: 'none', padding: '2px 4px',
  }),
  clubSelect: {
    background: 'transparent', border: 'none',
    color: '#94a3b8', fontSize: 12, outline: 'none', cursor: 'pointer',
  },
  footer: { display: 'flex', gap: 10, marginTop: 28 },
  btnP: {
    flex: 1, padding: '11px 0', borderRadius: 8, border: 'none',
    cursor: 'pointer', fontSize: 15, fontWeight: 600,
    background: '#3b82f6', color: '#fff', transition: 'opacity .15s',
  },
  btnG: {
    flex: 1, padding: '11px 0', borderRadius: 8, cursor: 'pointer',
    fontSize: 14, fontWeight: 500,
    background: 'transparent', border: '1px solid #2a2f45', color: '#94a3b8',
  },
  btnSkip: {
    background: 'transparent', border: 'none',
    color: '#475569', fontSize: 12, padding: '8px 0',
    cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3,
  },
}

const TOTAL_STEPS = 4

export default function OnboardingScreen({ onComplete }) {
  const isMobile = useIsMobile()
  const [step, setStep] = useState(0)

  // Step 0 — Identity
  const [name,        setName]        = useState('')
  const [handicap,    setHandicap]    = useState('')
  const [ghin,        setGhin]        = useState('')
  const [handedness,  setHandedness]  = useState('Right')
  const [miss,        setMiss]        = useState('Right')
  const [ballFlight,  setBallFlight]  = useState('Mid')
  const [goals,       setGoals]       = useState('')
  const [strengths,   setStrengths]   = useState('')
  const [swingNotes,  setSwingNotes]  = useState('')

  // Step 1 — Bag
  const [clubs, setClubs] = useState(DEFAULT_CLUBS.map(c => ({ ...c })))

  // Step 2 — Recent scoring (paste GHIN rows or freeform). Parsed on-the-fly
  // so the user sees how many rounds we successfully extracted before moving
  // on; we only push them to Supabase via onComplete.
  const [scorePaste, setScorePaste] = useState('')
  const [scoreError, setScoreError] = useState('')
  const [scoreParsed, setScoreParsed] = useState({ rounds: [], warnings: [] })

  useEffect(() => {
    if (!scorePaste.trim()) { setScoreParsed({ rounds: [], warnings: [] }); setScoreError(''); return }
    try {
      const r = parseScorePaste(scorePaste)
      setScoreParsed(r); setScoreError('')
    } catch (e) {
      setScoreParsed({ rounds: [], warnings: [] })
      setScoreError(e?.message || 'Could not parse any rounds.')
    }
  }, [scorePaste])

  function updateClub(idx, field, val) {
    setClubs(prev => prev.map((c, i) => i === idx ? { ...c, [field]: val } : c))
  }
  function removeClub(idx) {
    setClubs(prev => prev.filter((_, i) => i !== idx))
  }
  function addClub() {
    setClubs(prev => [...prev, { club: 'New club', carry: '', shape: 'Straight' }])
  }

  // Finish — caller passes:
  //   - player: identity blob
  //   - clubs: bag (may be unchanged from defaults)
  //   - rounds: scoring history rows parsed in Step 2 (possibly empty)
  //   - trySampleCourse: jump straight into Round Prep with a sample course
  function finish({ trySampleCourse = false } = {}) {
    const player = {
      name:        name.trim() || 'Player',
      handicap:    handicap || '',
      ghin:        ghin || '',
      handedness,
      miss,
      ballFlight,
      goals:       goals.trim(),
      strengths:   strengths.trim(),
      swingNotes:  swingNotes.trim(),
    }
    onComplete({
      player,
      clubs,
      rounds: scoreParsed.rounds,
      trySampleCourse,
    })
  }

  const cardStyle = isMobile
    ? { ...S.card, padding: '24px 16px', borderRadius: 12 }
    : S.card

  const isLast = step === TOTAL_STEPS - 1
  // Identity is the only required step — the rest of the wizard can be
  // skipped past with the Skip link in the footer.
  const canSkip = step > 0 && !isLast

  return (
    <div style={S.wrap}>
      <div style={cardStyle}>
        <div style={S.header}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>⛳</div>
          <h2 style={S.title}>Welcome! Let's set you up.</h2>
          <p style={S.sub}>Takes about 2 minutes. You can edit everything later.</p>
        </div>

        <div style={S.progress} role="progressbar" aria-valuenow={step + 1} aria-valuemin={1} aria-valuemax={TOTAL_STEPS} aria-label={`Step ${step + 1} of ${TOTAL_STEPS}`}>
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <div key={i} style={S.dot(i === step, i < step)} role="presentation" aria-hidden="true" />
          ))}
        </div>

        {/* ── Step 0: Identity ── */}
        {step === 0 && (
          <div>
            <div style={S.stepTitle}>Your player profile</div>
            <div style={S.stepSub}>Used to build personalized AI strategy briefs</div>

            <label style={S.label}>Your name</label>
            <input style={S.input} placeholder="e.g. Rachel" value={name} onChange={e => setName(e.target.value)} />

            <div style={S.grid2}>
              <div>
                <label style={S.label}>Handicap index</label>
                <input style={S.input} type="number" step="0.1" placeholder="e.g. 4.2" value={handicap} onChange={e => setHandicap(e.target.value)} />
              </div>
              <div>
                <label style={S.label}>GHIN # (optional)</label>
                <input style={S.input} placeholder="GHIN number" value={ghin} onChange={e => setGhin(e.target.value)} />
              </div>
            </div>

            <div style={{ ...S.grid2, gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
              <div>
                <label style={S.label}>Handedness</label>
                <select style={S.select} value={handedness} onChange={e => setHandedness(e.target.value)}>
                  <option value="Right">Right-handed</option>
                  <option value="Left">Left-handed</option>
                </select>
              </div>
              <div>
                <label style={S.label}>Primary miss</label>
                <select style={S.select} value={miss} onChange={e => setMiss(e.target.value)}>
                  {MISS.map(m => <option key={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label style={S.label}>Ball flight</label>
                <select style={S.select} value={ballFlight} onChange={e => setBallFlight(e.target.value)}>
                  {BALL.map(b => <option key={b}>{b}</option>)}
                </select>
              </div>
            </div>

            <label style={S.label}>Goals (optional)</label>
            <textarea style={S.textarea} placeholder="e.g. Break 80 consistently, improve GIR from 50% to 65%" value={goals} onChange={e => setGoals(e.target.value)} />

            <label style={S.label}>Strengths (optional)</label>
            <textarea style={S.textarea} placeholder="e.g. Strong iron play inside 150 yards, solid putting stats" value={strengths} onChange={e => setStrengths(e.target.value)} />

            <label style={S.label}>Swing notes / tendencies (optional)</label>
            <textarea style={S.textarea} placeholder="e.g. Steep takeaway, tend to over-rotate on driver, working on hip turn" value={swingNotes} onChange={e => setSwingNotes(e.target.value)} />
          </div>
        )}

        {/* ── Step 1: Bag ── */}
        {step === 1 && (
          <div>
            <div style={S.stepTitle}>Your bag</div>
            <div style={S.stepSub}>Enter carry distances for better AI club recommendations. You can skip this and add them later.</div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 100px 28px', gap: 4, padding: '0 8px 6px', borderBottom: '1px solid #2a2f45', marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: '#475569', fontWeight: 600 }}>CLUB</span>
              <span style={{ fontSize: 11, color: '#475569', fontWeight: 600 }}>CARRY (yd)</span>
              <span style={{ fontSize: 11, color: '#475569', fontWeight: 600 }}>SHAPE</span>
              <span />
            </div>

            {clubs.map((c, i) => (
              <div key={i} style={S.row}>
                <input
                  style={S.clubInput('100%')}
                  value={c.club}
                  onChange={e => updateClub(i, 'club', e.target.value)}
                  placeholder="Club name"
                />
                <input
                  style={{ ...S.clubInput(72), textAlign: 'center' }}
                  type="number"
                  value={c.carry}
                  onChange={e => updateClub(i, 'carry', e.target.value)}
                  placeholder="—"
                />
                <select style={S.clubSelect} value={c.shape} onChange={e => updateClub(i, 'shape', e.target.value)}>
                  {SHAPES.map(s => <option key={s}>{s}</option>)}
                </select>
                <button
                  onClick={() => removeClub(i)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569', fontSize: 16, lineHeight: 1, padding: 0, flexShrink: 0 }}
                  title="Remove"
                >×</button>
              </div>
            ))}

            <button
              onClick={addClub}
              style={{ ...S.btnG, width: 'auto', padding: '6px 14px', fontSize: 13, marginTop: 8 }}
            >+ Add club</button>
          </div>
        )}

        {/* ── Step 2: Recent scoring ── */}
        {step === 2 && (
          <div>
            <div style={S.stepTitle}>Recent rounds</div>
            <div style={S.stepSub}>
              Paste GHIN rows, a CSV/TSV, or one round per line ("2024-09-12 Pebble Beach 78 par 72"). Skip if you'd rather log them later.
            </div>

            <label style={S.label}>Paste rows</label>
            <textarea
              style={{ ...S.textarea, minHeight: 140 }}
              placeholder={"2024-08-12  Pebble Beach Golf Links  78\n2024-08-19  Spyglass Hill  82  par 72"}
              value={scorePaste}
              onChange={e => setScorePaste(e.target.value)}
            />
            {scoreError && (
              <div style={{ fontSize: 12, color: '#fca5a5', marginBottom: 12 }}>{scoreError}</div>
            )}
            {scoreParsed.rounds.length > 0 && (
              <div style={{ fontSize: 12, color: '#86efac', marginBottom: 12 }}>
                ✓ Parsed {scoreParsed.rounds.length} round{scoreParsed.rounds.length === 1 ? '' : 's'}
                {scoreParsed.warnings.length > 0 && (
                  <span style={{ color: '#fde68a', marginLeft: 8 }}>· {scoreParsed.warnings.length} warning{scoreParsed.warnings.length === 1 ? '' : 's'}</span>
                )}
              </div>
            )}
            <div style={{ fontSize: 12, color: '#475569', lineHeight: 1.6 }}>
              We use these rounds to spot scoring patterns and tailor the AI strategy. Adding even three or four sharpens the recommendations a lot.
            </div>
          </div>
        )}

        {/* ── Step 3: Try it now ── */}
        {step === 3 && (
          <div>
            <div style={S.stepTitle}>Try it now</div>
            <div style={S.stepSub}>
              We'll drop you straight into Round Prep with a sample course pre-loaded so you can see a full caddie brief in under a minute. Or finish here and start when you're ready.
            </div>

            <div style={{ background: '#141720', border: '1px solid #2a2f45', borderRadius: 10, padding: '16px 18px', marginBottom: 18 }}>
              <p style={{ margin: 0, fontSize: 13, color: '#e2e8f0', fontWeight: 600 }}>Sample course: Pebble Beach Golf Links</p>
              <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>
                If we have it cached, the scorecard auto-loads. Otherwise we'll land you on Step 1 of Round Prep so you can pick any course.
              </p>
            </div>

            <button
              style={{ ...S.btnP, marginBottom: 10 }}
              onClick={() => finish({ trySampleCourse: true })}
            >
              Generate a sample plan →
            </button>
            <button
              style={{ ...S.btnG, width: '100%', marginBottom: 10 }}
              onClick={() => finish()}
            >
              Finish — I'll start later
            </button>
            <button
              style={S.btnSkip}
              onClick={() => setStep(s => s - 1)}
            >
              ← Back
            </button>
          </div>
        )}

        {/* Footer navigation. The "Try it now" step renders its own CTAs above
            and skips this footer entirely. */}
        {!isLast && (
          <div>
            <div style={S.footer}>
              {step > 0 && (
                <button style={S.btnG} onClick={() => setStep(s => s - 1)}>← Back</button>
              )}
              <button style={S.btnP} onClick={() => setStep(s => s + 1)}>Next →</button>
            </div>
            {canSkip && (
              <div style={{ textAlign: 'center', marginTop: 10 }}>
                <button style={S.btnSkip} onClick={() => setStep(s => s + 1)}>Skip this step</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
