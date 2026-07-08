// First-touch marketing attribution, so we can answer "which social post
// created this trial?" — pure client plumbing, no dependencies.
//
// How it flows:
//   1. captureAttribution() runs on every page load (App.js). If the URL has
//      any utm_* params and nothing is stored yet, it persists them to
//      localStorage. FIRST touch wins — a later tagged visit never overwrites
//      the one that actually brought them in. (The partner ?ref= link keeps
//      its own separate 'jobtally_ref' key with last-touch semantics — that
//      one pays a commission, so the most recent partner wins. Unchanged.)
//   2. At signup the stored attribution is (a) stuffed into the auth user's
//      signup metadata — surviving the email-confirmation flow even if they
//      confirm on another device — and (b) written to the signup_attribution
//      table right after the profile row is created (both creation paths).
//
// Everything is sanitized + length-capped to match the DB CHECK constraints
// (FIX-DATABASE-19), so a hand-crafted URL can't stuff garbage into the row.

const KEY = 'jobtally_attribution'

// Strip control chars, collapse whitespace, cap length. UTM values are
// human-readable slugs/labels — anything wilder gets flattened.
const clean = (v, max = 128) =>
  Array.from(String(v || ''))
    .filter((ch) => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127) // drop control chars
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)

// Read utm_* off the current URL and persist first-touch. Safe to call on
// every load; it's a no-op unless there are UTMs and none are stored yet.
export function captureAttribution() {
  try {
    const params = new URLSearchParams(window.location.search)
    const utm = {
      utm_source: clean(params.get('utm_source')),
      utm_medium: clean(params.get('utm_medium')),
      utm_campaign: clean(params.get('utm_campaign')),
    }
    if (!utm.utm_source && !utm.utm_medium && !utm.utm_campaign) return
    if (localStorage.getItem(KEY)) return // first touch already recorded
    localStorage.setItem(
      KEY,
      JSON.stringify({
        ...utm,
        landing_page: clean(window.location.pathname, 256),
        first_seen_at: new Date().toISOString(),
      })
    )
  } catch {
    // Storage blocked (private mode etc.) — attribution is best-effort.
  }
}

// The stored first-touch record, or null. Re-sanitized on the way out in
// case localStorage was edited by hand.
export function getAttribution() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const a = JSON.parse(raw)
    const out = {
      utm_source: clean(a.utm_source) || null,
      utm_medium: clean(a.utm_medium) || null,
      utm_campaign: clean(a.utm_campaign) || null,
      landing_page: clean(a.landing_page, 256) || null,
      first_seen_at: typeof a.first_seen_at === 'string' ? a.first_seen_at.slice(0, 40) : null,
    }
    if (!out.utm_source && !out.utm_medium && !out.utm_campaign) return null
    return out
  } catch {
    return null
  }
}

// Write the attribution row for a freshly-created account. Best-effort:
// signup must never fail because analytics did. `attribution` is either the
// live localStorage value (same-device signup) or the copy that rode in the
// auth user's signup metadata (email-confirmation flow). The partner ref is
// folded in here too so one table answers the whole "where did they come
// from" question. RLS only allows inserting your OWN row, once.
export async function saveSignupAttribution(supabase, userId, attribution) {
  try {
    const ref = clean(
      typeof localStorage !== 'undefined' ? localStorage.getItem('jobtally_ref') : '',
      32
    )
    const a = attribution || getAttribution()
    if (!a && !ref) return // nothing to record — don't write empty rows
    const first = a && a.first_seen_at ? new Date(a.first_seen_at) : null
    await supabase.from('signup_attribution').insert({
      user_id: userId,
      ref: ref || null,
      utm_source: (a && clean(a.utm_source)) || null,
      utm_medium: (a && clean(a.utm_medium)) || null,
      utm_campaign: (a && clean(a.utm_campaign)) || null,
      landing_page: (a && clean(a.landing_page, 256)) || null,
      first_seen_at: first && !isNaN(first.getTime()) ? first.toISOString() : null,
    })
  } catch {
    // Duplicate row (retry), RLS, offline — all fine to ignore.
  }
}
