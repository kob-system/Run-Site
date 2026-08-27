import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase env vars: set REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY')
}

// ---------------------------------------------------------------------------
// STAYING SIGNED IN
//
// A framer on a jobsite should never be asked for a password to clock in, and
// an owner checking a number at a red light should not either. supabase-js
// persists a session by default, but it was doing it silently and with no way
// for the user to see or choose it — so nobody trusted it, and JP asked for a
// button that says out loud "this phone stays signed in".
//
// That button writes STAY_KEY, and this storage adapter reads it:
//   stay ON  (default) -> localStorage  : survives closing the app, rebooting
//                                         the phone, and reopening days later.
//   stay OFF            -> sessionStorage: gone the moment the tab/app closes.
//
// Reads check BOTH stores, so flipping the switch mid-session never strands a
// live session in the store we stopped writing to. Everything is wrapped in
// try/catch: Safari private mode throws on the first localStorage touch, and a
// throw here would take the whole app down before the login screen renders.
// ---------------------------------------------------------------------------
export const STAY_KEY = 'jobtally_stay_signed_in'

export function getStaySignedIn() {
  try { return localStorage.getItem(STAY_KEY) !== '0' } catch { return true }
}

export function setStaySignedIn(on) {
  try { localStorage.setItem(STAY_KEY, on ? '1' : '0') } catch { /* private mode */ }
  // Move whatever session already exists into the store we'll read next time,
  // so the choice takes effect immediately instead of on the next sign-in.
  try {
    const from = on ? window.sessionStorage : window.localStorage
    const to = on ? window.localStorage : window.sessionStorage
    for (let i = 0; i < from.length; i++) {
      const k = from.key(i)
      if (k && k.startsWith('sb-') && k !== STAY_KEY) {
        to.setItem(k, from.getItem(k))
      }
    }
    // Second pass to remove, because removing while iterating reindexes.
    const stale = []
    for (let i = 0; i < from.length; i++) {
      const k = from.key(i)
      if (k && k.startsWith('sb-') && k !== STAY_KEY) stale.push(k)
    }
    stale.forEach(k => from.removeItem(k))
  } catch { /* private mode */ }
}

const authStorage = {
  getItem: (key) => {
    try {
      const v = window.localStorage.getItem(key)
      if (v !== null) return v
    } catch { /* ignore */ }
    try { return window.sessionStorage.getItem(key) } catch { return null }
  },
  setItem: (key, value) => {
    try {
      if (getStaySignedIn()) window.localStorage.setItem(key, value)
      else window.sessionStorage.setItem(key, value)
    } catch { /* private mode — session lives in memory for this run only */ }
  },
  removeItem: (key) => {
    try { window.localStorage.removeItem(key) } catch { /* ignore */ }
    try { window.sessionStorage.removeItem(key) } catch { /* ignore */ }
  }
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Spelled out rather than left to the library defaults, because these three
    // ARE the "stay signed in" feature and a future dependency bump must not be
    // able to quietly change them.
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: typeof window === 'undefined' ? undefined : authStorage
  }
})

// A phone that has been asleep for hours wakes up holding an access token that
// expired while the screen was off. autoRefreshToken's timer does not fire in a
// backgrounded tab, so the first tap after waking used to hit a 401 and bounce
// the worker to the login screen. Refreshing on wake turns that into nothing at
// all: the app is simply still signed in.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      supabase.auth.getSession().catch(() => {})
    }
  })
}
