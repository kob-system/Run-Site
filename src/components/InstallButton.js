import React, { useState, useCallback } from 'react'
import { useInstallPrompt } from '../utils/installPrompt'

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

// Apple's share glyph, drawn rather than described. Nobody knows the word
// "share sheet"; everybody recognizes the box with the arrow out the top.
function ShareGlyph({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ verticalAlign: '-3px' }}>
      <path d="M12 3v13" />
      <path d="M8 7l4-4 4 4" />
      <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    </svg>
  )
}

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
            style={{ background: 'white', width: '100%', maxWidth: 520, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: '20px 20px calc(24px + env(safe-area-inset-bottom))', textAlign: 'left' }}
          >
            <div style={{ fontSize: 18, fontWeight: 800, color: NAVY, marginBottom: 4 }}>Put JobTally on your phone</div>
            <div style={{ fontSize: 14, color: '#6b7280', marginBottom: 16, lineHeight: 1.5 }}>
              There's nothing to download. Three taps and it sits on your screen like everything else.
            </div>

            {[
              { n: 1, body: <>Tap the <strong>Share</strong> button <span style={{ display: 'inline-flex', color: '#007AFF' }}><ShareGlyph /></span> — it's at the <strong>bottom</strong> of the screen in Safari.</> },
              { n: 2, body: <>Scroll down the list and tap <strong>Add to Home Screen</strong>.</> },
              { n: 3, body: <>Tap <strong>Add</strong> in the top corner. That's it — it's on your phone.</> },
            ].map((s) => (
              <div key={s.n} style={{ display: 'flex', gap: 12, marginBottom: 14, alignItems: 'flex-start' }}>
                <div style={{ flex: '0 0 26px', height: 26, borderRadius: 13, background: NAVY, color: 'white', fontWeight: 800, fontSize: 13.5, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{s.n}</div>
                <div style={{ fontSize: 14.5, color: NAVY, lineHeight: 1.5, paddingTop: 2 }}>{s.body}</div>
              </div>
            ))}

            <div style={{ fontSize: 12.5, color: '#9ca3af', lineHeight: 1.5, marginTop: 4 }}>
              Not seeing Share at the bottom? You're probably in Facebook or Instagram's built-in
              browser — tap the ••• and choose <strong>Open in Safari</strong> first.
            </div>

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
