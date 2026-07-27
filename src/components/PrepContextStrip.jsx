import { C, F } from '../theme.js'

// Persistent context strip rendered across every Round Prep step (Part 1.2 of
// the optimization plan). Tells the user what the next "Generate" would use,
// so the multi-step flow never feels detached from its own choices. Clicking
// any chip jumps to the step that owns that piece of data — light-touch
// navigation, no implicit guarding.

function Chip({ icon, label, sub, onClick, active }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        background: active ? C.accentMuted : C.bgInput,
        border: `1px solid ${active ? C.accent : C.border}`,
        borderRadius: 8, padding: '6px 10px',
        fontFamily: F, cursor: onClick ? 'pointer' : 'default',
        whiteSpace: 'nowrap',
      }}
    >
      <span aria-hidden style={{ fontSize: 14 }}>{icon}</span>
      <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.2 }}>
        <span style={{ fontSize: 9, color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</span>
        <span style={{ fontSize: 12, color: active ? C.accent : C.text, fontWeight: 600 }}>{sub}</span>
      </span>
    </button>
  )
}

export default function PrepContextStrip({
  course,
  coords,
  teeTime,
  teeDate,
  weather,
  prepStep,
  setPrepStep,
  pwaBannerVisible,
  onStartOver,
}) {
  const hasCourse = !!course?.name
  if (!hasCourse) return null  // Strip stays hidden until there's something to summarize.

  const courseChip = (
    <Chip
      icon="📍"
      label="Course"
      sub={course.selectedTee ? `${course.name} · ${course.selectedTee}` : course.name}
      onClick={() => setPrepStep(1)}
      active={prepStep === 1}
    />
  )

  const teesYardage = course.yardage ? Number(course.yardage).toLocaleString() + 'y' : null
  const teeChip = (
    <Chip
      icon="⛳"
      label="Tees"
      sub={[course.selectedTee || (course.tees?.[0]?.name) || '—', teesYardage].filter(Boolean).join(' · ') || 'Pick tees'}
      onClick={() => setPrepStep(2)}
      active={prepStep === 2}
    />
  )

  const teeWhen = teeDate && teeTime ? `${teeDate} · ${teeTime}` : 'Pick a time'
  const teeChip3 = (
    <Chip
      icon="🌤"
      label="Conditions"
      sub={
        weather
          ? `${teeWhen}`
          : teeWhen
      }
      onClick={() => setPrepStep(3)}
      active={prepStep === 3}
    />
  )

  return (
    <div
      role="region"
      aria-label="Round Prep context"
      className="prep-ctx-strip"
      style={{
        position: 'sticky', bottom: pwaBannerVisible ? 64 : 8, marginTop: 16, zIndex: 5,
        background: C.bgCard, border: `1px solid ${C.border}`,
        borderRadius: 12, padding: 8,
        display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'nowrap',
        overflowX: 'auto', WebkitOverflowScrolling: 'touch',
        scrollbarWidth: 'none', msOverflowStyle: 'none',
        boxShadow: '0 6px 18px rgba(0,0,0,0.25)',
      }}
    >
      <style>{`.prep-ctx-strip::-webkit-scrollbar{display:none}`}</style>
      {courseChip}
      {teeChip}
      {teeChip3}
      {coords?.lat && (
        <span style={{ fontSize: 10, color: C.textFaint, marginLeft: 'auto' }}>
          {coords.lat.toFixed(2)}, {coords.lng.toFixed(2)}
        </span>
      )}
      {onStartOver && (
        <button
          type="button"
          onClick={onStartOver}
          style={{
            background: 'transparent', border: `1px solid ${C.border}`,
            borderRadius: 8, padding: '6px 10px',
            fontFamily: F, fontSize: 11, color: C.textMuted,
            cursor: 'pointer', whiteSpace: 'nowrap', marginLeft: coords?.lat ? 0 : 'auto',
          }}
        >
          Start over
        </button>
      )}
    </div>
  )
}
