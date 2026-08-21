import React, { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import { track, EV } from '../utils/analytics'
import { saveCrewKey } from '../utils/crewKey'

// THE SCREEN EVERY CREW MEMBER IS GUARANTEED TO SEE.
//
// It used to be a login form. A guy on a roof got a bare link from his boss and
// landed on "Step 1 of 3 — Full Name", then email, then invent a password. Zero
// reason given, three fields asked, and on the other side a screen that says
// "No jobs assigned yet. Ask your boss." From his seat that is all cost and no
// benefit, which is exactly why he didn't finish — he wasn't confused, he was
// unconvinced. A how-to video does not fix unconvinced.
//
// So this screen does two jobs the form never did:
//   1. It SELLS the app to the person being asked to use it. Everything listed
//      here is already built and shipped; none of it was ever mentioned before
//      signup.
//   2. It answers the objection nobody says out loud — "my boss wants to track
//      me" — in the first few seconds, instead of on a settings page he'd reach
//      a week later.
// Then it asks for one tap. api/join-invite.js does the rest server-side; the
// owner already typed his name when he made the link, so there is nothing left
// for the worker to type.
export default function CrewInvite({ token, onJoined, onUseForm, onDeadToken }) {
  // undefined = still resolving, null = lookup failed outright.
  const [invite, setInvite] = useState(undefined)
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState('')
  const [hasVideo, setHasVideo] = useState(false)
  const mounted = useRef(true)

  useEffect(() => () => { mounted.current = false }, [])

  useEffect(() => {
    ;(async () => {
      try {
        const resp = await fetch('/api/resolve-invite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token })
        })
        const data = await resp.json()
        if (mounted.current) setInvite(resp.ok ? data : null)
      } catch {
        if (mounted.current) setInvite(null)
      }
    })()
  }, [token])

  // The 45-second crew video, when there is one. Deliberately self-activating:
  // drop the file in /public and this slot lights up, with no deploy of this
  // component. Until then the screen is complete without it — a missing video
  // must never be the reason a crew member can't join.
  //
  // We check the CONTENT TYPE, not just the status. vercel.json rewrites every
  // unknown path to index.html, so a missing file answers 200 with HTML and a
  // naive `resp.ok` would render a <video> pointed at a web page.
  useEffect(() => {
    ;(async () => {
      try {
        const r = await fetch('/crew-intro.mp4', { method: 'HEAD' })
        const type = r.headers.get('content-type') || ''
        if (mounted.current && r.ok && type.startsWith('video')) setHasVideo(true)
      } catch { /* no video, no problem */ }
    })()
  }, [])

  // A token that came from storage rather than the URL has to be thrown away
  // once the server says it's dead, or the worker's home-screen icon opens on
  // "this link has expired" every single time, forever, with no way back to the
  // rest of the site. Only fires on a DEFINITIVE answer: invite === null means
  // the lookup itself failed, which is usually just a bad signal, and deleting
  // his only credential over a dropped request would be the worse bug.
  useEffect(() => {
    if (invite && !invite.valid && !invite.rejoinable && onDeadToken) onDeadToken()
  }, [invite, onDeadToken])

  const join = async () => {
    setJoining(true)
    setError('')
    try {
      const resp = await fetch('/api/join-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      })
      const data = await resp.json()
      if (!resp.ok || !data.ok || !data.tokenHash) {
        setError(
          data.reason === 'revoked'
            ? 'Your boss turned this link off. Ask him for a new one.'
            : data.reason === 'used'
              ? 'This link already made an account. Tap "I already have a login" below.'
              : "Couldn't get you in just now. Check your signal and try again."
        )
        setJoining(false)
        return
      }

      // Drop ?invite= BEFORE redeeming the hash. The moment a session exists,
      // App.js re-renders — and a leftover token in the URL would route the
      // worker straight into the "you're signed in as someone else" handoff
      // screen he has no business seeing, one tick after joining.
      onJoined()

      // No password, no email round trip: the server minted a one-time hash and
      // this trades it for a real session. `magiclink` is the type the admin
      // generate_link endpoint issues; older gotrue builds label the same hash
      // `email`, so fall back rather than strand someone on a version skew.
      let { error: otpError } = await supabase.auth.verifyOtp({
        token_hash: data.tokenHash,
        type: 'magiclink'
      })
      if (otpError) {
        const retry = await supabase.auth.verifyOtp({
          token_hash: data.tokenHash,
          type: 'email'
        })
        otpError = retry.error
      }
      if (otpError) {
        setError("Almost. That didn't take, so tap the link your boss sent you one more time.")
        setJoining(false)
        return
      }
      // Keep his token on his own phone. With no password this link is the only
      // thing that can sign him in again, and "go find the text your boss sent
      // six weeks ago" is not a recovery path a crew member completes.
      saveCrewKey(token)
      if (!data.returning) {
        track(EV.SIGNUP_COMPLETED, { role: 'worker', via: 'one_tap_invite' })
        // Brand new, so the next screen he sees is the home-screen step rather
        // than the dashboard. Set here and not in App.js because this is the
        // only place that knows the difference between a first join and a
        // returning worker tapping his link again on a phone he already set up.
        try { localStorage.setItem('jt_crew_firstrun', '1') } catch { /* private mode */ }
      }
      // Success is a re-render into WorkerDashboard, driven by the auth state
      // change. Deliberately leave `joining` true so the button stays in its
      // working state for the split second before this screen unmounts.
    } catch {
      setError("Couldn't reach the server. Check your signal and try again.")
      setJoining(false)
    }
  }

  // ---- styling, kept inline to match the other auth screens ----
  // The pitch is taller than a phone screen, so the button does NOT sit at the
  // bottom of it. It's pinned to the bottom of the VIEWPORT: the one thing this
  // screen asks for must never be something you have to go looking for. Hence
  // the bottom padding on the page — it reserves the space the bar floats over.
  const page = { minHeight: '100vh', background: '#1C2B3A', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px 16px 132px' }
  const bar = { position: 'fixed', left: 0, right: 0, bottom: 0, background: '#1C2B3A', borderTop: '1px solid rgba(255,255,255,0.12)', padding: '12px 16px calc(12px + env(safe-area-inset-bottom))', boxShadow: '0 -8px 24px rgba(0,0,0,0.35)', zIndex: 20 }
  const barInner = { maxWidth: '420px', margin: '0 auto' }
  const card = { background: 'white', borderRadius: '16px', padding: '22px', width: '100%', maxWidth: '420px', boxShadow: '0 12px 32px rgba(0,0,0,0.28)' }
  const primary = { width: '100%', minHeight: '54px', marginTop: '18px', padding: '14px', border: 'none', borderRadius: '10px', background: '#E07B2A', color: 'white', fontSize: '17px', fontWeight: '800', cursor: 'pointer' }
  const quiet = { background: 'none', border: 'none', color: '#E07B2A', fontWeight: '700', fontSize: '13px', cursor: 'pointer', padding: '4px' }

  if (invite === undefined) {
    return <div className="loading">Loading your invite...</div>
  }

  // The whole ask, in one place. Rendered inside the pinned bar on the live
  // screen and inline on the dead-link screen, so the two can't drift apart.
  const cta = (label) => (
    <button style={primary} onClick={join} disabled={joining}>
      {joining ? <><span className="spinner" />Getting you in&hellip;</> : label}
    </button>
  )

  // Dead link. Never leave a worker on a screen with nothing to tap — the way
  // out is his boss, so say that, and still offer the sign-in door in case he
  // is an old-flow worker who does have a password.
  if (invite === null || (!invite.valid && !invite.rejoinable)) {
    return (
      <div style={{ ...page, padding: '24px 16px' }}>
        <div style={card}>
          <h2 style={{ color: '#1C2B3A', marginBottom: '8px', fontSize: '20px' }}>
            {invite && invite.revoked ? 'This link was turned off' : 'This link has expired'}
          </h2>
          <p style={{ color: '#4B5563', fontSize: '15px', lineHeight: 1.5 }}>
            Text your boss and ask him to send you a new one. It takes him about five seconds.
          </p>
          <button style={primary} onClick={onUseForm}>I already have a login</button>
        </div>
      </div>
    )
  }

  const company = invite.companyName || 'Your boss'
  const firstName = (invite.workerName || '').trim().split(/\s+/)[0]
  const returning = !invite.valid && invite.rejoinable

  const benefit = (icon, title, body) => (
    <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', marginTop: '14px' }}>
      <div style={{ fontSize: '20px', lineHeight: '24px', width: '24px', textAlign: 'center', flex: '0 0 auto' }} aria-hidden="true">{icon}</div>
      <div>
        <div style={{ fontWeight: '700', color: '#1C2B3A', fontSize: '15px' }}>{title}</div>
        <div style={{ color: '#4B5563', fontSize: '14px', lineHeight: 1.45 }}>{body}</div>
      </div>
    </div>
  )

  return (
    <div style={page}>
      <h1 style={{ fontSize: '26px', fontWeight: '800', marginBottom: '18px' }}>
        <span style={{ color: '#E07B2A' }}>JobTally</span>
      </h1>

      <div style={card}>
        <div style={{ fontSize: '32px', marginBottom: '6px' }} aria-hidden="true">👷</div>
        {firstName && (
          <div style={{ color: '#6B7280', fontSize: '14px', fontWeight: '700', marginBottom: '2px' }}>
            {returning ? 'Welcome back,' : 'Hey'} {firstName}
          </div>
        )}
        <h2 style={{ color: '#1C2B3A', fontSize: '21px', lineHeight: 1.25, margin: '0 0 6px' }}>
          {returning
            ? <>You&rsquo;re still on the <strong>{company}</strong> crew</>
            : <><strong>{company}</strong> put you on the crew</>}
        </h2>
        <p style={{ color: '#4B5563', fontSize: '15px', margin: 0 }}>
          {returning
            ? 'Tap below and you’re straight back into your hours. Same as always, no password.'
            : 'This is how you clock in and out from your own phone, and how you check what you’re owed without asking anybody.'}
        </p>

        {hasVideo && (
          <video
            controls
            playsInline
            preload="metadata"
            poster="/crew-intro.jpg"
            style={{ width: '100%', borderRadius: '10px', marginTop: '16px', background: '#000' }}
          >
            <source src="/crew-intro.mp4" type="video/mp4" />
          </video>
        )}

        {!returning && (
          <div style={{ marginTop: '6px' }}>
            {benefit('⏱️', 'Your hours, as you work them',
              'Clock in, clock out. Your week’s hours and what they add up to are on your screen, not just his.')}
            {benefit('💵', 'Check your own check',
              'Every shift for the last 30 days, with the job it was on. Nobody’s memory decides what you get paid.')}
            {benefit('📅', 'Put in for a day off',
              'Ask for time off right from the app. Your boss gets it and answers there.')}
          </div>
        )}

        {/* The unspoken objection is surveillance, and it kills crew adoption.
            This exact sentence already existed in the app — but only AFTER
            signup, where it could not do the one job it is good at. */}
        <div style={{ marginTop: '18px', background: '#F3F6F9', border: '1px solid #E2E8F0', borderRadius: '10px', padding: '12px 14px' }}>
          <div style={{ fontWeight: '700', color: '#1C2B3A', fontSize: '14px', marginBottom: '4px' }}>
            🔒 About the location thing
          </div>
          <div style={{ color: '#4B5563', fontSize: '13.5px', lineHeight: 1.5 }}>
            Your location is stamped twice, once when you clock in and once when you clock out, so
            your hours can never be disputed. Nothing is tracked in between, and nothing while
            you&rsquo;re clocked out.
          </div>
        </div>

        <p style={{ color: '#6B7280', fontSize: '12.5px', margin: '16px 2px 0', lineHeight: 1.45, textAlign: 'center' }}>
          Nothing to download. No password to make up. It&rsquo;s free for you, forever. Your boss
          pays for it.
        </p>

        {/* The escape hatch. Rare, but a worker who needs one and finds no door
            is a worker who texts his boss instead of joining. */}
        <p style={{ textAlign: 'center', marginTop: '12px', borderTop: '1px solid #F1F5F9', paddingTop: '10px' }}>
          <button type="button" style={quiet} onClick={onUseForm}>
            {firstName ? `Not ${firstName}?` : 'Not you?'} Sign up with an email instead
          </button>
        </p>
      </div>

      <p style={{ marginTop: '18px', fontSize: '12px' }}>
        <a href="/privacy.html" target="_blank" rel="noopener noreferrer" style={{ color: 'rgba(255,255,255,0.6)', textDecoration: 'none' }}>Privacy</a>
        <span style={{ color: 'rgba(255,255,255,0.3)', margin: '0 8px' }}>·</span>
        <a href="/terms.html" target="_blank" rel="noopener noreferrer" style={{ color: 'rgba(255,255,255,0.6)', textDecoration: 'none' }}>Terms</a>
      </p>

      <div style={bar}>
        <div style={barInner}>
          {error && <div className="alert-danger" style={{ marginBottom: '8px' }}>{error}</div>}
          {cta(returning ? 'Get me back in' : firstName ? `Yep, that’s me. Let’s go` : 'Join the crew')}
        </div>
      </div>
    </div>
  )
}
