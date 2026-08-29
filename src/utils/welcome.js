// Fire the welcome email. Called from the ONE place in each signup path where
// the profiles row has just come into existence, so it is naturally once per
// account; api/welcome.js rate-limits to one send per user per day on top of
// that, and decides which of the two letters (owner or crew) to send.
//
// Deliberately not awaited by its callers and deliberately unable to reject:
// a mail hiccup must never sit between a new customer and their dashboard.
export function sendWelcomeEmail(supabase) {
  ;(async () => {
    try {
      const { data } = await supabase.auth.getSession()
      const token = data && data.session && data.session.access_token
      if (!token) return
      await fetch('/api/welcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: '{}',
      })
    } catch { /* best effort, always */ }
  })()
}
