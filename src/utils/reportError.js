// Client half of the crash reporter. Ships a one-line description of a crash
// to /api/report-error, which emails JP.
//
// Design constraints, in order of importance:
//   1. It can NEVER throw. This runs from inside error handlers and an
//      ErrorBoundary — code that throws here would replace a recoverable
//      white-screen with an infinite loop.
//   2. It can never block the UI. Fire-and-forget; nothing awaits it.
//   3. It must not spam. The server dedupes globally, but a render loop can
//      fire the same error hundreds of times a second before the network even
//      answers, so the first line of defence is here, in memory.
import buildInfo from '../buildInfo.json'

// Signatures already reported in THIS page session. A remount loop re-throws
// the same error forever; this makes that one request instead of thousands.
const seen = new Set()
const MAX_PER_SESSION = 8

let sessionUser = null

// Called by App.js once the profile is known, so a report can name the
// customer instead of just the bug. Id and role only — no email, no name.
export function setErrorContext(userId, role) {
  sessionUser = userId ? { userId: String(userId), role: String(role || '') } : null
}

export function reportError(where, error, extra) {
  try {
    const message = String(
      (error && error.message) || (typeof error === 'string' ? error : '') || 'Unknown error'
    ).slice(0, 300)

    // Fold ids and numbers out so one bug is one signature, matching the
    // server's own normalisation in api/_alert.js.
    const sig = where + '::' + message.replace(/\d+/g, '#')
    if (seen.has(sig) || seen.size >= MAX_PER_SESSION) return
    seen.add(sig)

    const body = JSON.stringify({
      where,
      message,
      stack: String((error && error.stack) || '').slice(0, 900),
      page: String(window.location.pathname + window.location.search).slice(0, 200),
      build: (buildInfo && buildInfo.sha) || '',
      ...(sessionUser || {}),
      ...(extra || {}),
    })

    // sendBeacon survives the page being torn down, which is exactly what
    // happens when the crash is bad enough to reload — a plain fetch() gets
    // cancelled on navigation and the report is lost. Fall back to fetch with
    // keepalive where sendBeacon is missing or refuses (it can return false).
    let sent = false
    if (navigator && typeof navigator.sendBeacon === 'function') {
      try {
        sent = navigator.sendBeacon('/api/report-error', new Blob([body], { type: 'application/json' }))
      } catch { sent = false }
    }
    if (!sent) {
      fetch('/api/report-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => {})
    }
  } catch {
    // Absolutely terminal. Reporting a crash must never cause one.
  }
}

// Catches what React's ErrorBoundary structurally cannot: errors thrown outside
// render (event handlers, async callbacks, timers) and rejected promises that
// nothing awaited. Those are the ones that leave a screen looking fine while
// the Save button silently does nothing — the worst kind for a paying user,
// because they don't report it, they just stop trusting the app.
export function installGlobalErrorReporting() {
  if (typeof window === 'undefined') return
  window.addEventListener('error', (e) => {
    // Ignore resource load failures (<img>, <script>) — e.error is null there
    // and they are usually a flaky network, not a bug.
    if (e && e.error) reportError('window.onerror', e.error)
  })
  window.addEventListener('unhandledrejection', (e) => {
    const r = e && e.reason
    reportError('unhandledrejection', r instanceof Error ? r : new Error(String(r)))
  })
}
