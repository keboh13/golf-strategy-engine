import { supabase } from '../supabase.js'

// ── Saved game plans ─────────────────────────────────────────────────────────

export async function loadSavedPlans(userId) {
  const { data, error } = await supabase
    .from('saved_plans')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(10)
  if (error) throw error
  return (data || []).map(r => ({
    id: r.id,
    course: r.course_name,
    date: r.created_at?.slice(0, 10),
    plan: r.plan_text,
    tee: r.tee_name || '',
  }))
}

export async function savePlan(userId, courseName, planText, teeName) {
  const { error } = await supabase
    .from('saved_plans')
    .insert({
      user_id: userId,
      course_name: courseName,
      plan_text: planText,
      tee_name: teeName || null,
    })
  if (error) throw error
}

export async function deleteSavedPlan(planId) {
  const { error } = await supabase
    .from('saved_plans')
    .delete()
    .eq('id', planId)
  if (error) throw error
}

// ── prep_sessions ────────────────────────────────────────────────────────────
// Cross-device resume for the Round Prep flow (Part 1.2 of the optimization
// plan). One row per (user, profile). `state` is a minimal jsonb slice the
// client knows how to rehydrate — see PrepTab / AppInner for the shape.

export async function loadPrepSession(userId, profileName = 'Default') {
  const { data, error } = await supabase
    .from('prep_sessions')
    .select('state, updated_at')
    .eq('user_id', userId)
    .eq('profile_name', profileName)
    .maybeSingle()
  if (error) throw error
  return data || null
}

export async function savePrepSession(userId, profileName, state) {
  const { error } = await supabase
    .from('prep_sessions')
    .upsert(
      { user_id: userId, profile_name: profileName || 'Default', state, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,profile_name' }
    )
  if (error) throw error
}

// Wipes the saved prep slice for (user, profile) so the next mount / other
// device starts blank instead of restoring the previous course.
export async function clearPrepSession(userId, profileName = 'Default') {
  if (!userId) return
  const { error } = await supabase
    .from('prep_sessions')
    .delete()
    .eq('user_id', userId)
    .eq('profile_name', profileName || 'Default')
  if (error) throw error
}

// ── rec_quality ──────────────────────────────────────────────────────────────
// Upserts a user rating for a single rec_log entry. The unique index on
// (rec_log_id, rater_id, dimension) means calling this again just updates the
// existing row — so "change your mind" is safe.

export async function saveRecQuality(recLogId, raterId, rating, dimension = 'overall', notes = null) {
  const { error } = await supabase
    .from('rec_quality')
    .upsert(
      { rec_log_id: recLogId, rater_id: raterId, rating, dimension, notes: notes || null },
      { onConflict: 'rec_log_id,rater_id,dimension' }
    )
  if (error) throw error
}

// ── Post-round feedback ─────────────────────────────────────────────────────
// Persists per-hole scores + notes for a specific brief so mobile users don't
// lose feedback when localStorage is evicted. Keyed on (user_id, brief_id).

export async function savePostRound(userId, briefId, postRound) {
  if (!supabase) throw new Error('Supabase not configured')
  const { error } = await supabase
    .from('post_round_feedback')
    .upsert(
      {
        user_id: userId,
        brief_id: briefId,
        scores: postRound.scores || {},
        notes: postRound.notes || {},
        general_notes: postRound.generalNotes || '',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,brief_id' }
    )
  if (error) throw error
}

export async function loadPostRound(userId, briefId) {
  if (!supabase) return null
  const { data, error } = await supabase
    .from('post_round_feedback')
    .select('scores, notes, general_notes, updated_at')
    .eq('user_id', userId)
    .eq('brief_id', briefId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    scores: data.scores || {},
    notes: data.notes || {},
    generalNotes: data.general_notes || '',
    updatedAt: data.updated_at,
  }
}

export async function loadAllPostRounds(userId) {
  if (!supabase) return {}
  const { data, error } = await supabase
    .from('post_round_feedback')
    .select('brief_id, scores, notes, general_notes, updated_at')
    .eq('user_id', userId)
  if (error) throw error
  const byBriefId = {}
  for (const row of (data || [])) {
    byBriefId[row.brief_id] = {
      scores: row.scores || {},
      notes: row.notes || {},
      generalNotes: row.general_notes || '',
      updatedAt: row.updated_at,
    }
  }
  return byBriefId
}
