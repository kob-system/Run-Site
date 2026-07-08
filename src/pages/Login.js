import React, { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import { getAttribution, saveSignupAttribution } from '../utils/attribution'
import buildInfo from '../buildInfo.json'

// Turn raw Supabase/auth error strings into plain language a contractor
// (or their crew) can act on, instead of leaking internal API wording.
function friendlyError(msg) {
  if (!msg) return 'Something went wrong. Please try again.'
  const m = msg.toLowerCase()
  if (m.includes('invalid login')) return "That email or password doesn't match. Please try again."
  if (m.includes('email not confirmed')) return 'Please confirm your email first — check your inbox for the link.'
  if (m.includes('already registered') || m.includes('user already')) return 'An account with that email already exists. Try signing in instead.'
  if (m.includes('password should be at least') || m.includes('at least 6')) return 'Password must be at least 6 characters.'
  if (m.includes('rate limit') || m.includes('too many')) return 'Too many attempts. Wait a minute, then try again.'
  if (m.includes('network') || m.includes('failed to fetch')) return 'Connection problem. Check your signal and try again.'
  return msg
}

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [isSignup, setIsSignup] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [name, setName] = useState('')
  const [company, setCompany] = useState('')
  const [role, setRole] = useState('owner')
  const [ownerEmail, setOwnerEmail] = useState('')
  // Owner-initiated invite (?invite=<token>): when present we already
  // know the owner, so we skip the "Boss's Email" lookup and lock the
  // signup to a worker joining that specific crew.
  const [inviteToken, setInviteToken] = useState(null)
  const [inviteOwnerId, setInviteOwnerId] = useState(null)
  const [inviteCompany, setInviteCompany] = useState('')

  // Marketing CTAs (e.g. /remodelers) land on /?signup=1 — open straight to
  // the Create Account form instead of making them find the toggle.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('signup')) setIsSignup(true)
  }, [])

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('invite')
    if (!token) return
    ;(async () => {
      try {
        const resp = await fetch('/api/resolve-invite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token })
        })
        const data = await resp.json()
        if (data && data.valid) {
          setInviteToken(token)
          setInviteOwnerId(data.ownerId)
          setInviteCompany(data.companyName || 'your boss')
          setRole('worker')
          if (data.workerName) setName(data.workerName)
          setIsSignup(true)
        } else {
          setError('This invite link is invalid or has already been used. Ask your boss to send a new one.')
        }
      } catch {
        // Network hiccup — let them sign up the normal way.
      }
    })()
  }, [])

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(friendlyError(error.message))
    setLoading(false)
  }

  // Self-serve password reset — sends a Supabase recovery link to the email
  // they typed. No separate screen needed; they land back here after resetting.
  const handleForgotPassword = async () => {
    setError(''); setNotice('')
    if (!email) { setError('Enter your email above first, then tap "Forgot password?"'); return }
    setLoading(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })
    if (error) setError(friendlyError(error.message))
    else setNotice(`Password reset link sent to ${email}. Check your inbox (and spam), then follow the link.`)
    setLoading(false)
  }

  // Re-send the signup confirmation email if the first one never arrived.
  const handleResendConfirm = async () => {
    setError(''); setNotice('')
    if (!email) { setError('Enter your email above first, then tap Resend.'); return }
    setLoading(true)
    const { error } = await supabase.auth.resend({ type: 'signup', email })
    if (error) setError(friendlyError(error.message))
    else setNotice(`Confirmation email re-sent to ${email}. Check your inbox and spam folder.`)
    setLoading(false)
  }

  const handleSignup = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setNotice('')

    let ownerId = null
    if (role === 'worker' && inviteOwnerId) {
      // Came in through an invite link — owner is already known.
      ownerId = inviteOwnerId
    } else if (role === 'worker') {
      let ownerLookup
      try {
        const resp = await fetch('/api/find-owner', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ownerEmail })
        })
        ownerLookup = await resp.json()
      } catch (err) {
        setError("Couldn't reach the server. Check your connection and try again.")
        setLoading(false)
        return
      }
      if (!ownerLookup || !ownerLookup.ownerId) {
        setError("Could not find an owner account with that email. Ask your boss to sign up first.")
        setLoading(false)
        return
      }
      ownerId = ownerLookup.ownerId
    }

    // Stash the signup details in the auth user's metadata. If email
    // confirmation is ON there's no session yet (so we can't create the
    // profile row here under RLS); App.js creates it from this metadata on
    // first sign-in instead. If confirmation is OFF we create it immediately.
    const signupMeta = {
      full_name: name,
      role,
      company_name: role === 'owner' ? company : null,
      owner_id: ownerId
    }
    // First-touch marketing attribution rides in the metadata too, so the
    // email-confirmation flow (which may finish on ANOTHER device, where
    // localStorage is empty) can still record which post brought them in.
    const attribution = getAttribution()
    if (attribution) signupMeta.attribution = attribution

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: signupMeta }
    })
    if (error) { setError(friendlyError(error.message)); setLoading(false); return }

    // Burn the invite token so the link can't be reused (best-effort —
    // the worker is already created + linked even if this call fails).
    if (inviteToken) {
      fetch('/api/claim-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: inviteToken, workerId: data.user?.id })
      }).catch(() => {})
    }

    // No session => Supabase requires email confirmation. Don't try to insert
    // the profile (it would fail RLS and orphan the account). Tell the user.
    if (!data.session) {
      setNotice(`Account created! We sent a confirmation link to ${email}. Click it, then sign in.`)
      setIsSignup(false)
      setLoading(false)
      return
    }

    // Session exists (confirmation off) — create the profile now.
    if (data.user) {
      const { error: profileError } = await supabase.from('profiles').insert({
        id: data.user.id,
        email,
        full_name: name,
        company_name: role === 'owner' ? company : null,
        role,
        owner_id: ownerId
      })
      if (profileError) {
        setError('Account created but profile setup failed: ' + profileError.message)
        setLoading(false)
        return
      }
      // Best-effort: record which campaign/ref created this account.
      saveSignupAttribution(supabase, data.user.id, attribution)
    }
    setLoading(false)
  }

  return (
    <div style={{ minHeight: '100vh', background: '#1C2B3A', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div style={{ marginBottom: '32px', textAlign: 'center' }}>
        <h1 style={{ color: '#E07B2A', fontSize: '32px', fontWeight: '800' }}>JobTally</h1>
        <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '14px', marginTop: '6px' }}>Contractor job tracking — from your phone</p>
      </div>
      <div style={{ background: 'white', borderRadius: '16px', padding: '24px', width: '100%', maxWidth: '400px', boxShadow: '0 12px 32px rgba(0,0,0,0.28)' }}>
        <h2 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '20px', color: '#1C2B3A' }}>{isSignup ? 'Create Account' : 'Sign In'}</h2>
        {error && <div className="alert-danger">{error}</div>}
        {notice && <div style={{ background: '#f0fdf4', border: '1px solid #16A34A', color: '#15803d', borderRadius: '8px', padding: '10px 12px', fontSize: '13px', fontWeight: '600', marginBottom: '12px' }}>{notice}</div>}
        <form onSubmit={isSignup ? handleSignup : handleLogin}>
          {isSignup && (
            <>
              {inviteToken && (
                <div style={{ background: '#FFF4ED', border: '1px solid #E07B2A', borderRadius: '8px', padding: '12px', fontSize: '14px', color: '#1C2B3A', marginBottom: '16px', fontWeight: '600' }}>
                  🎉 <strong>{inviteCompany}</strong> invited you to join the crew. Just set your password below to get started.
                </div>
              )}
              {!inviteToken && (
                <div className="input-group">
                  <label>I am a...</label>
                  <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                    <button type="button" aria-pressed={role === 'owner'} onClick={() => setRole('owner')} style={{ flex: 1, minHeight: '48px', padding: '12px 10px', borderRadius: '8px', border: '2px solid ' + (role === 'owner' ? '#E07B2A' : '#ddd'), background: role === 'owner' ? '#FFF4ED' : 'white', color: role === 'owner' ? '#E07B2A' : '#666', fontWeight: '600', cursor: 'pointer' }}>Contractor / Owner</button>
                    <button type="button" aria-pressed={role === 'worker'} onClick={() => setRole('worker')} style={{ flex: 1, minHeight: '48px', padding: '12px 10px', borderRadius: '8px', border: '2px solid ' + (role === 'worker' ? '#E07B2A' : '#ddd'), background: role === 'worker' ? '#FFF4ED' : 'white', color: role === 'worker' ? '#E07B2A' : '#666', fontWeight: '600', cursor: 'pointer' }}>Worker</button>
                  </div>
                </div>
              )}
              <div className="input-group"><label htmlFor="su-name">Full Name</label><input id="su-name" type="text" autoComplete="name" autoFocus={isSignup && !inviteToken} value={name} onChange={e => setName(e.target.value)} placeholder="Josh Smith" required /></div>
              {role === 'owner' && (
                <div className="input-group"><label htmlFor="su-company">Company Name</label><input id="su-company" type="text" autoComplete="organization" value={company} onChange={e => setCompany(e.target.value)} placeholder="First Class Property Services" required /></div>
              )}
              {role === 'worker' && !inviteToken && (
                <div className="input-group"><label htmlFor="su-owner">Your Boss's Email</label><input id="su-owner" type="email" inputMode="email" autoComplete="email" value={ownerEmail} onChange={e => setOwnerEmail(e.target.value)} placeholder="boss@email.com" required /></div>
              )}
            </>
          )}
          <div className="input-group"><label htmlFor="li-email">Your Email</label><input id="li-email" type="email" inputMode="email" autoComplete="email" autoFocus={!isSignup} value={email} onChange={e => setEmail(e.target.value)} placeholder="you@email.com" required /></div>
          <div className="input-group">
            <label htmlFor="li-password">Password</label>
            <div className="pw-wrap">
              <input id="li-password" type={showPw ? 'text' : 'password'} autoComplete={isSignup ? 'new-password' : 'current-password'} autoFocus={isSignup && !!inviteToken} value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required minLength={isSignup ? 6 : undefined} />
              <button type="button" className="pw-toggle" onClick={() => setShowPw(s => !s)} aria-label={showPw ? 'Hide password' : 'Show password'}>{showPw ? 'Hide' : 'Show'}</button>
            </div>
            {isSignup && <p style={{ fontSize: '12px', color: '#6B7280', margin: '6px 2px 0' }}>At least 6 characters.</p>}
            {!isSignup && (
              <p style={{ textAlign: 'right', margin: '8px 2px 0' }}>
                <button type="button" onClick={handleForgotPassword} disabled={loading} style={{ background: 'none', border: 'none', color: '#E07B2A', fontWeight: '600', fontSize: '13px', cursor: 'pointer', padding: 0 }}>Forgot password?</button>
              </p>
            )}
          </div>
          <button type="submit" className="btn-primary" disabled={loading}>{loading ? <><span className="spinner" />Working…</> : isSignup ? 'Create Account' : 'Sign In'}</button>
        </form>
        <p style={{ textAlign: 'center', marginTop: '16px', fontSize: '14px', color: '#666' }}>
          {isSignup ? 'Already have an account?' : "Don't have an account?"}
          <button onClick={() => { setIsSignup(!isSignup); setError(''); setNotice('') }} style={{ background: 'none', border: 'none', color: '#E07B2A', fontWeight: '600', cursor: 'pointer', marginLeft: '6px' }}>{isSignup ? 'Sign In' : 'Sign Up'}</button>
        </p>
        {!isSignup && notice.includes('confirmation link') && (
          <p style={{ textAlign: 'center', marginTop: '4px', fontSize: '13px', color: '#666' }}>
            Didn't get it?
            <button type="button" onClick={handleResendConfirm} disabled={loading} style={{ background: 'none', border: 'none', color: '#E07B2A', fontWeight: '600', cursor: 'pointer', marginLeft: '6px' }}>Resend email</button>
          </p>
        )}
      </div>
      <p style={{ marginTop: '18px', fontSize: '12px' }}>
        <a href="/privacy.html" target="_blank" rel="noopener noreferrer" style={{ color: 'rgba(255,255,255,0.6)', textDecoration: 'none' }}>Privacy</a>
        <span style={{ color: 'rgba(255,255,255,0.3)', margin: '0 8px' }}>·</span>
        <a href="/terms.html" target="_blank" rel="noopener noreferrer" style={{ color: 'rgba(255,255,255,0.6)', textDecoration: 'none' }}>Terms</a>
      </p>
      <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: '11px', marginTop: '10px' }}>build {buildInfo.sha} · {buildInfo.time}</p>
    </div>
  )
}