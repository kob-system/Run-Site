import React, { useState, useEffect, useCallback } from 'react'

// "Put it on your phone" — the add-to-home-screen nudge.
//
// Why this exists: JobTally's single best answer to "I'm not making my guys
// download something" is that there IS nothing to download — it's a web page
// that can sit on the home screen like anything else. That was true the whole
// time and the app never once said so, so nobody did it, so the crew kept
// re-typing a URL and the owner kept thinking of it as a website he visits
// instead of something his guys have on their phone.
//
// Two worlds, because the platforms disagree:
//   • Chrome/Android fires `beforeinstallprompt`, which we stash and replay on
//     a tap — one button, real install.
//   • iOS Safari fires nothing and has no API. The only thing that works is
//     telling them where the Share button is. So on iOS this is instructions.
// Anywhere else (desktop with no event, an in-app webview that can't install)
// it renders nothing rather than promising something that won't happen.
//
// Shown once. Dismissed is remembered, and it never appears when already
// installed — `display-mode: standalone` covers Android/Chrome, and
// `navigator.standalone` is the iOS-only equivalent.
const NAVY = '#1C2B3A'
const ORANGE = '#E07B2A'
const DISMISS_KEY = 'jt_a2hs_dismissed'

const isStandalone = () => {
  if (typeof window === 'undefined') return false
  try {
    if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true
  } catch { /* older browser, fall through */ }
  return window.navigator && window.navigator.standalone === true
}

// iOS Safari only. A webview inside another app (Facebook, Instagram, Gmail)
// has no Share → Add to Home Screen, so telling them to look for it is a lie —
// those are excluded.
const isIosSafari = () => {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  const ios = /iPad|iPhone|iPod/.test(ua)
  if (!ios) return false
  const inAppWebview = /FBAN|FBAV|Instagram|Line|Twitter|GSA\//.test(ua)
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)
  return isSafari && !inAppWebview
}

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState(null)
  const [show, setShow] = useState(false)
  const [iosHelp, setIosHelp] = useState(false)

  useEffect(() => {
    if (isStandalone()) return
    try { if (localStorage.getItem(DISMISS_KEY) === '1') return } catch { /* private mode */ }

    // Android/Chrome: grab the event before the browser's own mini-infobar
    // decides what to do with it, and drive the install from our own button.
    const onBip = (e) => {
      e.preventDefault()
      setDeferred(e)
      setShow(true)
    }
    window.addEventListener('beforeinstallprompt', onBip)

    // iOS has no event to wait for, so decide off the user agent instead.
    if (isIosSafari()) setShow(true)

    // If they install it while the tab is still open, get out of the way.
    const onInstalled = () => { setShow(false); try { localStorage.setItem(DISMISS_KEY, '1') } catch { /* ignore */ } }
    window.addEventListener('appinstalled', onInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', onBip)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const dismiss = useCallback(() => {
    setShow(false)
    try { localStorage.setItem(DISMISS_KEY, '1') } catch { /* private mode */ }
  }, [])

  const install = useCallback(async () => {
    if (!deferred) { setIosHelp(true); return }
    try {
      deferred.prompt()
      await deferred.userChoice
    } catch { /* they backed out — no harm, the bar just closes */ }
    setDeferred(null)
    dismiss()
  }, [deferred, dismiss])

  if (!show) return null

  const ios = !deferred

  return (
    <div
      style={{
        position: 'fixed', left: 12, right: 12,
        bottom: 'calc(150px + env(safe-area-inset-bottom))',
        zIndex: 880, // under the assistant's ✨ button (900) so it never covers it
        background: 'white', borderRadius: 14, border: '1px solid #e5e7eb',
        boxShadow: '0 8px 28px rgba(0,0,0,0.18)', padding: '12px 14px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ fontSize: 22, lineHeight: 1.1 }}>📲</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 800, color: NAVY }}>Put JobTally on your phone</div>
          <div style={{ fontSize: 12.5, color: '#6b7280', marginTop: 2, lineHeight: 1.4 }}>
            {ios
              ? 'Nothing to download — add it to your home screen and it opens like anything else.'
              : 'Nothing to download. It goes on your home screen and opens straight up.'}
          </div>
          {ios && iosHelp && (
            <div style={{ fontSize: 12.5, color: NAVY, marginTop: 8, background: '#F7F8FA', borderRadius: 9, padding: '8px 10px', lineHeight: 1.5 }}>
              1. Tap <strong>Share</strong> <span aria-hidden="true">⬆️</span> at the bottom of Safari<br />
              2. Scroll down and tap <strong>Add to Home Screen</strong><br />
              3. Tap <strong>Add</strong> — that's it
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button
              onClick={ios ? () => setIosHelp((v) => !v) : install}
              style={{ padding: '8px 14px', border: 'none', borderRadius: 9, background: ORANGE, color: 'white', fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}
            >
              {ios ? (iosHelp ? 'Got it' : 'Show me how') : 'Add it'}
            </button>
            <button
              onClick={dismiss}
              style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 9, background: 'white', color: '#6b7280', fontWeight: 600, fontSize: 13.5, cursor: 'pointer' }}
            >
              Not now
            </button>
          </div>
        </div>
        <button onClick={dismiss} aria-label="Dismiss" style={{ background: 'transparent', border: 'none', color: '#9ca3af', fontSize: 20, lineHeight: 1, cursor: 'pointer', padding: 0 }}>×</button>
      </div>
    </div>
  )
}
