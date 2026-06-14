import { C } from '../theme.js'

export default function ScorecardPreview({ holes }) {
  if (!holes || holes.length < 18) return null
  const front = holes.slice(0, 9)
  const back  = holes.slice(9, 18)
  const row = (label, fn, color = C.textMuted) => (
    <tr>
      <td style={{ color: C.textFaint, padding: '3px 4px', fontSize: 10 }}>{label}</td>
      {front.map((h, i) => <td key={i} style={{ color, padding: '3px 4px', textAlign: 'center', fontSize: 11 }}>{fn(h)}</td>)}
      <td style={{ color, padding: '3px 4px', textAlign: 'center', fontSize: 11, fontWeight: 600 }}>
        {front.reduce((s, h) => s + (Number(fn(h)) || 0), 0) || ''}
      </td>
      {back.map((h, i) => <td key={i + 9} style={{ color, padding: '3px 4px', textAlign: 'center', fontSize: 11 }}>{fn(h)}</td>)}
      <td style={{ color, padding: '3px 4px', textAlign: 'center', fontSize: 11, fontWeight: 600 }}>
        {back.reduce((s, h) => s + (Number(fn(h)) || 0), 0) || ''}
      </td>
    </tr>
  )
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, tableLayout: 'fixed' }}>
        <thead>
          <tr>
            <td style={{ color: C.textFaint, padding: '3px 4px', width: 36 }}>Hole</td>
            {[1,2,3,4,5,6,7,8,9].map(n => <td key={n} style={{ color: C.textFaint, padding: '3px 4px', textAlign: 'center', width: 34 }}>{n}</td>)}
            <td style={{ color: C.textFaint, padding: '3px 4px', textAlign: 'center', width: 38, fontWeight: 600 }}>Out</td>
            {[10,11,12,13,14,15,16,17,18].map(n => <td key={n} style={{ color: C.textFaint, padding: '3px 4px', textAlign: 'center', width: 34 }}>{n}</td>)}
            <td style={{ color: C.textFaint, padding: '3px 4px', textAlign: 'center', width: 38, fontWeight: 600 }}>In</td>
          </tr>
        </thead>
        <tbody>
          {row('Par', h => h.par, C.text)}
          {row('Yds', h => h.yardage, C.accent)}
          {row('HCP', h => h.handicap, C.textFaint)}
        </tbody>
      </table>
    </div>
  )
}
