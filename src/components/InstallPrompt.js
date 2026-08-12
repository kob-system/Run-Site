import React, { useState, useCallback } from 'react'
import { useInstallPrompt } from '../utils/installPrompt'
import InstallButton from './InstallButton'

// The in-app nudge: a dismissible card on the dashboards that offers to put
// JobTally on the phone.
//
// Why it exists: the single best answer to "I'm not making my guys download
// something" is that there IS nothing to download — it's a web page that can
// sit on the home screen like anything else. That was true the whole time and
// the app never once said so, so nobody did it. The crew kept re-finding a URL
// every morning instead of tapping an icon.
//
// The platform logic (who can actually install, and who only gets shown where
// the Share button is) lives in utils/installPrompt.js — shared with the
// public-page InstallButton so the two can never disagree. Read the warning at
// the top of that file before changing any of this: iOS has no install API.
//
// Shown once. Dismissal is remembered, and it never appears when already
// installed.
const NAVY = '#1C2B3A'
const DISMISS_KEY = 'jt_a2hs_dismissed'

export default function InstallPrompt() {
  const { mode } = useInstallPrompt()
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY) === '1' } catch { return false }
  })

  const dismiss = useCallback(() => {
    setDismissed(true)
    try { localStorage.setItem(DISMISS_KEY, '1') } catch { /* private mode */ }
  }, [])

  if (dismissed || mode === 'none') return null

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
        <div style={{ fontSize: 22, lineHeight: 1.1 }} aria-hidden="true">📲</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 800, color: NAVY }}>Put JobTally on your phone</div>
          <div style={{ fontSize: 12.5, color: '#6b7280', marginTop: 2, lineHeight: 1.4 }}>
            Nothing to download. It goes on your home screen and opens straight up.
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <InstallButton />
            <button
              onClick={dismiss}
              style={{ padding: '10px 14px', border: '1px solid #d1d5db', borderRadius: 10, background: 'white', color: '#6b7280', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}
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
