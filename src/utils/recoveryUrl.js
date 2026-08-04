// Recognising a password-recovery landing, split out from the ResetPassword
// screen itself so App.js can branch on it without eagerly importing (and
// bundling) that screen — everything under src/pages is code-split.

export function readRecoveryParams() {
  const query = new URLSearchParams(window.location.search)
  // The fragment is a querystring after the '#', same encoding.
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))

  return {
    tokenHash: query.get('token_hash'),
    // Supabase reports link failures in the fragment, but honour a query-string
    // copy too so we don't miss one if that ever changes.
    errorCode: hash.get('error_code') || query.get('error_code'),
    errorDescription: hash.get('error_description') || query.get('error_description'),
    // Either link shape declares itself with type=recovery.
    type: query.get('type') || hash.get('type'),
    hasImplicitSession: Boolean(hash.get('access_token'))
  }
}

// True when the current URL is a password-recovery landing, successful or not.
// The /reset-password path alone counts so a dead link with no usable params
// still reaches the screen's "send me a new one" path instead of the dashboard.
export function isRecoveryUrl() {
  if (window.location.pathname.replace(/\/+$/, '') === '/reset-password') return true
  const p = readRecoveryParams()

  // A failed link is the case that actually bit us, and Supabase drops type=
  // when it bounces one — the real-world dead link is just
  // #error=access_denied&error_code=otp_expired&error_description=…
  // so we can't require type here or the broken case falls through to the
  // landing page. Recovery is the only email link this app sends (signup
  // confirmation is off), so an auth error in the URL means a dead reset link.
  if (p.errorCode) return true

  return p.type === 'recovery' && Boolean(p.tokenHash || p.hasImplicitSession)
}
