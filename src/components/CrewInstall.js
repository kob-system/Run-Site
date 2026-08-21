import React, { useCallback, useState } from 'react'
import { useInstallPrompt } from '../utils/installPrompt'
import IosInstallGuide from './IosInstallGuide'
import { readCrewKey } from '../utils/crewKey'

// THE STEP RIGHT AFTER A CREW MEMBER JOINS: put it on his phone.
//
// Why this exists when InstallPrompt already does: timing and weight. That one
// is a small dismissible bubble that floats over a dashboard, competing with
// everything else on screen, and it is aimed at an owner who is already using
// the app daily. A brand-new crew member is a different case. He has used the
// app for four seconds, he will not come looking for this later, and if he
// closes the tab without installing he goes back to hunting for a URL every
// morning, which in practice means he stops.
//
// The one moment he is most willing is the moment he just tapped a button and
// something good happened. So this is a full screen, once, right there.
//
// It is skippable in one tap, on purpose. A crew member who feels trapped by
// his boss's app is the exact failure mode this whole flow exists to avoid.
const NAVY = '#1C2B3A'
const ORANGE = '#E07B2A'

export default function CrewInstall({ workerName, onDone }) {
  const { mode, install } = useInstallPrompt()
  const [busy, setBusy] = useState(false)
  const [showSteps, setShowSteps] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)

  const firstName = (workerName || '').trim().split(/\s+/)[0]

  const doInstall = useCallback(async () => {
    setBusy(true)
    const outcome = await install()
    setBusy(false)
    if (outcome === 'accepted') { onDone(); return }
    // Chrome refused the stashed prompt, so fall back to showing where the menu
    // is rather than leaving a button that visibly did nothing.
    if (outcome === 'unavailable') setShowSteps(true)
  }, [install, onDone])

  // His own link, handed back to him to keep. This is the honest answer to "what
  // if I get signed out": with no password, the invite link IS the key, and a
  // worker who has saved it never has to ask his boss for anything.
  const key = readCrewKey()
  const myLink = key ? `${window.location.origin}/?invite=${encodeURIComponent(key)}` : ''

  const shareLink = useCallback(async () => {
    const text = `My JobTally login. Keep this: ${myLink}`
    if (navigator.share) {
      try { await navigator.share({ text }); setLinkCopied(true); return } catch { /* fall through */ }
    }
    try { await navigator.clipboard.writeText(text); setLinkCopied(true) } catch { setLinkCopied(true) }
  }, [myLink])

  const page = { minHeight: '100vh', background: NAVY, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px 16px' }
  const card = { background: 'white', borderRadius: '16px', padding: '22px', width: '100%', maxWidth: '440px', boxShadow: '0 12px 32px rgba(0,0,0,0.28)' }
  const primary = { width: '100%', minHeight: '54px', marginTop: '16px', padding: '14px', border: 'none', borderRadius: '10px', background: ORANGE, color: 'white', fontSize: '17px', fontWeight: '800', cursor: 'pointer' }
  const quiet = { background: 'none', border: 'none', color: '#6B7280', fontWeight: '700', fontSize: '13.5px', cursor: 'pointer', padding: '10px', width: '100%', marginTop: '6px' }

  // iOS gets the drawn walkthrough, because Apple ships no install API and the
  // part people quit on is finding the Share button, not understanding the
  // words. Android gets one real button. Desktop and in-app webviews get the
  // "you're all set" version, because there is nothing honest to offer there.
  const canOneTap = mode === 'android'
  const isIos = mode === 'ios'

  return (
    <div style={page}>
      <div style={card}>
        <div style={{ fontSize: '30px', marginBottom: '4px' }} aria-hidden="true">✅</div>
        <h2 style={{ color: NAVY, fontSize: '21px', lineHeight: 1.25, margin: '0 0 6px' }}>
          {firstName ? `You're in, ${firstName}.` : "You're in."}
        </h2>

        {mode === 'none' && !showSteps ? (
          <>
            <p style={{ color: '#4B5563', fontSize: '15px', margin: 0, lineHeight: 1.5 }}>
              Bookmark this page so you can get straight back to it tomorrow.
            </p>
            <button style={primary} onClick={onDone}>Take me to my clock</button>
          </>
        ) : (
          <>
            <p style={{ color: '#4B5563', fontSize: '15px', margin: 0, lineHeight: 1.5 }}>
              One more thing worth ten seconds: put it on your home screen. Then it&rsquo;s an icon
              you tap, not a web address you have to go find every morning.
            </p>

            <div style={{ marginTop: '14px', background: '#F3F6F9', border: '1px solid #E2E8F0', borderRadius: '10px', padding: '12px 14px', color: '#4B5563', fontSize: '13.5px', lineHeight: 1.5 }}>
              There is <strong>nothing to download</strong>. No app store, no account, no space used
              on your phone. It just sits there like any other icon.
            </div>

            {showSteps || isIos ? (
              <div style={{ marginTop: '18px' }}>
                <IosInstallGuide />
              </div>
            ) : null}

            {canOneTap && !showSteps && (
              <button style={primary} onClick={doInstall} disabled={busy}>
                {busy ? 'Adding…' : '📲 Put it on my phone'}
              </button>
            )}

            <button style={showSteps || isIos ? primary : quiet} onClick={onDone}>
              {showSteps || isIos ? 'Done, take me to my clock' : 'Skip for now'}
            </button>
          </>
        )}

        {/* His key, offered once, where losing it would actually cost him. */}
        {myLink && (
          <div style={{ marginTop: '16px', borderTop: '1px solid #F1F5F9', paddingTop: '14px' }}>
            <div style={{ fontWeight: '700', color: NAVY, fontSize: '14px', marginBottom: '2px' }}>
              🔑 Save your link
            </div>
            <div style={{ color: '#6B7280', fontSize: '13px', lineHeight: 1.5, marginBottom: '10px' }}>
              You have no password to remember. If you ever open the app and it asks you to sign in,
              tapping this link puts you straight back in. Send it to yourself so you always have it.
            </div>
            <button
              onClick={shareLink}
              style={{ width: '100%', minHeight: '44px', padding: '10px', borderRadius: '10px', border: '1px solid #D1D5DB', background: 'white', color: NAVY, fontSize: '14.5px', fontWeight: '700', cursor: 'pointer' }}
            >
              {linkCopied ? 'Saved ✓' : 'Send myself my link'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
