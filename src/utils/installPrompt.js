import { useState, useEffect, useCallback } from 'react'

// One source of truth for "put JobTally on your phone."
//
// ⚠️ THE THING TO KNOW BEFORE CHANGING ANY OF THIS:
// A one-tap install is only possible on Chrome/Android. **iOS has no install
// API at all** — Apple never shipped `beforeinstallprompt`, and no amount of
// JavaScript can add a site to an iPhone's home screen. On iOS the only honest
// move is showing the Share → Add to Home Screen steps clearly enough that a
// non-technical guy can follow them. Any "one-tap install" promise on iPhone is
// a lie the browser will not honor.
//
// So: Android gets a real button. iOS gets the best instructions we can draw.
// Everything else gets nothing, because a button that can't work is worse than
// no button.

// Already installed? Then nothing here should ever render.
// `display-mode: standalone` covers Chrome/Android; `navigator.standalone` is
// the iOS-only equivalent Apple never replaced.
export function isStandalone() {
  if (typeof window === 'undefined') return false
  try {
    if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true
  } catch { /* older browser — fall through to the iOS check */ }
  return window.navigator && window.navigator.standalone === true
}

// iOS Safari only. A webview inside another app (Facebook, Instagram, Gmail,
// Google's in-app browser) has no Share → Add to Home Screen, so telling those
// users to look for it sends them hunting for a button that isn't there.
export function isIosSafari() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  // iPadOS 13+ reports as a Mac — the touch-point check is what separates an
  // iPad from a desktop Safari.
  const iPadOS = /Macintosh/.test(ua) && typeof document !== 'undefined' && navigator.maxTouchPoints > 1
  if (!/iPad|iPhone|iPod/.test(ua) && !iPadOS) return false
  const inAppWebview = /FBAN|FBAV|Instagram|Line|Twitter|GSA\/|WebView/.test(ua)
  const otherBrowser = /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)
  return !inAppWebview && !otherBrowser
}

// Returns what the UI actually needs to decide what to draw:
//   mode: 'android' → a real install button, one tap, it works
//         'ios'     → a button that opens instructions (no API exists)
//         'none'    → draw nothing
export function useInstallPrompt() {
  const [evt, setEvt] = useState(() => (typeof window !== 'undefined' ? window.__jtInstallEvent : null))
  const [installed, setInstalled] = useState(isStandalone)

  useEffect(() => {
    // The event may already be sitting in window from the head script (it
    // usually is — that's the whole reason the head script exists).
    if (window.__jtInstallEvent) setEvt(window.__jtInstallEvent)
    const onReady = () => setEvt(window.__jtInstallEvent)
    const onDone = () => { setEvt(null); setInstalled(true) }
    window.addEventListener('jt-installable', onReady)
    window.addEventListener('jt-installed', onDone)
    return () => {
      window.removeEventListener('jt-installable', onReady)
      window.removeEventListener('jt-installed', onDone)
    }
  }, [])

  const install = useCallback(async () => {
    const e = evt || (typeof window !== 'undefined' ? window.__jtInstallEvent : null)
    if (!e) return 'unavailable'
    try {
      e.prompt()
      const choice = await e.userChoice
      // Chrome only ever honors a stashed prompt once — drop it either way so a
      // second tap doesn't silently no-op.
      window.__jtInstallEvent = null
      setEvt(null)
      return choice && choice.outcome === 'accepted' ? 'accepted' : 'dismissed'
    } catch {
      return 'unavailable'
    }
  }, [evt])

  const ios = isIosSafari()
  const mode = installed ? 'none' : evt ? 'android' : ios ? 'ios' : 'none'

  return { mode, installed, install }
}
