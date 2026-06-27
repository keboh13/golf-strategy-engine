// Public course library API — no authentication required.
//
// GET /api/public-courses
//   ?q=<search>          text search on name/location (optional)
//   ?limit=<n>           max rows, default 50, max 200
//   ?offset=<n>          pagination offset, default 0
//   ?publicOnly=true     only is_public=true courses (curated library)
//   → { courses: [...], total: n }
//
// GET /api/public-courses?courseKey=<key>
//   → single course detail: course_data + geo + attributions + contrib count
//
// Uses the anon key (no service role) so Supabase RLS applies — only rows
// with the existing "anyone can read course cache" policy are returned.

export const config = { runtime: 'edge' }

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS })
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS })

  const supabaseUrl = process.env.SUPABASE_URL
  const anonKey     = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
  if (!supabaseUrl || !anonKey) return json({ error: 'Server not configured.' }, 500)

  const anonH = { apikey: anonKey, Authorization: `Bearer ${anonKey}` }
  const base   = `${supabaseUrl}/rest/v1`
  const url    = new URL(req.url)
  const params = url.searchParams

  // ── Single course detail ─────────────────────────────────────────────────
  const courseKey = params.get('courseKey')
  if (courseKey) {
    const [cacheRes, geoRes, attrRes, contribRes] = await Promise.all([
      fetch(`${base}/course_cache?cache_key=eq.${encodeURIComponent(courseKey)}&select=cache_key,course_data,source,cached_at,hit_count,is_public&limit=1`, { headers: anonH }),
      fetch(`${base}/course_geo?course_key=eq.${encodeURIComponent(courseKey)}&select=geojson&limit=1`, { headers: anonH }),
      fetch(`${base}/course_attributions?course_key=eq.${encodeURIComponent(courseKey)}&select=contribution_type,contributor_display,created_at&order=created_at.asc`, { headers: anonH }),
      fetch(`${base}/course_hole_contrib?course_key=eq.${encodeURIComponent(courseKey)}&select=hole_ref&order=hole_ref.asc`, { headers: anonH }),
    ])

    const cacheRows = cacheRes.ok ? await cacheRes.json() : []
    if (!cacheRows.length) return json({ error: 'Course not found.' }, 404)

    const row         = cacheRows[0]
    const geoRows     = geoRes.ok    ? await geoRes.json()    : []
    const attrRows    = attrRes.ok   ? await attrRes.json()   : []
    const contribRows = contribRes.ok ? await contribRes.json() : []

    return json({
      course: {
        cacheKey:     row.cache_key,
        source:       row.source,
        cachedAt:     row.cached_at,
        hitCount:     row.hit_count,
        isPublic:     !!row.is_public,
        ...row.course_data,
      },
      geojson:       geoRows[0]?.geojson || null,
      attributions:  attrRows,
      contribHoles:  contribRows.map(r => r.hole_ref),
    })
  }

  // ── Catalog listing ─────────────────────────────────────────────────────
  const q          = params.get('q') || ''
  const limit      = Math.min(200, parseInt(params.get('limit') || '50', 10))
  const offset     = Math.max(0, parseInt(params.get('offset') || '0', 10))
  const publicOnly = params.get('publicOnly') === 'true'

  let endpoint = `${base}/course_cache?select=cache_key,course_data,source,cached_at,hit_count,is_public&order=hit_count.desc&limit=${limit}&offset=${offset}`
  if (publicOnly) endpoint += '&is_public=eq.true'

  // Text search via Supabase PostgREST full-text (ilike on cache_key)
  if (q) {
    const enc = encodeURIComponent(`%${q.toLowerCase()}%`)
    endpoint += `&cache_key=ilike.${enc}`
  }

  // Fetch with count header for pagination
  const listRes = await fetch(endpoint, {
    headers: { ...anonH, Prefer: 'count=exact' },
  })
  if (!listRes.ok) return json({ error: `Supabase error: ${await listRes.text()}` }, 500)

  const rows  = await listRes.json()
  const range = listRes.headers.get('content-range') || ''
  const total = range ? parseInt(range.split('/')[1] || '0', 10) : rows.length

  const courses = (rows || []).map(r => ({
    cacheKey:  r.cache_key,
    source:    r.source,
    cachedAt:  r.cached_at,
    hitCount:  r.hit_count,
    isPublic:  !!r.is_public,
    name:      r.course_data?.name     || r.cache_key,
    location:  r.course_data?.location || '',
    par:       r.course_data?.par      || null,
    yardage:   r.course_data?.yardage  || null,
    rating:    r.course_data?.rating   || null,
    slope:     r.course_data?.slope    || null,
    holeCount: Array.isArray(r.course_data?.holes) ? r.course_data.holes.length : null,
    hasPdf:    !!r.course_data?._sourcePdf,
    needsReview: !!r.course_data?._needs_review,
  }))

  return json({ courses, total, limit, offset })
}
