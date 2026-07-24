// Vercel Node Function — admin-only course metadata editor.
// Three actions:
//   update-metadata — patch course_data fields (everything except name/location)
//   rename          — migrate cache_key across course_cache / hazards / geo / contrib
//   reparse-pdf     — re-run Claude vision parse against the stored _sourcePdf
//                     and return a diff for the admin to review
//
// Server enforces admin via api/_lib/admin.js + the SQL is_admin() check used
// by the rename RPC. Required env vars: ANTHROPIC_API_KEY, SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY.

import { validateAuth, isAdminUser } from './_lib/admin.js'
import { buildScorecardTeesMessages, buildHazardDesignMessages } from './_lib/pdfParseMessages.js'
import { computeHazardCoverage, validateHazardDesignBatch } from './_lib/hazardCoverage.js'
import { buildScorecardDiff } from './_lib/scorecardDiff.js'
import { parseJsonFromText } from './_lib/extractJson.js'

export const config = { maxDuration: 300 }

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  process.env.ALLOWED_ORIGIN || '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Scorecard/tees re-parse — mechanical extraction, fast model.
const MODEL_FAST = 'claude-haiku-4-5-20251001'
// Hazards/descriptions/visual-diagram re-parse — vision-heavy, full model.
// Mirrors the split in api/course-ai.js's parsePdfAndPersist.
const MODEL_QUALITY = 'claude-sonnet-4-6'

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

function makeCacheKey(name, location) {
  return `${(name || '').toLowerCase().trim()}|${(location || '').toLowerCase().trim()}`
}

function courseKeySlug(name, location) {
  return makeCacheKey(name, location).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

async function callClaude(messages, maxTokens, modelOverride) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured on server.')
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model: modelOverride || MODEL_FAST, max_tokens: maxTokens, messages }),
  })
  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error(`Anthropic ${res.status}: ${err}`)
  }
  const data = await res.json()
  let text = ''
  for (const block of (data.content || [])) if (block.type === 'text') text += block.text
  return text
}

export default async function nodeHandler(nodeReq, nodeRes) {
  try {
    const url = `http://localhost${nodeReq.url || '/'}`
    const headers = new Headers()
    for (const [k, v] of Object.entries(nodeReq.headers || {})) {
      if (v == null) continue
      headers.set(k, Array.isArray(v) ? v.join(',') : String(v))
    }
    let bodyBuf
    if (nodeReq.method !== 'GET' && nodeReq.method !== 'HEAD') {
      bodyBuf = await new Promise((resolve, reject) => {
        const chunks = []
        nodeReq.on('data', c => chunks.push(c))
        nodeReq.on('end', () => resolve(Buffer.concat(chunks)))
        nodeReq.on('error', reject)
      })
    }
    const webReq = new Request(url, {
      method: nodeReq.method,
      headers,
      body: bodyBuf && bodyBuf.length ? bodyBuf : undefined,
    })
    const webRes = await handleRequest(webReq)
    nodeRes.statusCode = webRes.status
    webRes.headers.forEach((value, key) => nodeRes.setHeader(key, value))
    const buf = Buffer.from(await webRes.arrayBuffer())
    nodeRes.end(buf)
  } catch (e) {
    nodeRes.statusCode = 500
    nodeRes.setHeader('Content-Type', 'application/json')
    nodeRes.end(JSON.stringify({ error: `Handler crashed: ${e.message}` }))
  }
}

