import React, { useState, useEffect } from 'react'

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
  header: {
    textAlign: 'center',
    marginBottom: 28,
  },
  title: { fontSize: 22, fontWeight: 700, color: '#f1f5f9', margin: '0 0 6px' },
  sub:   { fontSize: 13, color: '#64748b', margin: 0 },
  progress: {
    display: 'flex',
    gap: 6,
    marginBottom: 32,
    justifyContent: 'center',
  },
  dot: (active, done) => ({
    width: done ? 28 : active ? 28 : 8,
    height: 8,
    borderRadius: 4,
    background: done ? '#22c55e' : active ? '#3b82f6' : '#2a2f45',
    transition: 'all .25s',
  }),
  stepTitle: {
    fontSize: 17,
    fontWeight: 700,
    color: '#f1f5f9',
    marginBottom: 4,
  },
  stepSub: {
    fontSize: 13,
    color: '#64748b',
    marginBottom: 20,
  },
  label: {
    display: 'block',
    fontSize: 12,
    fontWeight: 600,
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: '.06em',
    marginBottom: 6,
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    background: '#141720',
    border: '1px solid #2a2f45',
    borderRadius: 8,
    color: '#f1f5f9',
    fontSize: 14,
    outline: 'none',
    marginBottom: 16,
    boxSizing: 'border-box',
  },
  select: {
    width: '100%',
    padding: '10px 12px',
    background: '#141720',
    border: '1px solid #2a2f45',
    borderRadius: 8,
    color: '#f1f5f9',
    fontSize: 14,
    outline: 'none',
    marginBottom: 16,
    boxSizing: 'border-box',
  },
  textarea: {
    width: '100%',
    padding: '10px 12px',
    background: '#141720',
    border: '1px solid #2a2f45',
    borderRadius: 8,
    color: '#f1f5f9',
    fontSize: 14,
    outline: 'none',
    marginBottom: 16,
    boxSizing: 'border-box',
    resize: 'vertical',
    minHeight: 72,
    fontFamily: 'inherit',
  },
  grid2: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
    gap: 12,
    marginBottom: 4,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
    padding: '6px 8px',
    background: '#141720',
    borderRadius: 8,
    border: '1px solid #2a2f45',
  },
  clubInput: (width) => ({
    background: 'transparent',
    border: 'none',
    color: '#f1f5f9',
    fontSize: 13,
    width,
    outline: 'none',
    padding: '2px 4px',
  }),
  clubSelect: {
    background: 'transparent',
    border: 'none',
    color: '#94a3b8',
    fontSize: 12,
    outline: 'none',
    cursor: 'pointer',
  },
  footer: {
    display: 'flex',
    gap: 10,
    marginTop: 28,
  },
  btnP: {
    flex: 1,
    padding: '11px 0',
    borderRadius: 8,
    border: 'none',
    cursor: 'pointer',
    fontSize: 15,
    fontWeight: 600,
    background: '#3b82f6',
    color: '#fff',
    transition: 'opacity .15s',
  },
  btnG: {
    flex: 1,
    padding: '11px 0',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 500,
    background: 'transparent',
    border: '1px solid #2a2f45',
    color: '#94a3b8',
  },
}

const TOTAL_STEPS = 3

export default function OnboardingScreen({ onComplete }) {
  const isMobile = useIsMobile()
  const [step, setStep] = useState(0)

  // Step 0 — Player profile
  const [name,        setName]        = useState('')
  const [handicap,    setHandicap]    = useState('')
  const [ghin,        setGhin]        = useState('')
  const [miss,        setMiss]        = useState('Right')
  const [ballFlight,  setBallFlight]  = useState('Mid')
  const [goals,       setGoals]       = useState('')
  const [strengths,   setStrengths]   = useState('')
  const [swingNotes,  setSwingNotes]  = useState('')

  // Step 1 — Bag setup
  const [clubs, setClubs] = useState(DEFAULT_CLUBS.map(c => ({ ...c })))

  // Step 2 — API keys (optional)
  const [golfApiKey, setGolfApiKey] = useState('')

  function updateClub(idx, field, val) {
    setClubs(prev => prev.map((c, i) => i === idx ? { ...c, [field]: val } : c))
  }
  function removeClub(idx) {
    setClubs(prev => prev.filter((_, i) => i !== idx))
  }
  function addClub() {
    setClubs(prev => [...prev, { club: 'New club', carry: '', shape: 'Straight' }])
  }

  function handleFinish() {
    const player = {
      name:        name.trim() || 'Player',
      handicap:    handicap || '',
      ghin:        ghin || '',
      miss,
      ballFlight,
      goals:       goals.trim(),
      strengths:   strengths.trim(),
      swingNotes:  swingNotes.trim(),
    }
    onComplete({ player, clubs, golfApiKey: golfApiKey.trim() })
  }

  const cardStyle = isMobile
    ? { ...S.card, padding: '24px 16px', borderRadius: 12 }
    : S.card

  return (
    <div style={S.wrap}>
      <div style={cardStyle}>
        <div style={S.header}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>⛳</div>
          <h2 style={S.title}>Welcome! Let's set you up.</h2>
          <p style={S.sub}>Takes about 2 minutes. You can edit everything later.</p>
        </div>

        {/* Progress indicator */}
        <div style={S.progress}>
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <div key={i} style={S.dot(i === step, i < step)} />
          ))}
        </div>

        {/* ── Step 0: Player info ── */}
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

            <div style={S.grid2}>
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
            <div style={S.stepSub}>Enter carry distances for best AI club recommendations</div>

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

        {/* ── Step 2: API key ── */}
        {step === 2 && (
          <div>
            <div style={S.stepTitle}>GolfCourse API key (optional)</div>
            <div style={S.stepSub}>Enables real course lookup with tee distances, par, and hole data. Leave blank to use the app's shared key.</div>

            <label style={S.label}>GolfCourseAPI key</label>
            <input
              style={S.input}
              type="password"
              placeholder="Paste your key or leave blank"
              value={golfApiKey}
              onChange={e => setGolfApiKey(e.target.value)}
            />

            <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.6 }}>
              Get a free key at <span style={{ color: '#60a5fa' }}>golfcourseapi.com</span>. Without it, course data falls back to AI search (less accurate).
              <br /><br />
              You can add or update this any time in the <strong style={{ color: '#94a3b8' }}>Admin</strong> tab.
            </div>
          </div>
        )}

        {/* Footer navigation */}
        <div style={S.footer}>
          {step > 0 && (
            <button style={S.btnG} onClick={() => setStep(s => s - 1)}>← Back</button>
          )}
          {step < TOTAL_STEPS - 1 ? (
            <button style={S.btnP} onClick={() => setStep(s => s + 1)}>Next →</button>
          ) : (
            <button style={S.btnP} onClick={handleFinish}>Start using GSE ⛳</button>
          )}
        </div>
      </div>
    </div>
  )
}
