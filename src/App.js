import React, { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import Login from './pages/Login'
import OwnerDashboard from './pages/OwnerDashboard'
import WorkerDashboard from './pages/WorkerDashboard'
import Billing from './pages/Billing'
import './App.css'

export default function App() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  // undefined = subscription not yet read; null = no row / n/a (e.g. workers).
  const [sub, setSub] = useState(undefined)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) fetchProfile(session.user)
      else setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session) fetchProfile(session.user)
      else { setProfile(null); setLoading(false) }
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

  const fetchProfile = async (user) => {
    setLoadError(false)
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
          const res = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
          if (res.error) throw res.error
          data = res.data
          // Creation truly failed (error + still no row) → surface the retry
          // screen, not the "Back to login" orphaned-account recovery.
          if (insErr && !data) throw insErr
        }
      }
      setProfile(data)

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

  if (loading) return <div className="loading">Loading JobTally...</div>
  if (!session) return <Login />
  if (profile?.role === 'worker') return <WorkerDashboard profile={profile} />
  if (profile) {
    const enforced = process.env.REACT_APP_BILLING_ENFORCED === 'true'
    const wantsBilling =
      new URLSearchParams(window.location.search).has('billing') ||
      window.location.hash === '#billing'
    const active =
      sub &&
      ['active', 'trialing', 'comp'].includes(sub.status) &&
      (!sub.current_period_end || new Date(sub.current_period_end) > new Date())

    // New owners get a 7-day no-card free window from signup — full app, no
    // Stripe — before they ever see the paywall. After that they must start a
    // (card-based) trial or subscribe. The DB enforces the same window on writes
    // (public.has_app_access), so this isn't just a client-side gate.
    const FREE_WINDOW_DAYS = 7
    const createdAt = profile.created_at ? new Date(profile.created_at) : null
    const inFreeWindow =
      !!createdAt && Date.now() - createdAt.getTime() < FREE_WINDOW_DAYS * 24 * 60 * 60 * 1000
    const hasAccess = active || inFreeWindow

    // Only when enforcement is ON: wait for the subscription read before
    // deciding, so we never flash the dashboard and then yank it to a paywall.
    if (enforced && sub === undefined) return <div className="loading">Loading JobTally...</div>
    if (enforced && !hasAccess) return <Billing profile={profile} mode="paywall" />
    if (wantsBilling) return <Billing profile={profile} mode="manage" />
    return <OwnerDashboard profile={profile} />
  }
  if (loadError) return (
    <div className="loading">
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
    <div className="loading">
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