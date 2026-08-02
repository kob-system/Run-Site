import React, { useEffect, useState } from 'react'
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

  if (invite === undefined) {
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

  // Used, expired, or simply wrong — all indistinguishable to the visitor and
  // all fixed the same way: ask the boss for a fresh link. Never leave them on
  // a dead screen; the button carries them into the app they're signed in to.
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
