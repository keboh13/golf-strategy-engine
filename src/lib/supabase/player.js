import { supabase } from '../supabase.js'

// ── Per-user data helpers ─────────────────────────────────────────────────────

export async function loadUserProfiles(userId) {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
  if (error) throw error
  // Convert rows → { profileName: playerData }
  return Object.fromEntries((data || []).map(r => [r.profile_name, r.player_data]))
}

export async function saveUserProfile(userId, profileName, playerData) {
  const { error } = await supabase
    .from('user_profiles')
    .upsert({ user_id: userId, profile_name: profileName, player_data: playerData, updated_at: new Date().toISOString() },
             { onConflict: 'user_id,profile_name' })
  if (error) throw error
}

export async function deleteUserProfile(userId, profileName) {
  const { error } = await supabase
    .from('user_profiles')
    .delete()
    .eq('user_id', userId)
    .eq('profile_name', profileName)
  if (error) throw error
}

export async function loadUserHistory(userId) {
  const { data, error } = await supabase
    .from('scoring_history')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data || []).map(r => ({ ...r.round_data, _rowId: r.id }))
}

export async function saveUserHistory(userId, rounds) {
  const { data: existing } = await supabase
    .from('scoring_history')
    .select('id')
    .eq('user_id', userId)
  const existingIds = new Set((existing || []).map(r => r.id))

  const toUpsert = []
  const keepIds = new Set()
  for (const r of rounds) {
    const { _rowId, ...round } = r
    if (_rowId) {
      keepIds.add(_rowId)
      toUpsert.push({ id: _rowId, user_id: userId, round_data: round })
    } else {
      toUpsert.push({ user_id: userId, round_data: round })
    }
  }

  const toDelete = [...existingIds].filter(id => !keepIds.has(id))
  if (toDelete.length > 0) {
    const { error } = await supabase.from('scoring_history').delete().in('id', toDelete)
    if (error) throw error
  }

  if (toUpsert.length > 0) {
    const { error } = await supabase.from('scoring_history').upsert(toUpsert, { onConflict: 'id' })
    if (error) throw error
  }
}

export async function loadUserSettings(userId) {
  const { data, error } = await supabase
    .from('user_settings')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return data || {}
}

export async function saveUserSettings(userId, patch) {
  const { error } = await supabase
    .from('user_settings')
    .upsert({ user_id: userId, ...patch, updated_at: new Date().toISOString() },
             { onConflict: 'user_id' })
  if (error) throw error
}
