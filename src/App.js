import React, { useState, useEffect, useRef, Suspense } from 'react'
import { supabase } from './supabaseClient'
import { captureAttribution, saveSignupAttribution } from './utils/attribution'
import { track, trackOnce, setAnalyticsUser, EV } from './utils/analytics'
import { seedSampleJob } from './utils/sampleJob'
import { legacyFreeDaysLeft, FREE_ACTIVE_JOBS } from './utils/trialWindow'
import { setErrorContext } from './utils/reportError'
import { isRecoveryUrl } from './utils/recoveryUrl'
import { readCrewKey, clearCrewKey } from './utils/crewKey'
import ErrorBoundary from './components/ErrorBoundary'
import './App.css'

// Everything below is code-split. A logged-out stranger hitting the root should
// download the landing page and nothing else — not the whole authenticated app.
// Eagerly importing the dashboards/login/billing here inverted that: the heavy
// owner dashboard rode in the main bundle and blocked the marketing page's first
// paint. Lazy() splits each screen into its own chunk, fetched only when that
// branch actually renders.
const Login = React.lazy(() => import('./pages/Login'))
const OwnerDashboard = React.lazy(() => import('./pages/OwnerDashboard'))
const WorkerDashboard = React.lazy(() => import('./pages/WorkerDashboard'))
const Billing = React.lazy(() => import('./pages/Billing'))
const Remodelers = React.lazy(() => import('./pages/Remodelers'))
const Landing = React.lazy(() => import('./pages/Landing'))
const FounderMetrics = React.lazy(() => import('./pages/FounderMetrics'))
// Public, self-contained, and lazily loaded like every other screen — the demo's
// sample data and CSS must never ride in the bundle a paying customer downloads.
const Demo = React.lazy(() => import('./pages/Demo'))
// Same reasoning: a marketing page must never ride in the bundle a paying
// customer downloads.
const Calculator = React.lazy(() => import('./pages/Calculator'))
const NotFound = React.lazy(() => import('./pages/NotFound'))
const InviteHandoff = React.lazy(() => import('./components/InviteHandoff'))
// The crew's front door. Split out like every other screen — an owner signing
// in should never download the worker-invite pitch.
const CrewInvite = React.lazy(() => import('./pages/CrewInvite'))
// The home-screen step, shown once to a brand-new crew member.
const CrewInstall = React.lazy(() => import('./components/CrewInstall'))
const ResetPassword = React.lazy(() => import('./pages/ResetPassword'))

// The first thing anyone sees, every single time the app opens — both while the
// session resolves and while a code-split screen downloads. It used to be grey
// "Loading JobTally..." on white, which reads like a page that failed rather
// than one that is arriving. Same navy and same orange as the crew screen and
// the dashboard, so the wait looks like part of the app.
const Booting = () => (
  <div style={{
    minHeight: '100vh', background: '#1C2B3A', display: 'flex',
    flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '18px'
  }}>
    <div style={{ fontSize: '30px', fontWeight: '800', letterSpacing: '-0.02em', color: 'white' }}>
      Job<span style={{ color: '#E07B2A' }}>Tally</span>
    </div>
    <div style={{
      width: '28px', height: '28px', borderRadius: '50%',
      border: '3px solid rgba(255,255,255,0.18)', borderTopColor: '#E07B2A',
      animation: 'jtspin 0.8s linear infinite'
    }} />
    <style>{'@keyframes jtspin{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){*{animation:none!important}}'}</style>
  </div>
)

// Single Suspense fallback for every code-split screen, so each return site can
// just wrap its element in <Screen>…</Screen> instead of repeating the boilerplate.
const Screen = ({ children }) => (
  <ErrorBoundary>
    <Suspense fallback={<Booting />}>{children}</Suspense>
  </ErrorBoundary>
)

