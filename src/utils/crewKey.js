// The crew member's way back in, kept on his own phone.
//
// Passwordless crew accounts (api/join-invite.js) have no password and no
// reachable email, so the ONLY thing that can re-authenticate one is the invite
// link. Making the worker find his boss's six-week-old text message to get back
// into an app he uses daily is not a recovery path, it's a churn event.
//
// So the moment a join succeeds we keep his token here, and App.js spends it
// automatically the next time the app boots without a session. From his seat
// nothing happens at all: he taps the icon and he's in.
//
// SECURITY. This is a credential at rest on the worker's own device, which is
// exactly what the session it replaces already was, scoped to one worker's own
// timesheet. It is stored only after HIS join succeeded, never from a URL that
// merely happens to carry a token, so an owner testing his own invite link does
// not end up with a crew key on his phone. The owner can revoke it at any time
// (worker_invites.revoked_at) and a revoked token fails closed on the server.
//
// ⚠️ It will NOT always be there. localStorage is cleared, private windows have
// none, and an iOS home-screen web app may get a storage partition separate from
// the Safari tab the worker joined in. Every caller has to handle the empty case
// by falling back to "tap the link your boss sent you" — never by pretending the
// account is broken.
const KEY = 'jt_crew_key'

export function saveCrewKey(token) {
  if (!token) return
  try { localStorage.setItem(KEY, token) } catch { /* private mode, nothing to do */ }
}

export function readCrewKey() {
  try { return localStorage.getItem(KEY) || null } catch { return null }
}

// Called when the server tells us this token is dead (revoked, or the worker was
// taken off the crew). Keeping a key that can never work again just means
// retrying a doomed request on every cold start.
export function clearCrewKey() {
  try { localStorage.removeItem(KEY) } catch { /* nothing to do */ }
}
