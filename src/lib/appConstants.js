export const ENV_MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY || ''

export const LS_PLAYER = 'gse_player'
export const LS_HISTORY = 'gse_history'
export const LS_KEYS = 'gse_keys'
export const LS_PROFILES = 'gse_profiles'
export const LS_CURRENT_PROFILE = 'gse_current_profile'
export const LS_COURSE_CACHE = 'gse_course_cache'
export const LS_MODEL = 'gse_model'

export const AVAILABLE_MODELS = [
  { id: 'claude-haiku-4-5-20251001', name: 'Haiku',   desc: 'Fastest · Good for quick briefs',          tier: 'Free',     speed: '~8s',  cost: '$' },
  { id: 'claude-sonnet-4-6',         name: 'Sonnet',  desc: 'Balanced · Recommended (default)',         tier: 'Standard', speed: '~15s', cost: '$$' },
  { id: 'claude-opus-4-8',           name: 'Opus',    desc: 'Most capable · Deeper analysis',           tier: 'Premium',  speed: '~30s', cost: '$$$' },
  { id: 'claude-fable-5',            name: 'Fable 5', desc: 'Flagship · Best strategy & reasoning',     tier: 'Premium',  speed: '~25s', cost: '$$$' },
]

export const DEFAULT_CLUBS = [
  { club: 'Driver',          carry: 275, shape: 'Slight fade' },
  { club: '3-wood',          carry: 245, shape: 'Fade'        },
  { club: '5-wood',          carry: 230, shape: 'Fade'        },
  { club: '4-iron / hybrid', carry: 210, shape: 'Straight'    },
  { club: '5-iron',          carry: 195, shape: 'Straight'    },
  { club: '6-iron',          carry: 180, shape: 'Straight'    },
  { club: '7-iron',          carry: 165, shape: 'Draw'        },
  { club: '8-iron',          carry: 150, shape: 'Draw'        },
  { club: '9-iron',          carry: 135, shape: 'Draw'        },
  { club: 'PW',              carry: 120, shape: 'Draw'        },
  { club: 'GW (50°)',        carry: 105, shape: 'Straight'    },
  { club: 'SW (56°)',        carry:  85, shape: 'Straight'    },
  { club: 'LW (60°)',        carry:  65, shape: 'Straight'    },
]

export const DEFAULT_PLAYER = {
  name: '', handicap: '4.2', ghin: '',
  handedness: 'Right',
  miss: 'Both (fade misses right under pressure)',
  ballFlight: 'Fade', swingNotes: '',
  goals: '', strengths: '',
}

export function loadProfiles() {
  try { return JSON.parse(localStorage.getItem(LS_PROFILES)) || {} } catch { return {} }
}
export function saveProfiles(obj) {
  try { localStorage.setItem(LS_PROFILES, JSON.stringify(obj)) } catch {}
}

export function loadSavedKeys() {
  try { return JSON.parse(localStorage.getItem(LS_KEYS)) || {} } catch { return {} }
}
export function saveKeys(obj) {
  try { localStorage.setItem(LS_KEYS, JSON.stringify(obj)) } catch {}
}

// Clubs ride inside the persisted profile blob (localStorage + Supabase player_data).
// These helpers split that blob back into clubs and clubs-free player info.
export function clubsFromProfile(data) {
  return (data && Array.isArray(data.clubs) && data.clubs.length > 0) ? data.clubs : DEFAULT_CLUBS
}
export function stripClubs(data) {
  if (!data || typeof data !== 'object') return data
  const { clubs: _ignored, ...info } = data
  return info
}

// Migrate legacy single-player data into profiles on first run.
// Runs once at module load (same behavior as the prior IIFE in App.jsx).
;(function migrateLegacy() {
  const profiles = loadProfiles()
  if (Object.keys(profiles).length === 0) {
    try {
      const legacy = JSON.parse(localStorage.getItem(LS_PLAYER))
      if (legacy) { profiles['Default'] = legacy; saveProfiles(profiles) }
    } catch {}
  }
})()