export default function App() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  // undefined = subscription not yet read; null = no row / n/a (e.g. workers).
  const [sub, setSub] = useState(undefined)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  // Read once at mount, then owned by state — dismissing the handoff strips it
  // from the URL, and re-reading the querystring on every render would keep
  // resurrecting a token the visitor already declined.
  const [inviteToken, setInviteToken] = useState(
    () => new URLSearchParams(window.location.search).get('invite')
  )
  // Same deal for password recovery: the reset screen strips the spent one-time
  // token out of the address bar as soon as it's redeemed, so re-reading the URL
  // every render would kick the user off the "Password updated" confirmation and
  // onto the landing page the instant they succeeded.
  const [recovering] = useState(isRecoveryUrl)
  // Escape hatch off the one-tap crew screen: "Not Mike? / I already have a
  // login" falls back to the old email+password form, invite token and all.
  // Kept as state rather than a URL flag so a refresh returns to one-tap,
  // which is the path we actually want people on.
  const [inviteWantsForm, setInviteWantsForm] = useState(false)
  // A passwordless crew member's saved invite token (utils/crewKey.js). Read
  // once at mount: it's how a worker who tapped his home-screen icon gets back
  // in without a password, an email, or his boss.
  const [crewKey, setCrewKey] = useState(readCrewKey)
  // Set by CrewInvite the moment a brand-new worker joins. Owned as state so
  // finishing the step re-renders straight into the dashboard.
  const [crewFirstRun, setCrewFirstRun] = useState(() => {
    try { return localStorage.getItem('jt_crew_firstrun') === '1' } catch { return false }
  })
  // Has a profile read actually been attempted for the current session? The
  // last-resort "We couldn't load your account" screen is only honest AFTER
  // one has finished — before that, an empty profile just means "not fetched
  // yet". A ref, not state, so it is true synchronously and can never be a
  // render behind the thing it is guarding.
  const profileTriedRef = useRef(false)

  useEffect(() => {
    // onAuthStateChange fires INITIAL_SESSION immediately with the stored session
    // (or null), so it fully replaces a separate getSession() call — using both
    // double-fetched the profile on every mount. It then fires on every auth
    // transition thereafter.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session)
      // TOKEN_REFRESHED fires ~hourly with the same user; the profile and
      // subscription don't change, so refetching each time is wasted work.
      if (event === 'TOKEN_REFRESHED') return
      if (session) {
        // BACK TO LOADING, and this is the whole fix for the ugliest half-second
        // in the app.
        //
        // On a cold visit INITIAL_SESSION fires with null, which sets loading
        // false and renders the login form — correct. The moment you sign in,
        // SIGNED_IN fires: session becomes truthy while profile is still null
        // and loading is ALREADY false. For the one tick before fetchProfile
        // resolves, the render below skipped the loading branch, skipped the
        // logged-out branch, and fell all the way through to the last-resort
        // recovery screen: "We couldn't load your account. Back to login."
        //
        // Nothing was wrong. The profile was in flight. But the first thing a
        // brand new signup saw was an error telling them to go back, and only a
        // refresh cleared it — which is exactly the report from JP on
        // 2026-08-25. Flipping loading back on closes the window entirely.
        setLoading(true)
        // Defer out of the auth callback: invoking supabase (fetchProfile) while
        // still inside onAuthStateChange can deadlock the client's internal auth
        // lock. setTimeout(…,0) runs it on the next tick, after the lock releases.
        setTimeout(() => fetchProfile(session.user), 0)
      } else {
        setAnalyticsUser(null)
        setProfile(null)
        setSub(undefined)
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  // Referral attribution: if someone arrives via a partner link like
  // getjobtally.com/?ref=josh, remember it so we can tag their subscription
  // with the referrer at checkout (which may happen minutes or days later).
  // Sanitized + persisted; last referral link wins.
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get('ref')
    if (!raw) return
    const ref = raw.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32)
    if (ref) localStorage.setItem('jobtally_ref', ref)
  }, [])

  // Marketing attribution: persist first-touch utm_* params from any page
  // (landing pages, the app root, anywhere) so signup can record which post
  // or campaign actually brought this account in. First touch wins.
  useEffect(() => {
    captureAttribution()
  }, [])

  // NOTE: the global 'error' / 'unhandledrejection' safety net used to live here
  // as a console.error-only handler. It moved to installGlobalErrorReporting()
  // in src/index.js (2026-08-17) so that it (a) actually emails JP instead of
  // logging into a browser nobody is watching, and (b) is installed BEFORE the
  // first render, which this effect could not be — a crash during initial mount
  // fired before the listener existed and went unreported. Do not re-add it
  // here; two listeners means two reports for one bug.

  const fetchProfile = async (user) => {
    setLoadError(false)
    // Belt and braces behind the setLoading(true) above. The last-resort
    // "We couldn't load your account" screen is only honest AFTER a real
    // attempt has finished; before that, an empty profile just means "not
    // fetched yet". A ref, not state, so it is true synchronously and cannot
    // itself be a render behind.
    profileTriedRef.current = true
    // Attach every subsequent event to this account. Set before any awaits so
    // an event fired during the profile read isn't recorded as anonymous.
    setAnalyticsUser(user.id)
    try {
      let { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
      if (error) throw error

      // No profile row yet. If this account signed up with metadata (the
      // email-confirmation flow defers profile creation to first sign-in),
      // create it now from that metadata. A genuinely orphaned session with
      // no metadata falls through to the recovery screen in render.
      if (!data) {
        const md = user.user_metadata || {}
        if (md.role) {
          const { error: insErr } = await supabase.from('profiles').insert({
            id: user.id,
            email: user.email,
            full_name: md.full_name || '',
            company_name: md.role === 'owner' ? (md.company_name || null) : null,
            role: md.role,
            owner_id: md.owner_id || null
          })
          if (insErr) console.error('Profile auto-create failed:', insErr)
          // Record which campaign/post brought this account in. The utm data
          // rode along in the signup metadata (set on the device they signed
          // up from), so it survives confirming email on a different device.
          // Best-effort — never blocks account creation.
          if (!insErr) saveSignupAttribution(supabase, user.id, md.attribution || null)
          // This branch runs exactly once per account — the moment the profile
          // row comes into existence. That makes it the honest definition of
          // "signup completed", and it's tracked here rather than in the login
          // form so BOTH signup paths (instant and email-confirm) count.
          if (!insErr) track(EV.SIGNUP_COMPLETED, { role: md.role })
          // Finish claiming the invite now that the profile row exists and we
          // have a session. This is what applies the pay rate the owner set
          // when he created the invite — read server-side off the invite row,
          // never from this metadata (the worker can edit their own metadata).
          // Awaited so the profile read below already carries the rate.
          if (!insErr && md.invite_token) {
            try {
              const { data: sess } = await supabase.auth.getSession()
              await fetch('/api/claim-invite', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  ...(sess?.session?.access_token
                    ? { Authorization: `Bearer ${sess.session.access_token}` }
                    : {})
                },
                body: JSON.stringify({ token: md.invite_token })
              })
            } catch { /* best-effort — the owner can still set the rate by hand */ }
          }
          const res = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
          if (res.error) throw res.error
          data = res.data
          // Creation truly failed (error + still no row) → surface the retry
          // screen, not the "Back to login" orphaned-account recovery.
          if (insErr && !data) throw insErr
        }
      }
      // A brand-new owner would otherwise land on a completely blank dashboard.
      // Seed one finished demo job first, so the dashboard's own fetch picks it
      // up on the initial render instead of appearing after a refresh. This is
      // awaited on purpose, but it's nearly free: for any account that's already
      // been seeded it short-circuits on localStorage without touching the DB.
      if (data && data.role === 'owner') await seedSampleJob(supabase, data)

      setProfile(data)

      // So a crash email names a customer JP can call, not just a stack trace.
      // Id and role only — never the email or the name; the id is enough to
      // find them in Supabase and keeps customer PII out of an alert inbox.
      setErrorContext(data && data.id, data && data.role)

      if (data) trackOnce(EV.APP_OPENED, { role: data.role })

      // Owners carry a subscription; read it so the billing gate can decide.
      // Workers and any read failure (e.g. table not migrated yet) -> null,
      // which only ever paywalls when REACT_APP_BILLING_ENFORCED is on.
      if (data && data.role === 'owner') {
        try {
          const { data: s } = await supabase
            .from('subscriptions')
            .select('status,current_period_end')
            .eq('owner_id', user.id)
            .maybeSingle()
          setSub(s || null)
        } catch { setSub(null) }
      } else {
        setSub(null)
      }
    } catch (e) {
      // A real read/insert failure (network/RLS) — distinct from a genuinely
      // absent profile. Show a retry screen, not the sign-out recovery.
      console.error('Profile error:', e)
      setLoadError(true)
    }
    setLoading(false)
  }

  // Public marketing routes — rendered before ANY auth/billing decision so
  // they work for logged-out visitors (and logged-in ones checking the page).
  const path = window.location.pathname.replace(/\/+$/, '') || '/'
  if (path === '/remodelers') {
    return <Screen><Remodelers /></Screen>
  }
  // /demo is public and stateless — it holds its own sample data and never
  // touches Supabase, so a signed-in owner can open it too (to show somebody)
  // without it reading or writing a single row of their real account.
  if (path === '/demo') {
    return <Screen><Demo /></Screen>
  }
  // /calculator is the free job-profit calculator on its own URL. Public and
  // logged-out-safe like the two above: it computes entirely in the browser and
  // only touches Supabase if a visitor asks for their numbers by email.
  if (path === '/calculator') {
    return <Screen><Calculator /></Screen>
  }

  // Password recovery beats every other branch, including a live session. The
  // older implicit recovery link signs the user in as the page loads, so any
  // auth check ahead of this would send them to the dashboard and they'd never
  // get to actually change the password they came here to change.
  if (recovering) {
    return <Screen><ResetPassword /></Screen>
  }

  if (loading) return <Booting />
  if (!session) {
    // Logged-out visitors at the root get the public landing page, not a
    // cold login form. Auth still owns: /login, plus the two query-param
    // entries already in the wild — /?signup=1 (marketing CTAs) and
    // /?invite=<token> (worker invite links texted by owners).
    const params = new URLSearchParams(window.location.search)
    // A worker-invite link gets the crew screen, not the login form: it is the
    // one screen every crew member is guaranteed to see, and it's where the app
    // finally gets pitched to the person being asked to use it. One tap and
    // api/join-invite.js builds the account — no name, no email, no password.
    //
    // A saved crew key takes the same road. That is the point of the whole
    // home-screen push: a worker taps his icon, the session has expired, and
    // instead of the contractor marketing page he gets "Welcome back, Mike" and
    // one button. Scoped to the bare root so /demo, /pricing and the rest of the
    // public site still work normally for someone who happens to have a key.
    const resumeToken =
      inviteToken ||
      (path === '/' && crewKey && !params.has('signup') ? crewKey : null)
    if (resumeToken && !inviteWantsForm) {
      return (
        <Screen>
          <CrewInvite
            token={resumeToken}
            // True only when the token came off THIS phone's storage rather than
            // a URL — i.e. he tapped his home-screen icon and the session had
            // lapsed. CrewInvite spends it for him instead of asking for a tap
            // that has no decision behind it.
            autoResume={!inviteToken && !!crewKey}
            onJoined={() => {
              // Strip the token the instant we commit to signing in, so the
              // new session doesn't land on the signed-in handoff screen below.
              const url = new URL(window.location.href)
              url.searchParams.delete('invite')
              window.history.replaceState({}, '', url.pathname + url.search + url.hash)
              setInviteToken(null)
            }}
            onUseForm={() => setInviteWantsForm(true)}
            onDeadToken={() => {
              // Only a SAVED key gets dropped. A dead token in the URL is the
              // boss's problem to re-send, and the screen already says so.
              if (!inviteToken) { clearCrewKey(); setCrewKey(null) }
            }}
          />
        </Screen>
      )
    }
    const wantsAuth =
      path === '/login' ||
      params.has('signup') ||
      params.has('invite')
    if (wantsAuth) return <Screen><Login /></Screen>
    // The landing page belongs at the ROOT and nowhere else. It used to be the
    // catch-all, which meant vercel.json's SPA rewrite turned every unknown
    // path — every typo, every stale link, every crawler guess — into a
    // full marketing page answering HTTP 200. That "soft 404" gets junk URLs
    // indexed as real pages and splits the site's ranking across infinite
    // addresses. Anything unrecognised now gets an honest not-found screen
    // carrying <meta name="robots" content="noindex">.
    if (path === '/') return <Screen><Landing /></Screen>
    return <Screen><NotFound /></Screen>
  }
  // Signed in, and the URL still carries a worker invite. The branch above only
  // runs when logged OUT, so before this the token was silently discarded and
  // the visitor landed on whatever dashboard the existing session owned — the
  // "I opened the invite link on my phone and it took me to the page I was
  // already logged into" bug. Ahead of the role and billing branches, because
  // the whole point is that it must beat "wherever this session normally goes".
  if (inviteToken) {
    return (
      <Screen>
        <InviteHandoff
          token={inviteToken}
          session={session}
          onDismiss={() => {
            // Drop the param so a refresh (or the next render) doesn't ask again.
            const url = new URL(window.location.href)
            url.searchParams.delete('invite')
            window.history.replaceState({}, '', url.pathname + url.search + url.hash)
            setInviteToken(null)
          }}
        />
      </Screen>
    )
  }
  // Founder readout at /?metrics=1. Placed ahead of the role and billing
  // branches so it's reachable from any signed-in account — the real gate is
  // server-side (public.founder_funnel raises 'not authorized' unless the
  // caller is in app_admins), so there's nothing to protect by hiding a URL.
  if (new URLSearchParams(window.location.search).has('metrics')) {
    return <Screen><FounderMetrics /></Screen>
  }
  if (profile?.role === 'worker') {
    // One screen, once, at the only moment he is going to say yes to it: he has
    // just tapped a button and something good happened. Left to the dashboard's
    // floating nudge, a crew member skips it and then re-finds a URL every
    // morning until he quits using it. Skipping is one tap, deliberately.
    if (crewFirstRun) {
      return (
        <Screen>
          <CrewInstall
            workerName={profile.full_name}
            onDone={() => {
              try { localStorage.removeItem('jt_crew_firstrun') } catch { /* private mode */ }
              setCrewFirstRun(false)
            }}
          />
        </Screen>
      )
    }
    return <Screen><WorkerDashboard profile={profile} /></Screen>
  }
  if (profile) {
    const enforced = process.env.REACT_APP_BILLING_ENFORCED === 'true'
    const wantsBilling =
      new URLSearchParams(window.location.search).has('billing') ||
      window.location.hash === '#billing'
    const subStatus = sub && sub.status
    // Renewal-lag grace. At the exact renewal instant Stripe's charge succeeds
    // and the stored current_period_end is briefly in the past until the
    // customer.subscription.updated webhook lands (seconds, occasionally longer
    // under webhook backlog). A strict "> now" check would flash a paywall at a
    // fully-paid owner in that gap. Allowing a 24h skew bridges the lag WITHOUT
    // granting a genuinely lapsed account access, because a real cancellation
    // flips status away from active/trialing (handled by the status guard above).
    const RENEWAL_GRACE_MS = 24 * 60 * 60 * 1000
    const periodEndValid =
      !!(sub && sub.current_period_end) &&
      new Date(sub.current_period_end).getTime() > Date.now() - RENEWAL_GRACE_MS
    const active =
      // comp = grandfathered/free grant; no period end to check.
      subStatus === 'comp' ||
      // Dunning grace: a paying owner whose renewal charge just failed goes
      // past_due while Stripe retries (~2 weeks). Keep them in the app during
      // that window instead of instant-locking a real customer. When Stripe
      // exhausts retries it flips them to canceled/unpaid, which lands here as
      // active=false and locks — the correct terminal state.
      subStatus === 'past_due' ||
      // active/trialing require a REAL period end within the renewal-grace skew.
      // A null period end no longer fails open (it used to grant indefinite
      // access to a stale row).
      ((subStatus === 'active' || subStatus === 'trialing') && periodEndValid)

    // The trial is now a CARD trial: a new owner hits this paywall on their
    // first load, enters a card on Stripe Checkout, and comes back with
    // status='trialing' — 30 free days, no charge, cancel anytime. That path is
    // covered by `active` above, so there is no separate no-card grant here.
    //
    // The one exception is an account created before the cutover, which signed
    // up under the old no-card promise and keeps its window until it runs out.
    // That's grandfathering, not a live offer, and it self-expires (see
    // utils/trialWindow.js). The DB enforces the identical rule on writes
    // (public.has_app_access, FIX-DATABASE-24) — the client decides what to
    // render, the DB decides what it will accept.
    // FREE FOREVER, ONE ACTIVE JOB (2026-08-11) — this is why nobody is stopped
    // at the door any more.
    //
    // The paywall used to be HERE: no subscription, no dashboard. It now sits at
    // the SECOND job instead (OwnerDashboard's New-job button + the RLS policies
    // in FIX-DATABASE-30). Everyone gets in and can run one real job forever;
    // paying is what buys the second one.
    //
    // Why the wall moved: a contractor won't pay $150/mo for something he's
    // never watched work on his own numbers — trying it IS the sale. And a real
    // job runs 2–6 weeks, so a 30-day clock ran out mid-job on exactly the guy
    // it was meant to convince.
    //
    // The 30-day card trial is untouched and still the better deal (unlimited
    // jobs), so `active` stays first — this only changes who gets turned away.
    const hasAccess = active || legacyFreeDaysLeft(profile) !== null || FREE_ACTIVE_JOBS > 0

    // Only when enforcement is ON: wait for the subscription read before
    // deciding, so we never flash the dashboard and then yank it to a paywall.
    if (enforced && sub === undefined) return <div className="loading">Loading JobTally...</div>
    if (enforced && !hasAccess) return <Screen><Billing profile={profile} sub={sub} mode="paywall" /></Screen>
    if (wantsBilling) return <Screen><Billing profile={profile} sub={sub} mode="manage" /></Screen>
    return <Screen><OwnerDashboard profile={profile} sub={sub} billingEnforced={enforced} /></Screen>

  }
  if (loadError) return (
    <div className="loading recovery">
      <p>We couldn't reach your account. Check your connection.</p>
      <button
        onClick={() => window.location.reload()}
        style={{ marginTop: 12, padding: '10px 20px', fontSize: 16, cursor: 'pointer' }}
      >
        Try again
      </button>
    </div>
  )
  // Session exists but no profile loaded — e.g. an orphaned session after a DB
  // reset, or a failed/incomplete signup. This used to dead-end on a permanent
  // "Loading..." with no escape. Show a recovery screen that sends them back to
  // the login screen instead.
  //
  // But ONLY once a read has actually been attempted. Reaching this before that
  // is what put "We couldn't load your account. Back to login." in front of
  // every fresh sign-in for a tick. Keep waiting instead — the real attempt is
  // already scheduled, and it will land or set loadError above.
  if (!profileTriedRef.current) return <Booting />
  return (
    <div className="loading recovery">
      <p>We couldn't load your account.</p>
      <button
        onClick={() => supabase.auth.signOut()}
        style={{ marginTop: 12, padding: '10px 20px', fontSize: 16, cursor: 'pointer' }}
      >
        Back to login
      </button>
    </div>
  )
}