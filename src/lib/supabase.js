import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL  || ''
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

if (!SUPABASE_URL || !SUPABASE_ANON) {
  console.warn('[supabase] VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY not set — auth and DB disabled')
}

export const supabase = SUPABASE_URL && SUPABASE_ANON
  ? createClient(SUPABASE_URL, SUPABASE_ANON, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
    })
  : null

// ── Barrel re-exports (backward-compatible) ─────────────────────────────────

export { loadUserProfiles, saveUserProfile, deleteUserProfile, loadUserHistory, saveUserHistory, loadUserSettings, saveUserSettings } from './supabase/player.js'

export { getCachedCourseDB, setCachedCourseDB, getAllCachedCoursesDB, queryCourseCacheDB, listCanonicalCacheKeys, listCanonicalCacheVersions, listAliasKeys, deleteCachedCourseDB, loadCourseHazards, listCoursePdfs, uploadCoursePdfToBucket, deleteAllCoursePdfs, deleteCourseHazards, clearCachedScorecardPdfRef, saveCourseHazards } from './supabase/courseData.js'

export { loadSavedPlans, savePlan, deleteSavedPlan, loadPrepSession, savePrepSession, clearPrepSession, saveRecQuality, savePostRound, loadPostRound, loadAllPostRounds } from './supabase/prepFlow.js'