async function handleRequest(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS })

  const userId = await validateAuth(req)
  if (!userId) return jsonResponse({ error: 'Unauthorized — sign in required.' }, 401)
  if (!(await isAdminUser(userId))) return jsonResponse({ error: 'Admin access required.' }, 403)

  let body
  try { body = await req.json() } catch { return jsonResponse({ error: 'Invalid JSON.' }, 400) }

  const { action } = body
  if (!action) return jsonResponse({ error: 'Missing action.' }, 400)

  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseServiceKey) {
    return jsonResponse({ error: 'Supabase not configured.' }, 500)
  }

  const svcHeaders = { apikey: supabaseServiceKey, Authorization: `Bearer ${supabaseServiceKey}` }
  const supabaseRest = (path, init) => fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: { ...(init?.headers || {}), ...svcHeaders },
  })

  const ownerId = userId === 'dev-user' ? null : userId

  try {
    // ── update-metadata ────────────────────────────────────────────────────
    // Patches course_data fields in-place (no key change). Optionally writes
    // hazard rows for individual holes via `hazardsByHole`. Bumps edit_version.
    if (action === 'update-metadata') {
      const { course_key, patch, hazardsByHole } = body
      if (!course_key) return jsonResponse({ error: 'Missing course_key.' }, 400)
      if (!patch || typeof patch !== 'object') return jsonResponse({ error: 'Missing patch object.' }, 400)
      if (patch.name || patch.location) {
        return jsonResponse({ error: 'Use action=rename to change name or location.' }, 400)
      }

      const cur = await supabaseRest(
        `course_cache?cache_key=eq.${encodeURIComponent(course_key)}&select=course_data,edit_version`,
        { method: 'GET' }
      )
      if (!cur.ok) return jsonResponse({ error: 'Course not found.' }, 404)
      const rows = await cur.json()
      if (!rows?.length) return jsonResponse({ error: 'Course not found.' }, 404)

      const merged = { ...(rows[0].course_data || {}), ...patch }
      const nextVersion = Number(rows[0].edit_version || 0) + 1

      const upd = await supabaseRest(
        `course_cache?cache_key=eq.${encodeURIComponent(course_key)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
          body: JSON.stringify({
            course_data: merged,
            updated_at: new Date().toISOString(),
            updated_by: ownerId,
            edit_version: nextVersion,
          }),
        }
      )
      if (!upd.ok) {
        const err = await upd.text().catch(() => '')
        return jsonResponse({ error: `course_cache update failed: ${err}` }, 500)
      }

      // Optional batch hazard upsert
      if (Array.isArray(hazardsByHole) && hazardsByHole.length) {
        const hzRows = hazardsByHole
          .filter(h => h && h.hole)
          .map(h => ({
            course_key,
            hole_ref: Number(h.hole),
            hazards: h,
            source: 'admin_edit',
            confidence: 'high',
            updated_at: new Date().toISOString(),
          }))
        if (hzRows.length) {
          await supabaseRest('course_hole_hazards?on_conflict=course_key,hole_ref', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
            body: JSON.stringify(hzRows),
          }).catch(() => {})
        }
      }

      return jsonResponse({ course_data: merged, edit_version: nextVersion }, 200)
    }

    // ── set-public ─────────────────────────────────────────────────────────
    // Toggle is_public flag on a course_cache row. Admins use this to curate
    // which courses appear in the public Library tab.
    if (action === 'set-public') {
      const { course_key, is_public } = body
      if (!course_key) return jsonResponse({ error: 'Missing course_key.' }, 400)
      if (typeof is_public !== 'boolean') return jsonResponse({ error: 'is_public must be boolean.' }, 400)

      const upd = await supabaseRest(
        `course_cache?cache_key=eq.${encodeURIComponent(course_key)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
          body: JSON.stringify({ is_public, updated_at: new Date().toISOString(), updated_by: ownerId }),
        }
      )
      if (!upd.ok) {
        const err = await upd.text().catch(() => '')
        return jsonResponse({ error: `course_cache update failed: ${err}` }, 500)
      }
      return jsonResponse({ ok: true, is_public }, 200)
    }

    // ── rename ─────────────────────────────────────────────────────────────
    // Calls admin_rename_course RPC to atomically re-key across four tables
    // + insert an alias row. Also moves any PDFs in the storage bucket to a
    // new prefix derived from the new key.
    if (action === 'rename') {
      const { old_key, new_name, new_location, new_course_data } = body
      if (!old_key || !new_name) return jsonResponse({ error: 'Missing old_key or new_name.' }, 400)
      const new_key = makeCacheKey(new_name, new_location || '')

      // Pull current row so we have a base course_data to merge name/location into
      const cur = await supabaseRest(
        `course_cache?cache_key=eq.${encodeURIComponent(old_key)}&select=course_data`,
        { method: 'GET' }
      )
      if (!cur.ok) return jsonResponse({ error: 'Course not found.' }, 404)
      const rows = await cur.json()
      if (!rows?.length) return jsonResponse({ error: 'Course not found.' }, 404)

      const finalCourseData = {
        ...(rows[0].course_data || {}),
        ...(new_course_data || {}),
        name: new_name,
        location: new_location || '',
      }

      // Move PDFs in storage to new prefix (best-effort; failure shouldn't
      // block the metadata rename)
      const oldName = rows[0].course_data?.name || ''
      const oldLocation = rows[0].course_data?.location || ''
      const oldSlug = courseKeySlug(oldName, oldLocation)
      const newSlug = courseKeySlug(new_name, new_location || '')
      if (oldSlug !== newSlug) {
        try {
          const listRes = await fetch(
            `${supabaseUrl}/storage/v1/object/list/course-art`,
            {
              method: 'POST',
              headers: { ...svcHeaders, 'Content-Type': 'application/json' },
              body: JSON.stringify({ prefix: oldSlug, limit: 100 }),
            }
          )
          if (listRes.ok) {
            const objs = await listRes.json()
            for (const o of objs || []) {
              if (!o?.name) continue
              const from = `${oldSlug}/${o.name}`
              const to = `${newSlug}/${o.name}`
              await fetch(`${supabaseUrl}/storage/v1/object/move`, {
                method: 'POST',
                headers: { ...svcHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify({ bucketId: 'course-art', sourceKey: from, destinationKey: to }),
              }).catch(() => {})
            }
            // Update _sourcePdf URL inside course_data if it pointed at the old path
            if (typeof finalCourseData._sourcePdf === 'string') {
              finalCourseData._sourcePdf = finalCourseData._sourcePdf
                .replace(`/course-art/${oldSlug}/`, `/course-art/${newSlug}/`)
            }
          }
        } catch (e) {
          console.warn('[admin-course rename] storage move warning:', e.message)
        }
      }

      const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/admin_rename_course`, {
        method: 'POST',
        headers: {
          ...svcHeaders,
          'Content-Type': 'application/json',
          // Pass the user's token so the RPC's is_admin() check evaluates as
          // the calling user, not the service role.
          Authorization: `Bearer ${(req.headers.get('Authorization') || '').replace('Bearer ', '') || supabaseServiceKey}`,
        },
        body: JSON.stringify({
          old_key,
          new_key,
          new_course_data: finalCourseData,
        }),
      })
      if (!rpcRes.ok) {
        const err = await rpcRes.text().catch(() => '')
        return jsonResponse({ error: `rename RPC failed: ${err}` }, 500)
      }

      return jsonResponse({ old_key, new_key, course_data: finalCourseData }, 200)
    }

    // ── reparse-pdf ────────────────────────────────────────────────────────
    // Re-run Claude vision parse against the stored _sourcePdf URL, return a
    // diff of fields where parse differs from current cached data. Admin
    // accepts selected fields via a subsequent update-metadata call.
    if (action === 'reparse-pdf') {
      const { course_key } = body
      if (!course_key) return jsonResponse({ error: 'Missing course_key.' }, 400)

      const cur = await supabaseRest(
        `course_cache?cache_key=eq.${encodeURIComponent(course_key)}&select=course_data`,
        { method: 'GET' }
      )
      if (!cur.ok) return jsonResponse({ error: 'Course not found.' }, 404)
      const rows = await cur.json()
      if (!rows?.length) return jsonResponse({ error: 'Course not found.' }, 404)
      const current = rows[0].course_data || {}
      const pdfUrl = current._sourcePdf
      if (!pdfUrl) return jsonResponse({ error: 'No stored PDF for this course. Upload one first.' }, 422)

      // Call 1 — scorecard + tees (fast model). Same split as
      // api/course-ai.js's parsePdfAndPersist, so a reparse gets the same
      // reliability as a fresh upload.
      const scorecardText = await callClaude(
        buildScorecardTeesMessages(pdfUrl, current.name, current.location || ''), 6000, MODEL_FAST
      )
      const scorecardRes = parseJsonFromText(scorecardText)
      if (!scorecardRes.ok) return jsonResponse({ error: `No JSON in re-parse scorecard response (${scorecardRes.error}).` }, 502)
      const parsed = scorecardRes.value
      if (parsed.error) return jsonResponse({ error: parsed.error }, 422)

      // Call 2 — hazards + descriptions + visual analysis (full model).
      // Independent failure: a bad hazard re-parse never blocks the
      // scorecard diff from being reviewable.
      let hazardsByHole = []
      try {
        const hazardText = await callClaude(
          buildHazardDesignMessages(pdfUrl, current.name, current.location || ''), 8000, MODEL_QUALITY
        )
        const hazardRes = parseJsonFromText(hazardText)
        if (!hazardRes.ok) throw new Error(`No JSON in re-parse hazard response (${hazardRes.error}).`)
        const hazardParsed = hazardRes.value
        if (hazardParsed.error) throw new Error(hazardParsed.error)
        hazardsByHole = Array.isArray(hazardParsed.hazardsByHole) ? hazardParsed.hazardsByHole : []
        parsed._hazardValidationIssues = validateHazardDesignBatch(hazardsByHole)
      } catch (e) {
        parsed._hazardExtractError = e.message
      }
      parsed.hazardsByHole = hazardsByHole
      parsed.hazardCoverage = computeHazardCoverage(hazardsByHole)

      const diff = buildScorecardDiff(current, parsed)
      return jsonResponse({ parsed, diff, pdfUrl }, 200)
    }

    return jsonResponse({ error: `Unknown action: ${action}` }, 400)
  } catch (e) {
    return jsonResponse({ error: e.message }, 502)
  }
}
