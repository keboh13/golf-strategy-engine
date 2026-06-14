export const C = {
  bg: '#0f1117', bgCard: '#16181f', bgInput: '#1c1f28',
  border: '#2a2d3a', borderHover: '#3e4255',
  accent: '#818cf8', accentDim: '#4f52a0', accentMuted: '#1e2040',
  amber: '#f59e0b', amberMuted: '#2d1f08',
  blue: '#38bdf8', blueMuted: '#0c2a3d',
  red: '#f87171', redMuted: '#3a1515',
  green: '#34d399', greenMuted: '#064e3b',
  text: '#e4e6f0', textMuted: '#8b8fa8', textFaint: '#44475a',
}

export const F = "'Inter', 'Helvetica Neue', sans-serif"

export const card = { background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 12, padding: '1.1rem 1.4rem' }
export const inp  = { background: C.bgInput, border: `1px solid ${C.border}`, borderRadius: 7, color: C.text, padding: '7px 11px', fontSize: 13, fontFamily: F, outline: 'none', width: '100%', boxSizing: 'border-box' }
export const lbl  = { fontSize: 10, fontWeight: 600, letterSpacing: '0.09em', textTransform: 'uppercase', color: C.textMuted, display: 'block', marginBottom: 5 }
export const btnP = { background: C.accent, color: '#0f1117', border: 'none', borderRadius: 8, padding: '9px 20px', fontSize: 13, fontWeight: 600, fontFamily: F, cursor: 'pointer' }
export const btnG = { background: 'transparent', color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: 7, padding: '7px 15px', fontSize: 12, fontFamily: F, cursor: 'pointer' }
