import React, { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'

// What happens when a worker-invite link is opened in a browser that is
// ALREADY signed in.
//
// This is the normal case, not the edge case: the owner texts the link, then
// taps it himself to check it works — and lands on his own dashboard with the
// token silently dropped. Or the worker opens it on a phone that still holds a
// session. Before this screen, App.js only read ?invite= inside the
// `if (!session)` branch, so a signed-in visitor never saw the invite at all.
//
// The fix is a decision, not an automatic sign-out: we must never dump someone
// out of their own account because they tapped a link. So we say plainly who
// the invite is for, who they're currently signed in as, and let them pick.
//
// THE BUG THIS SCREEN USED TO HAVE, and why it mattered more than it looks:
// a crew member with no password has exactly one credential — the link his boss
// texted him. So he taps that link every morning. On any morning his session is
// still alive, App.js routes him HERE, and this screen used to gate on
// `!invite.valid` alone. A claimed link is never `valid` again (that flag means
// "unclaimed"), so the app told the right man, already signed in as himself,
// "That invite link is no longer good. Ask your boss for a fresh one." Every
// day. Nothing was broken underneath; the app just said it was.
//
// The question this screen actually has to answer is not "is this link fresh"
// but "is the person holding this phone the person the link belongs to". If yes,
// there is no decision to make and no screen to show: drop the token and let him
// into his dashboard.
export default function InviteHandoff({ token, session, onDismiss }) {
  // undefined = still resolving; null = the lookup failed outright.
  const [invite, setInvite] = useState(undefined)
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const resp = await fetch('/api/resolve-invite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token })
        })
        const data = await resp.json()
        if (!cancelled) setInvite(resp.ok ? data : null)
      } catch {
        if (!cancelled) setInvite(null)
      }
    })()
    return () => { cancelled = true }
  }, [token])

  // Sign out, then come back to the SAME invite URL. The token survives the
  // round trip, so the logged-out branch in App.js hands it to Login exactly as
  // if the link had been opened in a fresh browser. A full reload (rather than
  // a state change) also guarantees no stale account data is left in memory.
  const acceptAsNewUser = async () => {
    setSigningOut(true)
    try { await supabase.auth.signOut() } catch { /* the reload below still clears it */ }
    window.location.href = `/?invite=${encodeURIComponent(token)}`
  }

  const email = session?.user?.email || 'this account'

  // This link is MINE and I am already signed in as me. Nothing to decide.
  // Runs as an effect rather than inline so the dismiss happens after render
  // instead of setting state on a parent mid-render.
  const isMyOwnLink = !!(invite && invite.usedBy && session?.user?.id === invite.usedBy)
  // App.js passes an inline arrow, so onDismiss is a new identity every render.
  // The ref makes this fire exactly once no matter how the parent re-renders —
  // a dismiss loop here would be an infinite spinner on a crew member's phone.
  const dismissedRef = useRef(false)
  useEffect(() => {
    if (isMyOwnLink && !dismissedRef.current) {
      dismissedRef.current = true
      onDismiss()
    }
  }, [isMyOwnLink, onDismiss])

  if (invite === undefined || isMyOwnLink) {
    return <div className="loading">Checking that invite...</div>
  }

  const wrap = {
    maxWidth: '420px', margin: '48px auto', padding: '24px',
    background: 'white', borderRadius: '12px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)', textAlign: 'center'
  }
  const primary = {
    width: '100%', minHeight: '48px', marginTop: '16px', padding: '12px',
    border: 'none', borderRadius: '8px', background: '#E07B2A', color: 'white',
    fontSize: '16px', fontWeight: '700', cursor: 'pointer'
  }
  const secondary = {
    width: '100%', minHeight: '48px', marginTop: '10px', padding: '12px',
    borderRadius: '8px', border: '1px solid #D1D5DB', background: 'white',
    color: '#1C2B3A', fontSize: '15px', fontWeight: '600', cursor: 'pointer'
  }

  // Claimed, still live, but by SOMEBODY ELSE than whoever is signed in here.
  // Two real people hit this: the boss testing the link he just texted, and a
  // crew member who opened it on a shared phone. Neither of them is looking at a
  // broken link, so it must not say broken — it is a handoff, same as a fresh
  // invite, and the way through is to sign out and open it as the right person.
  if (invite && !invite.valid && invite.rejoinable) {
    const name = invite.workerName || 'your crew member'
    return (
      <div style={wrap}>
        <div style={{ fontSize: '34px', marginBottom: '8px' }}>👷</div>
        <h2 style={{ color: '#1C2B3A', marginBottom: '8px' }}>This link belongs to {name}</h2>
        <p style={{ color: '#4B5563', fontSize: '15px', lineHeight: 1.5 }}>
          It still works — it is how {name} gets back into {invite.companyName}. But this phone is
          signed in as <strong style={{ color: '#1C2B3A' }}>{email}</strong>.
        </p>
        <button style={primary} onClick={acceptAsNewUser} disabled={signingOut}>
          {signingOut ? 'Signing out...' : `Sign out & open it as ${name}`}
        </button>
        <button style={secondary} onClick={onDismiss} disabled={signingOut}>
          Stay signed in as {email}
        </button>
      </div>
    )
  }

  // Genuinely dead: revoked, never existed, or claimed by someone since removed
  // from the crew. All indistinguishable to the visitor and all fixed the same
  // way. Never leave them on a dead screen; the button carries them into the app
  // they're already signed in to.
  if (invite === null || !invite.valid) {
    return (
      <div style={wrap}>
        <h2 style={{ color: '#1C2B3A', marginBottom: '8px' }}>That invite link is no longer good</h2>
        <p style={{ color: '#4B5563', fontSize: '15px' }}>
          It's already been used, or your boss made a new one. Ask him to send you a fresh link.
        </p>
        <button style={primary} onClick={onDismiss}>Continue to JobTally</button>
      </div>
    )
  }

  const who = invite.workerName ? invite.workerName : 'Someone'

  return (
    <div style={wrap}>
      <div style={{ fontSize: '34px', marginBottom: '8px' }}>👷</div>
      <h2 style={{ color: '#1C2B3A', marginBottom: '8px' }}>
        {who} was invited to join {invite.companyName}
      </h2>
      <p style={{ color: '#4B5563', fontSize: '15px', lineHeight: 1.5 }}>
        You're signed in as <strong style={{ color: '#1C2B3A' }}>{email}</strong>.
        To accept this invite you'll need to sign out and set up the crew account.
      </p>
      <button style={primary} onClick={acceptAsNewUser} disabled={signingOut}>
        {signingOut ? 'Signing out...' : 'Sign out & accept the invite'}
      </button>
      <button style={secondary} onClick={onDismiss} disabled={signingOut}>
        Stay signed in as {email}
      </button>
      <p style={{ color: '#6B7280', fontSize: '13px', marginTop: '14px' }}>
        Staying signed in doesn't cancel the invite — the link keeps working on {invite.workerName ? `${invite.workerName}'s` : 'their'} phone.
      </p>
    </div>
  )
}
