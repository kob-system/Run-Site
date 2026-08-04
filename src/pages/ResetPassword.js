import React, { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import { readRecoveryParams } from '../utils/recoveryUrl'

// Where a recovery email drops the user. Two link shapes land here:
//
//   1. ?token_hash=<hash>&type=recovery   — what our email template sends now.
//      The hash is NOT redeemed on page load; it's redeemed when they submit
//      the form. That's deliberate: Outlook/Hotmail Safe Links and other
//      corporate mail scanners pre-fetch every URL in an email, and a link
//      that signs you in just by being fetched gets burned by the scanner
//      before the human ever clicks it — which is exactly the "Email link is
//      invalid or has expired" (otp_expired) dead end this screen replaces.
//      A scanner will GET this page; it won't fill in a password and submit.
//
//   2. #access_token=…&type=recovery      — the older implicit-flow link.
//      supabase-js consumes that fragment on load and we already have a
//      session, so there's nothing to verify — just set the new password.
//      Kept so recovery emails already sitting in an inbox still work.
//
// A failed link arrives as #error=access_denied&error_code=otp_expired. We read
// that too, and offer a one-tap resend instead of a raw error string.

function friendlyLinkError(code, description) {
  if (code === 'otp_expired') {
    return 'This reset link has expired or was already used. Reset links are good for one hour and one use.'
  }
  if (code === 'access_denied') {
    return 'This reset link is no longer valid. Request a fresh one below.'
  }
  return description || 'This reset link is no longer valid. Request a fresh one below.'
}

export default function ResetPassword() {
  const [params] = useState(readRecoveryParams)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [done, setDone] = useState(false)
  // Shown when the link itself is dead — we ask for the email and resend.
  const [resendEmail, setResendEmail] = useState('')

  const linkDead = Boolean(params.errorCode)
  // No usable credential at all: no token to verify, no session from the older
  // implicit link. Treat it like a dead link so they get the resend path.
  const [noCredential, setNoCredential] = useState(false)

  useEffect(() => {
    if (linkDead) return
    if (params.tokenHash) return
    // The implicit flow needs supabase-js to have parsed the fragment into a
    // session. That happens asynchronously on load, so check rather than
    // trusting the fragment alone.
    let cancelled = false
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled && !data.session) setNoCredential(true)
    })
    return () => { cancelled = true }
  }, [linkDead, params.tokenHash])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return }
    if (password !== confirm) { setError("Those two passwords don't match."); return }

    setLoading(true)
    try {
      // Redeem the one-time hash now — on a real human submit, not on page
      // load. This is the step a mail scanner never reaches.
      if (params.tokenHash) {
        const { error: verifyError } = await supabase.auth.verifyOtp({
          token_hash: params.tokenHash,
          type: 'recovery'
        })
        if (verifyError) {
          setError(friendlyLinkError(verifyError.code, verifyError.message))
          setNoCredential(true)
          setLoading(false)
          return
        }
      }

      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) {
        // Supabase rejects reusing the current password on some projects; say
        // so plainly rather than echoing the API wording.
        setError(
          /same/i.test(updateError.message)
            ? 'That is already your password. Pick a different one.'
            : updateError.message
        )
        setLoading(false)
        return
      }

      // Strip the token out of the address bar so a back-button or a shared
      // screenshot can't replay it, then let App.js render the signed-in app.
      window.history.replaceState({}, '', '/')
      setDone(true)
    } catch (err) {
      setError('Something went wrong. Please try again.')
    }
    setLoading(false)
  }

  const handleResend = async (e) => {
    e.preventDefault()
    setError(''); setNotice('')
    if (!resendEmail) { setError('Enter your email so we know where to send it.'); return }
    setLoading(true)
    const { error: resendError } = await supabase.auth.resetPasswordForEmail(resendEmail, {
      redirectTo: `${window.location.origin}/reset-password`
    })
    if (resendError) setError(resendError.message)
    else setNotice(`New reset link sent to ${resendEmail}. It's good for one hour.`)
    setLoading(false)
  }

  const card = {
    background: 'white',
    borderRadius: '16px',
    padding: '24px',
    width: '100%',
    maxWidth: '400px',
    boxShadow: '0 12px 32px rgba(0,0,0,0.28)'
  }

  const shell = (children) => (
    <div style={{ minHeight: '100vh', background: '#1C2B3A', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div style={{ marginBottom: '32px', textAlign: 'center' }}>
        <h1 style={{ fontSize: '32px', fontWeight: '800' }}>
          <a href="/" style={{ color: '#E07B2A', textDecoration: 'none' }}>JobTally</a>
        </h1>
        <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '14px', marginTop: '6px' }}>Contractor job tracking — from your phone</p>
      </div>
      <div style={card}>{children}</div>
    </div>
  )

  if (done) {
    return shell(
      <>
        <h2 style={{ fontSize: '18px', fontWeight: '700', color: '#1C2B3A', margin: '0 0 10px' }}>Password updated</h2>
        <p style={{ fontSize: '14px', color: '#4B5563', margin: '0 0 18px' }}>
          You're signed in with your new password.
        </p>
        <button className="btn-primary" onClick={() => window.location.replace('/')}>Continue to JobTally</button>
      </>
    )
  }

  // Dead link (expired, already used, or nothing to verify) — collect the email
  // and send a fresh one, rather than dead-ending on an error.
  if (linkDead || noCredential) {
    return shell(
      <>
        <h2 style={{ fontSize: '18px', fontWeight: '700', color: '#1C2B3A', margin: '0 0 10px' }}>Get a new reset link</h2>
        <div className="alert-danger">
          {error || friendlyLinkError(params.errorCode, params.errorDescription)}
        </div>
        {notice && <div style={{ background: '#f0fdf4', border: '1px solid #16A34A', color: '#15803d', borderRadius: '8px', padding: '10px 12px', fontSize: '13px', fontWeight: '600', marginBottom: '12px' }}>{notice}</div>}
        <form onSubmit={handleResend}>
          <div className="input-group">
            <label htmlFor="rp-resend">Your Email</label>
            <input id="rp-resend" type="email" inputMode="email" autoComplete="email" value={resendEmail} onChange={e => setResendEmail(e.target.value)} placeholder="you@email.com" required />
          </div>
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? <><span className="spinner" />Sending…</> : 'Send me a new link'}
          </button>
        </form>
        <p style={{ textAlign: 'center', marginTop: '16px', fontSize: '14px' }}>
          <a href="/" style={{ color: '#E07B2A', fontWeight: '600', textDecoration: 'none' }}>Back to sign in</a>
        </p>
      </>
    )
  }

  return shell(
    <>
      <h2 style={{ fontSize: '18px', fontWeight: '700', color: '#1C2B3A', margin: '0 0 10px' }}>Set a new password</h2>
      <p style={{ fontSize: '14px', color: '#4B5563', margin: '0 0 18px' }}>
        Pick a new password for your JobTally account.
      </p>
      {error && <div className="alert-danger">{error}</div>}
      <form onSubmit={handleSubmit}>
        <div className="input-group">
          <label htmlFor="rp-password">New Password</label>
          <div className="pw-wrap">
            <input id="rp-password" type={showPw ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required minLength={6} />
            <button type="button" className="pw-toggle" onClick={() => setShowPw(s => !s)} aria-label={showPw ? 'Hide password' : 'Show password'}>{showPw ? 'Hide' : 'Show'}</button>
          </div>
          <p style={{ fontSize: '12px', color: '#6B7280', margin: '6px 2px 0' }}>At least 6 characters.</p>
        </div>
        <div className="input-group">
          <label htmlFor="rp-confirm">Confirm New Password</label>
          <input id="rp-confirm" type={showPw ? 'text' : 'password'} autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="••••••••" required minLength={6} />
        </div>
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? <><span className="spinner" />Saving…</> : 'Save new password'}
        </button>
      </form>
      <p style={{ textAlign: 'center', marginTop: '16px', fontSize: '14px' }}>
        <a href="/" style={{ color: '#E07B2A', fontWeight: '600', textDecoration: 'none' }}>Back to sign in</a>
      </p>
    </>
  )
}
