import React, { useState, useEffect, useRef } from 'react'
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

  // Self-serve password reset — sends a recovery link to the email they typed.
  // The link opens /reset-password, where they choose the new password.
  const handleForgotPassword = async () => {
    setError(''); setNotice('')
    if (!email) { setError('Enter your email above first, then tap "Forgot password?"'); return }
    setLoading(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      // Land on the dedicated reset screen, not the app root — the root has no
      // way to set a new password, so a recovery link there just signed people
      // in and left the old password in place.
      redirectTo: `${window.location.origin}/reset-password`
    })
    if (error) setError(friendlyError(error.message))
    else setNotice(`Password reset link sent to ${email}. Check your inbox (and spam) — the link works once and expires in an hour.`)
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
    // Carry the invite token so App.js can finish the claim on first sign-in
    // (confirmation-ON flow). The token only identifies which invite to burn —
    // the pay rate itself is read server-side off that invite row, never from
    // metadata, which the worker could edit.
    if (inviteToken) signupMeta.invite_token = inviteToken
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

    // Burn the invite token so the link can't be reused (best-effort — the
    // worker is already created + linked even if this call fails). Sending the
    // session token when we have one lets the server record used_by from a
    // verified JWT, not a client value.
    const claimInvite = () => {
      if (!inviteToken) return
      fetch('/api/claim-invite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(data.session?.access_token
            ? { Authorization: `Bearer ${data.session.access_token}` }
            : {})
        },
        body: JSON.stringify({ token: inviteToken })
      }).catch(() => {})
    }

    // No session => Supabase requires email confirmation. Don't try to insert
    // the profile (it would fail RLS and orphan the account). Tell the user.
    if (!data.session) {
      // Still burn the link now; App.js calls claim again (with a session) on
      // first sign-in, which is when the pay rate can finally be applied.
      claimInvite()
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
      // Claim AFTER the profile row exists so the server can stamp the pay
      // rate the owner set on the invite onto it in the same call.
      claimInvite()
    }
    setLoading(false)
  }

  // ---- Step-by-step flow: show ONE field at a time, advance on "Next" ----
  const [step, setStep] = useState(0)
  const activeRef = useRef(null)

  // Ordered list of fields for the current mode. Recomputed each render, so
  // switching Sign In/Create Account or owner/worker reshapes the remaining
  // steps automatically.
  const steps = (() => {
    if (!isSignup) return ['email', 'password']
    if (inviteToken) return ['name', 'email', 'password']
    return ['role', 'name', role === 'owner' ? 'company' : 'ownerEmail', 'email', 'password']
  })()
  const stepKey = steps[Math.min(step, steps.length - 1)]
  const isLastStep = step >= steps.length - 1

  // Jump back to the first field whenever we switch between Sign In / Sign Up.
  useEffect(() => { setStep(0) }, [isSignup])

  // Auto-focus the field on screen each time the step changes, so they can
  // just start typing and hit Enter/Next without tapping into the box.
  useEffect(() => {
    const t = setTimeout(() => activeRef.current && activeRef.current.focus(), 40)
    return () => clearTimeout(t)
  }, [step, isSignup, stepKey])

  const emailOk = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((v || '').trim())

  // Validate just the field currently on screen before moving on.
  const validateStep = () => {
    switch (stepKey) {
      case 'name': if (!name.trim()) return 'Please enter your name.'; break
      case 'company': if (!company.trim()) return 'Please enter your company name.'; break
      case 'ownerEmail': if (!emailOk(ownerEmail)) return "Enter your boss's email address."; break
      case 'email': if (!emailOk(email)) return 'Enter a valid email address.'; break
      case 'password':
        if (!password) return 'Please enter your password.'
        if (isSignup && password.length < 6) return 'Password must be at least 6 characters.'
        break
      default: break
    }
    return ''
  }

  // One submit handler for the form: Enter or the button advances a step —
  // or on the final step, actually signs in / creates the account.
  const handleNext = (e) => {
    e.preventDefault()
    const msg = validateStep()
    if (msg) { setError(msg); return }
    setError('')
    if (!isLastStep) { setStep((s) => s + 1); return }
    if (isSignup) handleSignup(e); else handleLogin(e)
  }

  const goBack = () => { setError(''); setStep((s) => Math.max(0, s - 1)) }

  const roleBtn = (val, label) => (
    <button
      type="button"
      aria-pressed={role === val}
      onClick={() => setRole(val)}
      style={{ flex: 1, minHeight: '48px', padding: '12px 10px', borderRadius: '8px', border: '2px solid ' + (role === val ? '#E07B2A' : '#ddd'), background: role === val ? '#FFF4ED' : 'white', color: role === val ? '#E07B2A' : '#666', fontWeight: '600', cursor: 'pointer' }}
    >{label}</button>
  )

  return (
    <div style={{ minHeight: '100vh', background: '#1C2B3A', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div style={{ marginBottom: '32px', textAlign: 'center' }}>
        <h1 style={{ fontSize: '32px', fontWeight: '800' }}>
          <a href="/" style={{ color: '#E07B2A', textDecoration: 'none' }}>JobTally</a>
        </h1>
        <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '14px', marginTop: '6px' }}>Contractor job tracking — from your phone</p>
      </div>
      <div style={{ background: 'white', borderRadius: '16px', padding: '24px', width: '100%', maxWidth: '400px', boxShadow: '0 12px 32px rgba(0,0,0,0.28)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: '700', color: '#1C2B3A', margin: 0 }}>{isSignup ? 'Create Account' : 'Sign In'}</h2>
          <span style={{ marginLeft: 'auto', fontSize: '12px', fontWeight: '600', color: '#9CA3AF' }}>Step {step + 1} of {steps.length}</span>
        </div>
        {/* Progress: one segment per field, filled up to the current step */}
        <div style={{ display: 'flex', gap: '6px', marginBottom: '18px' }} aria-hidden="true">
          {steps.map((_, i) => (
            <div key={i} style={{ height: '4px', borderRadius: '2px', flex: 1, background: i <= step ? '#E07B2A' : '#E5E7EB', transition: 'background .2s ease' }} />
          ))}
        </div>
        {error && <div className="alert-danger">{error}</div>}
        {notice && <div style={{ background: '#f0fdf4', border: '1px solid #16A34A', color: '#15803d', borderRadius: '8px', padding: '10px 12px', fontSize: '13px', fontWeight: '600', marginBottom: '12px' }}>{notice}</div>}
        <form onSubmit={handleNext}>
          {isSignup && inviteToken && step === 0 && (
            <div style={{ background: '#FFF4ED', border: '1px solid #E07B2A', borderRadius: '8px', padding: '12px', fontSize: '14px', color: '#1C2B3A', marginBottom: '16px', fontWeight: '600' }}>
              🎉 <strong>{inviteCompany}</strong> invited you to join the crew. Set your name, then a password, to get started.
            </div>
          )}

          {stepKey === 'role' && (
            <div className="input-group">
              <label>I am a...</label>
              <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                {roleBtn('owner', 'Contractor / Owner')}
                {roleBtn('worker', 'Worker')}
              </div>
            </div>
          )}

          {stepKey === 'name' && (
            <div className="input-group"><label htmlFor="su-name">Full Name</label><input ref={activeRef} id="su-name" type="text" autoComplete="name" value={name} onChange={e => setName(e.target.value)} placeholder="Mike Reynolds" required /></div>
          )}

          {stepKey === 'company' && (
            <div className="input-group"><label htmlFor="su-company">Company Name</label><input ref={activeRef} id="su-company" type="text" autoComplete="organization" value={company} onChange={e => setCompany(e.target.value)} placeholder="Reynolds Contracting" required /></div>
          )}

          {stepKey === 'ownerEmail' && (
            <div className="input-group"><label htmlFor="su-owner">Your Boss's Email</label><input ref={activeRef} id="su-owner" type="email" inputMode="email" autoComplete="email" value={ownerEmail} onChange={e => setOwnerEmail(e.target.value)} placeholder="boss@email.com" required /></div>
          )}

          {stepKey === 'email' && (
            <div className="input-group"><label htmlFor="li-email">Your Email</label><input ref={activeRef} id="li-email" type="email" inputMode="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@email.com" required /></div>
          )}

          {stepKey === 'password' && (
            <div className="input-group">
              <label htmlFor="li-password">Password</label>
              <div className="pw-wrap">
                <input ref={activeRef} id="li-password" type={showPw ? 'text' : 'password'} autoComplete={isSignup ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required minLength={isSignup ? 6 : undefined} />
                <button type="button" className="pw-toggle" onClick={() => setShowPw(s => !s)} aria-label={showPw ? 'Hide password' : 'Show password'}>{showPw ? 'Hide' : 'Show'}</button>
              </div>
              {isSignup && <p style={{ fontSize: '12px', color: '#6B7280', margin: '6px 2px 0' }}>At least 6 characters.</p>}
              {!isSignup && (
                <p style={{ textAlign: 'right', margin: '8px 2px 0' }}>
                  <button type="button" onClick={handleForgotPassword} disabled={loading} style={{ background: 'none', border: 'none', color: '#E07B2A', fontWeight: '600', fontSize: '13px', cursor: 'pointer', padding: 0 }}>Forgot password?</button>
                </p>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
            {step > 0 && (
              <button type="button" onClick={goBack} disabled={loading} style={{ flex: '0 0 auto', minWidth: '88px', minHeight: '48px', padding: '12px 16px', borderRadius: '8px', border: '2px solid #ddd', background: 'white', color: '#666', fontWeight: '700', cursor: 'pointer' }}>Back</button>
            )}
            <button type="submit" className="btn-primary" disabled={loading} style={{ flex: 1, width: 'auto', marginTop: 0 }}>{loading ? <><span className="spinner" />Working…</> : isLastStep ? (isSignup ? 'Create Account' : 'Sign In') : 'Next'}</button>
          </div>
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