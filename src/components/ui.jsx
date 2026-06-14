import { useState, useEffect } from 'react'
import { C, lbl } from '../theme.js'

export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 640)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)')
    const handler = (e) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return isMobile
}

export function Badge({ label, bg = C.accentMuted, fg = C.accent }) {
  return <span style={{ background: bg, color: fg, fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 99, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{label}</span>
}

export function Spin() {
  return <div style={{ width: 14, height: 14, border: `2px solid ${C.accentDim}`, borderTopColor: C.accent, borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
}

export function SectionHead({ title, sub }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, color: C.text, margin: 0 }}>{title}</h2>
      {sub && <p style={{ fontSize: 12, color: C.textMuted, marginTop: 3 }}>{sub}</p>}
    </div>
  )
}

export function InfoBox({ children, color = C.blue, bg = C.blueMuted }) {
  return <div style={{ background: bg, border: `1px solid ${color}`, borderRadius: 8, padding: '10px 14px', marginBottom: 10 }}>{children}</div>
}

export function computeDataTier(course) {
  if (!course?.name) return null

  const holes = course.holes || []
  const hasYardages = holes.filter(h => h.yardage && parseInt(h.yardage) > 0).length
  const hasOSM = holes.filter(h => h.osmDesign?.hazards?.length > 0).length
  const hasWebDesign = holes.filter(h => h.webDesign).length
  const hasUserNotes = holes.filter(h => h.notes && !h.osmDesign && !h.webDesign).length
  const hasDesignData = hasOSM + hasWebDesign + hasUserNotes

  if (course.source === 'GolfCourseAPI' && hasYardages >= 16 && hasDesignData >= 12) {
    return { tier: 'gold', label: 'Gold', color: C.amber, bg: C.amberMuted, icon: '★',
      detail: `Verified yardages + design data on ${hasDesignData}/18 holes`,
      sub: 'High-confidence recommendations — hazards, doglegs, and strategy are data-backed' }
  }

  if (hasYardages >= 16 && hasDesignData >= 6) {
    return { tier: 'silver', label: 'Silver', color: C.blue, bg: C.blueMuted, icon: '◆',
      detail: `Yardages verified, design data on ${hasDesignData}/18 holes`,
      sub: 'Good recommendations — some holes have verified hazard/layout data, others use conservative defaults' }
  }

  if (hasYardages >= 12) {
    return { tier: 'bronze', label: 'Bronze', color: C.accent, bg: C.accentMuted, icon: '●',
      detail: `Yardages available, design data on ${hasDesignData}/18 holes`,
      sub: 'Club selection is accurate — hazard/layout info is limited, add hole notes to improve' }
  }

  return { tier: 'basic', label: 'Basic', color: C.textMuted, bg: C.bgInput, icon: '○',
    detail: `Limited data — yardages on ${hasYardages}/18 holes, design on ${hasDesignData}/18`,
    sub: 'Recommendations are general — enter yardages and hole notes for better strategy' }
}

export function DataAccuracyTier({ course, style }) {
  const tier = computeDataTier(course)
  if (!tier) return null
  return (
    <div style={{ background: tier.bg, border: `1px solid ${tier.color}33`, borderRadius: 10, padding: '10px 14px', ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 16 }}>{tier.icon}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: tier.color, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {tier.label} data quality
        </span>
        <span style={{ fontSize: 11, color: C.textMuted, marginLeft: 'auto' }}>{tier.detail}</span>
      </div>
      <p style={{ fontSize: 11, color: C.textMuted, margin: 0 }}>{tier.sub}</p>
    </div>
  )
}
