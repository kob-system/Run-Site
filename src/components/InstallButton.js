import React, { useState, useCallback } from 'react'
import { useInstallPrompt } from '../utils/installPrompt'
import IosInstallGuide from './IosInstallGuide'

// The "Put it on your phone" button for the PUBLIC pages.
//
// The point: a contractor should never have to find the three-dot menu, or know
// what "add to home screen" is called on his particular phone. He taps one
// button that says what it does.
//
// On Android that is literally what happens — one tap, real install.
// On iPhone it CANNOT be, because Apple ships no install API (see
// utils/installPrompt.js). So on iOS the button opens the three steps with the
// Share icon drawn out, because "tap the square with the arrow coming out of
// it" is the part people actually get stuck on.
//
// Renders nothing on desktop, in an in-app webview, or once installed — a
// button that can't do anything is worse than no button.
const NAVY = '#1C2B3A'
const ORANGE = '#E07B2A'

export default function InstallButton({ variant = 'solid', className }) {
  const { mode, install } = useInstallPrompt()
  const [sheet, setSheet] = useState(false)
  const [busy, setBusy] = useState(false)

  const onClick = useCallback(async () => {
    if (mode === 'ios') { setSheet(true); return }
    setBusy(true)
    const outcome = await install()
    setBusy(false)
    // If Chrome refuses the stashed prompt for any reason, fall back to telling
    // them where the menu is rather than leaving a dead button.
    if (outcome === 'unavailable') setSheet(true)
  }, [mode, install])

  if (mode === 'none') return null

  const solid = variant === 'solid'

  return (
    <>
      <button
        onClick={onClick}
        disabled={busy}
        className={className}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          padding: '12px 20px', borderRadius: 10, cursor: 'pointer',
          fontWeight: 700, fontSize: 15.5, lineHeight: 1.2,
          border: solid ? 'none' : `2px solid ${NAVY}`,
          background: solid ? ORANGE : 'transparent',
          color: solid ? 'white' : NAVY,
        }}
      >
        <span aria-hidden="true" style={{ fontSize: 17 }}>📲</span>
        {busy ? 'Adding…' : 'Put it on your phone'}
      </button>

      {sheet && (
        <div
          onClick={() => setSheet(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            // The drawn guide is tall on purpose. On a short phone the sheet
            // has to scroll rather than push the "Got it" button off-screen.
            style={{ background: 'white', width: '100%', maxWidth: 520, maxHeight: '92vh', overflowY: 'auto', WebkitOverflowScrolling: 'touch', borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: '20px 20px calc(24px + env(safe-area-inset-bottom))', textAlign: 'left' }}
          >
            <div style={{ fontSize: 18, fontWeight: 800, color: NAVY, marginBottom: 4 }}>Put JobTally on your phone</div>
            <div style={{ fontSize: 14, color: '#6b7280', marginBottom: 18, lineHeight: 1.5 }}>
              There's nothing to download. Three taps and it sits on your screen like everything else.
            </div>

            <IosInstallGuide />

            <button
              onClick={() => setSheet(false)}
              style={{ width: '100%', marginTop: 18, padding: '13px', border: 'none', borderRadius: 10, background: ORANGE, color: 'white', fontWeight: 700, fontSize: 15.5, cursor: 'pointer' }}
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  )
}
