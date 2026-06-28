import { useState } from 'react'
import { C, F, card, inp, lbl, btnP, btnG } from '../theme.js'
import { supabase } from '../lib/supabase.js'
import CourseHoleMap from './CourseHoleMap.jsx'
import { loadCourseHazards } from '../lib/supabase.js'

// Admin geometry editor: renders the satellite map in contribute mode so the
// admin can click tee + pin for any hole. On save the coordinates are written
// directly to course_geo (not the pending queue) so the change takes effect
// immediately for all users. Each save also removes the matching
// course_hole_contrib row if one exists (the admin version supersedes it).

export default function AdminGeometryEditor() {
  const [search,   setSearch]   = useState('')
  const [course,   setCourse]   = useState(null) // { name, location, coords, holes, geojson }
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')
  const [msg,      setMsg]      = useState('')
  const [savedHoles, setSavedHoles] = useState(new Set())

  const findCourse = async (e) => {
    e?.preventDefault?.()
    const q = search.trim()
    if (!q) return
    setLoading(true); setError(''); setCourse(null); setMsg('')

    try {
      // Look up in course_cache
      const { data, error: err } = await supabase
        .from('course_cache')
        .select('cache_key, course_data, source')
        .ilike('cache_key', `%${q.toLowerCase()}%`)
        .limit(5)
      if (err) throw err
      if (!data?.length) { setError(`No cached course matches "${q}".`); setLoading(false); return }

      const row  = data[0]
      const cd   = row.course_data || {}
      const key  = row.cache_key

      // Load existing geo
      const { data: geoRows } = await supabase
        .from('course_geo')
        .select('geojson')
        .eq('course_key', key)
        .limit(1)
      const geojson = geoRows?.[0]?.geojson || null

      // Load hazards for the map overlay
      const hazards = await loadCourseHazards(cd.name, cd.location).catch(() => null)

      setCourse({
        name:     cd.name || key,
        location: cd.location || '',
        cacheKey: key,
        coords:   cd.coordinates || null,
        holes:    cd.holes || [],
        geojson:  geojson || hazards?.geojson || null,
      })
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }

  const handleContribute = async ({ ref, teeLng, teeLat, pinLng, pinLat }) => {
    if (!course) return
    setMsg(`Saving hole ${ref} geometry…`)
    try {
      // Read existing geojson and merge the new hole feature
      const { data: geoRows } = await supabase
        .from('course_geo')
        .select('geojson')
        .eq('course_key', course.cacheKey)
        .limit(1)

      let existing = geoRows?.[0]?.geojson || { type: 'FeatureCollection', features: [] }

      const holeFeature = {
        type: 'Feature',
        properties: { holeRef: ref, source: 'admin' },
        geometry: {
          type: 'LineString',
          coordinates: [[teeLng, teeLat], [pinLng, pinLat]],
        },
      }
      existing.features = existing.features.filter(f => f.properties?.holeRef !== ref)
      existing.features.push(holeFeature)

      const { error: upsertErr } = await supabase
        .from('course_geo')
        .upsert({ course_key: course.cacheKey, geojson: existing, updated_at: new Date().toISOString() }, { onConflict: 'course_key' })
      if (upsertErr) throw upsertErr

      // Delete any pending user contribution for this hole
      await supabase
        .from('course_hole_contrib')
        .delete()
        .eq('course_key', course.cacheKey)
        .eq('hole_ref', ref)

      // Update local geojson so the map re-renders with the new line
      setCourse(prev => ({
        ...prev,
        geojson: existing,
      }))
      setSavedHoles(prev => new Set([...prev, ref]))
      setMsg(`✓ Hole ${ref} geometry saved.`)
    } catch (e) {
      setMsg(`Error saving hole ${ref}: ${e.message}`)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ ...card }}>
        <p style={{ ...lbl, margin: '0 0 6px' }}>Admin geometry editor</p>
        <p style={{ fontSize: 12, color: C.textMuted, margin: '0 0 12px' }}>
          Find a cached course, then tap tee → pin on the satellite map to set the centerline for any hole.
          Admin-drawn geometry writes directly to <code style={{ color: C.accent }}>course_geo</code> and supersedes user contributions.
        </p>
        <form onSubmit={findCourse} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <label style={lbl}>Search course</label>
            <input style={inp} value={search} onChange={e => setSearch(e.target.value)} placeholder="Pebble Beach, Augusta…" />
          </div>
          <button style={btnP} type="submit" disabled={loading}>{loading ? 'Searching…' : 'Find course →'}</button>
        </form>
        {error && <p style={{ fontSize: 12, color: C.red, margin: '8px 0 0' }}>⚠ {error}</p>}
        {msg && (
          <p style={{ fontSize: 12, color: msg.startsWith('Error') ? C.red : msg.startsWith('✓') ? C.green : C.textMuted, margin: '8px 0 0' }}>{msg}</p>
        )}
      </div>

      {course && (
        <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}` }}>
            <p style={{ fontSize: 14, fontWeight: 700, color: C.text, margin: 0 }}>{course.name}</p>
            <p style={{ fontSize: 11, color: C.textMuted, margin: '2px 0 0' }}>
              {course.location} · {course.holes.length || '?'} holes
              {savedHoles.size > 0 && ` · ${savedHoles.size} hole${savedHoles.size !== 1 ? 's' : ''} saved this session`}
            </p>
            <p style={{ fontSize: 11, color: C.textFaint, margin: '4px 0 0' }}>
              Select a hole, then tap tee → pin on the map. Each save is immediate.
            </p>
          </div>
          <div style={{ height: 520 }}>
            <CourseHoleMap
              courseName={course.name}
              location={course.location}
              coords={course.coords}
              holes={course.holes}
              geojson={course.geojson}
              onContribute={handleContribute}
              contributedHoles={savedHoles}
              isMobile={false}
            />
          </div>
        </div>
      )}
    </div>
  )
}
