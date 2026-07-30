// Shared Supabase REST wrapper and course-cache persistence helpers.
// Extracted from course-ai.js to deduplicate the upsert pattern.

export function createSupabaseRest(supabaseUrl, supabaseServiceKey) {
  return async function supabaseRest(path, init) {
    // #152: 8s default timeout for Supabase REST calls
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8_000)
    try {
      const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
        ...init,
        headers: {
          ...(init?.headers || {}),
          apikey: supabaseServiceKey,
          Authorization: `Bearer ${supabaseServiceKey}`,
        },
        signal: controller.signal,
      })
      clearTimeout(timer)
      return res
    } catch (e) {
      clearTimeout(timer)
      if (e.name === 'AbortError') throw new Error(`Supabase REST timeout after 8s (${path.split('?')[0]})`)
      throw e
    }
  }
}

// Read the current course_cache row for a given cache key.
export async function readCourseCache(supabaseRest, courseKey) {
  const res = await supabaseRest(
    `course_cache?cache_key=eq.${encodeURIComponent(courseKey)}&select=course_data,source,edit_version`,
    { method: 'GET' }
  )
  if (!res.ok) return null
  const rows = await res.json()
  return (Array.isArray(rows) && rows[0]) || null
}

// Upsert a single row into course_cache with auto-incrementing edit_version.
export async function upsertCourseCache(supabaseRest, courseKey, courseData, opts = {}) {
  const { userId } = opts

  // Read current edit_version so we can bump it (clients use this to
  // lazily refresh stale localStorage entries after admin-driven changes).
  let nextVersion = 1
  try {
    const cur = await supabaseRest(
      `course_cache?cache_key=eq.${encodeURIComponent(courseKey)}&select=edit_version`,
      { method: 'GET' }
    )
    if (cur.ok) {
      const rows = await cur.json()
      if (Array.isArray(rows) && rows[0]?.edit_version != null) {
        nextVersion = Number(rows[0].edit_version) + 1
      }
    }
  } catch {}

  const upsertRes = await supabaseRest('course_cache?on_conflict=cache_key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({
      cache_key: courseKey,
      course_data: courseData,
      source: opts.source || 'yardage_book',
      cached_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      updated_by: userId === 'dev-user' ? null : userId,
      edit_version: nextVersion,
    }),
  }).catch(e => ({ ok: false, status: 0, _err: e?.message }))

  return upsertRes
}

// Upsert hazard rows into course_hole_hazards.
export async function upsertHazardRows(supabaseRest, rows) {
  if (!rows.length) return { ok: true, status: 200 }
  return supabaseRest('course_hole_hazards?on_conflict=course_key,hole_ref', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify(rows),
  }).catch(e => ({ ok: false, status: 0, _err: e?.message }))
}
