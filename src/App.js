import React, { useState, useEffect, Suspense } from 'react'
import { supabase } from './supabaseClient'
import { captureAttribution, saveSignupAttribution } from './utils/attribution'
import { track, trackOnce, setAnalyticsUser, EV } from './utils/analytics'
import { seedSampleJob } from './utils/sampleJob'
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

// Single Suspense fallback for every code-split screen, so each return site can
// just wrap its element in <Screen>…</Screen> instead of repeating the boilerplate.
const Screen = ({ children }) => (
  <ErrorBoundary>
    <Suspense fallback={<div className="loading">Loading JobTally...</div>}>{children}</Suspense>
  </ErrorBoundary>
)

export default function App() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  // undefined = subscription not yet read; null = no row / n/a (e.g. workers).
  const [sub, setSub] = useState(undefined)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

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

  // Global safety net for errors that escape React's render tree — unhandled
  // promise rejections (failed fetches, async handlers) and uncaught runtime
  // errors. Logged here; structured so a telemetry sink could report them later
  // without touching every call site. The ErrorBoundary handles render errors.
  useEffect(() => {
    const onError = (event) => {
      console.error('Global error:', event.error || event.message)
    }
    const onRejection = (event) => {
      console.error('Unhandled promise rejection:', event.reason)
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])

  const fetchProfile = async (user) => {
    setLoadError(false)
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
  if (window.location.pathname.replace(/\/+$/, '') === '/remodelers') {
    return <Screen><Remodelers /></Screen>
  }

  if (loading) return <div className="loading">Loading JobTally...</div>
  if (!session) {
    // Logged-out visitors at the root get the public landing page, not a
    // cold login form. Auth still owns: /login, plus the two query-param
    // entries already in the wild — /?signup=1 (marketing CTAs) and
    // /?invite=<token> (worker invite links texted by owners).
    const params = new URLSearchParams(window.location.search)
    const wantsAuth =
      window.location.pathname.replace(/\/+$/, '') === '/login' ||
      params.has('signup') ||
      params.has('invite')
    if (!wantsAuth) {
      return <Screen><Landing /></Screen>
    }
    return <Screen><Login /></Screen>
  }
  // Founder readout at /?metrics=1. Placed ahead of the role and billing
  // branches so it's reachable from any signed-in account — the real gate is
  // server-side (public.founder_funnel raises 'not authorized' unless the
  // caller is in app_admins), so there's nothing to protect by hiding a URL.
  if (new URLSearchParams(window.location.search).has('metrics')) {
    return <Screen><FounderMetrics /></Screen>
  }
  if (profile?.role === 'worker') return <Screen><WorkerDashboard profile={profile} /></Screen>
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

    // New owners get a 30-day no-card free window from signup — full app, no
    // Stripe — before they ever see the paywall. After that they must start a
    // (card-based) trial or subscribe. The DB enforces the same window on writes
    // (public.has_app_access), so this isn't just a client-side gate.
    //
    // Why 30 and not 7: a contractor's job runs 2-6 weeks. The entire payoff of
    // this product is "here's what that job actually made you" — at 7 days the
    // trial expired before the app could ever show it, so nobody reached the
    // moment that sells the subscription. 30 days lets one real job finish.
    // MUST stay in lockstep with the interval in public.has_app_access
    // (FIX-DATABASE-24) — the client decides what to render, the DB decides
    // what it will accept.
    const FREE_WINDOW_DAYS = 30
    const createdAt = profile.created_at ? new Date(profile.created_at) : null
    const inFreeWindow =
      !!createdAt && Date.now() - createdAt.getTime() < FREE_WINDOW_DAYS * 24 * 60 * 60 * 1000
    const hasAccess = active || inFreeWindow

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