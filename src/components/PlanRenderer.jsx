import { useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { C } from '../theme.js'
import { stripStreamingArtifacts } from '../lib/generationPhases.js'

const MD_COMPONENTS = {
  h2: ({ children }) => <h2 style={{ fontSize: 16, fontWeight: 600, color: C.text, margin: '1.4rem 0 0.4rem', borderBottom: `1px solid ${C.border}`, paddingBottom: 6 }}>{children}</h2>,
  h3: ({ children }) => {
    const text = typeof children === 'string' ? children : Array.isArray(children) ? children.join('') : ''
    return <h3 style={{ fontSize: 13, fontWeight: 600, color: /Hole/i.test(text) ? C.accent : C.amber, margin: '1rem 0 3px' }}>{children}</h3>
  },
  p: ({ children }) => <p style={{ fontSize: 13, color: C.textMuted, lineHeight: 1.7, margin: '3px 0' }}>{children}</p>,
  strong: ({ children }) => <strong style={{ color: C.text }}>{children}</strong>,
  li: ({ children }) => (
    <div style={{ display: 'flex', gap: 8, marginBottom: 3, paddingLeft: 6 }}>
      <span style={{ color: C.accentDim, flexShrink: 0, marginTop: 2 }}>▸</span>
      <span style={{ fontSize: 13, color: C.textMuted, lineHeight: 1.65 }}>{children}</span>
    </div>
  ),
  ul: ({ children }) => <div style={{ margin: '4px 0' }}>{children}</div>,
  ol: ({ children }) => <div style={{ margin: '4px 0' }}>{children}</div>,
  hr: () => <hr style={{ border: 'none', borderTop: `1px solid ${C.border}`, margin: '1.5rem 0' }} />,
  table: ({ children }) => (
    <div style={{ overflowX: 'auto', margin: '12px 0', WebkitOverflowScrolling: 'touch' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 480 }}>{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead style={{ borderBottom: `2px solid ${C.border}` }}>{children}</thead>,
  th: ({ children }) => <th style={{ padding: '8px 10px', textAlign: 'left', color: C.text, fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>{children}</th>,
  td: ({ children }) => <td style={{ padding: '7px 10px', borderBottom: `1px solid ${C.border}`, color: C.textMuted, verticalAlign: 'top' }}>{children}</td>,
  tr: ({ children }) => <tr style={{ }}>{children}</tr>,
  code: ({ children }) => <code style={{ background: C.bgInput, padding: '1px 5px', borderRadius: 4, fontSize: '0.9em' }}>{children}</code>,
}

export default function PlanRenderer({ text }) {
  if (!text) return null
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
      {stripStreamingArtifacts(text)}
    </ReactMarkdown>
  )
}
