import { useCallback, useEffect, useRef, useState } from 'react'
import { LS_CURRENT_PROFILE } from './appConstants.js'
import {
  loadUserProfiles,
  loadUserSettings,
  saveUserSettings,
  saveUserProfile,
  deleteUserProfile,
} from './supabase.js'

// Part 4 step 6 of the optimization plan — unlock the multi-profile schema
// that user_profiles already supports. The hook owns:
//   - currentProfile: which profile name the UI is editing right now
//   - profileNames:   sorted list of profiles owned by the user
//   - activeProfileData: the player_data blob for the active profile (or null
//     before the first Supabase load; AppInner uses null as "no DB data yet,
//     keep showing localStorage state until DB lands")
//   - setCurrentProfile, createProfile, deleteProfile, refresh
//
// The hook handles Supabase round-trips so AppInner only has to react to
// activeProfileData changes — same single-blob shape the legacy code already
// consumed.

export const DEFAULT_PROFILE_NAME = 'Default'

export function useProfile({ user }) {
  const [currentProfile, setCurrentProfileState] = useState(() =>
    localStorage.getItem(LS_CURRENT_PROFILE) || DEFAULT_PROFILE_NAME
  )
  const [profileNames, setProfileNames] = useState([DEFAULT_PROFILE_NAME])
  const [activeProfileData, setActiveProfileData] = useState(null)
  // Cache of every loaded profile's player_data so profile switches are
  // instant after the first round-trip. Holds the same blob shape user_profiles
  // returns: { name, handicap, ..., clubs }.
  const profilesCacheRef = useRef({})
  const [refreshTick, setRefreshTick] = useState(0)

  // Persist the selected profile name to localStorage every time it changes
  // (no Supabase write here — `pickProfile` debounces the settings write).
  useEffect(() => {
    try { localStorage.setItem(LS_CURRENT_PROFILE, currentProfile) } catch {}
  }, [currentProfile])

  // Load the user's profiles + which one was active last time. Re-fires when
  // `user.id` changes or `refresh()` is called.
  useEffect(() => {
    if (!user) {
      profilesCacheRef.current = {}
      setProfileNames([DEFAULT_PROFILE_NAME])
      setActiveProfileData(null)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const [profiles, settings] = await Promise.all([
          loadUserProfiles(user.id),
          loadUserSettings(user.id),
        ])
        if (cancelled) return
        const loadedNames = Object.keys(profiles)
        // Newly-signed-up accounts have no rows yet — keep showing the
        // localStorage profile so AppInner doesn't blank the UI.
        const names = loadedNames.length ? loadedNames.slice().sort() : [DEFAULT_PROFILE_NAME]
        profilesCacheRef.current = profiles
        setProfileNames(names)

        const remembered = settings?.current_profile
        const target =
          remembered && names.includes(remembered) ? remembered :
          names.includes(currentProfile)            ? currentProfile :
          names[0]
        if (target !== currentProfile) setCurrentProfileState(target)
        setActiveProfileData(profiles[target] ?? null)
      } catch (e) {
        if (!cancelled) console.warn('[useProfile] load:', e.message)
      }
    })()
    return () => { cancelled = true }
    // refreshTick is included so callers can force a re-load after a write.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, refreshTick])

  // Switch to a named profile. Pulls from the in-memory cache when possible
  // (instant) and only round-trips Supabase if the data was never loaded.
  // Persists the selection to user_settings so the next session lands here.
  const setCurrentProfile = useCallback(async (name) => {
    if (!name || name === currentProfile) return
    setCurrentProfileState(name)
    const cached = profilesCacheRef.current[name]
    if (cached) {
      setActiveProfileData(cached)
    } else if (user) {
      try {
        const profiles = await loadUserProfiles(user.id)
        profilesCacheRef.current = profiles
        setActiveProfileData(profiles[name] ?? null)
      } catch (e) {
        console.warn('[useProfile] switch fetch:', e.message)
      }
    }
    if (user) {
      saveUserSettings(user.id, { current_profile: name }).catch(e =>
        console.warn('[useProfile] settings save:', e.message)
      )
    }
  }, [currentProfile, user])

  // Create a new profile slot. Seeds it with the caller-supplied blob (usually
  // a copy of the current bag + the empty-player-info defaults) so the UI has
  // something coherent to render the moment the user switches.
  const createProfile = useCallback(async (name, seed) => {
    const trimmed = (name || '').trim()
    if (!trimmed) throw new Error('Profile name is required')
    if (profileNames.includes(trimmed)) throw new Error('Profile already exists')
    if (user) await saveUserProfile(user.id, trimmed, seed || {})
    profilesCacheRef.current[trimmed] = seed || {}
    setProfileNames(prev => [...prev, trimmed].sort())
    setCurrentProfileState(trimmed)
    setActiveProfileData(seed || {})
    if (user) {
      saveUserSettings(user.id, { current_profile: trimmed }).catch(() => {})
    }
  }, [profileNames, user])

  // Delete a profile. If the deleted profile was active, fall back to the
  // first remaining profile (or DEFAULT_PROFILE_NAME if the list is now empty).
  const removeProfile = useCallback(async (name) => {
    if (!name || profileNames.length <= 1) throw new Error('Cannot delete the only profile')
    if (user) await deleteUserProfile(user.id, name)
    const cache = profilesCacheRef.current
    delete cache[name]
    const remaining = profileNames.filter(n => n !== name)
    setProfileNames(remaining)
    if (name === currentProfile) {
      const next = remaining[0]
      setCurrentProfileState(next)
      setActiveProfileData(cache[next] ?? null)
      if (user) saveUserSettings(user.id, { current_profile: next }).catch(() => {})
    }
  }, [currentProfile, profileNames, user])

  // Update the in-memory cache when AppInner saves the active profile back to
  // Supabase. Keeps profile-switching from clobbering unsaved work.
  const cacheActiveProfileData = useCallback((data) => {
    profilesCacheRef.current[currentProfile] = data
  }, [currentProfile])

  const refresh = useCallback(() => setRefreshTick(t => t + 1), [])

  return {
    currentProfile,
    profileNames,
    activeProfileData,
    setCurrentProfile,
    createProfile,
    removeProfile,
    cacheActiveProfileData,
    refresh,
  }
}
