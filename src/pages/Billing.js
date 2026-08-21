import React, { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import { track, trackOnce, EV } from '../utils/analytics'

// Self-contained billing screen. Two modes:
//   mode="paywall" — shown instead of the dashboard when billing is enforced and
//                    the owner has no active subscription.
//   mode="manage"  — shown on demand (URL ?billing) so an owner can subscribe or
//                    open the Stripe portal at any time.
// It does NOT import or touch OwnerDashboard, so it can't trigger the TDZ traps
// in that file.

async function authedPost(path, body) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session && session.access_token
  if (!token) throw new Error('Please sign in again')
  const r = await fetch('/api/' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(body || {}),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || 'Something went wrong')
  return data
}

const card = {
  border: '1px solid #e3e8ef', borderRadius: 14, padding: 24, flex: 1, minWidth: 240,
  background: '#fff', display: 'flex', flexDirection: 'column', gap: 6,
}
const btn = {
  marginTop: 14, padding: '12px 16px', fontSize: 16, fontWeight: 700, borderRadius: 10,
  border: 'none', background: 'var(--orange)', color: '#fff', cursor: 'pointer', minHeight: 44,
}

// A brand-new owner hits this screen seconds after signing up, before they have
// seen a single thing the product does. Plan cards alone read as a toll booth,
// so the same five steps the dashboard walks them through get shown here first:
// the card is a door into something specific, not a wall.
const CYCLE = [
  ['Set the job', 'Client, contract price, materials and labor budget.'],
  ['Put the crew on it', 'They clock in from their own phone, stamped where they stood.'],
  ['Feed it costs', 'Snap the receipt. It reads the store, total and tax off the photo.'],
  ['Watch the number', 'Spent vs. budget, live. Amber at 80%, red if you go over.'],
  ['Close it out', 'Invoice it, mark it paid, and the real profit on that job is locked in.'],
]

function Onramp() {
  return (
    <div style={{ marginTop: 18, border: '1px solid #e3e8ef', borderRadius: 14, padding: '18px 20px', background: '#fff' }}>
      <div style={{ fontWeight: 800, color: '#1C2B3A', fontSize: 17 }}>What you're about to run</div>
      <p style={{ color: '#667085', fontSize: 14, margin: '4px 0 14px' }}>
        Five steps. Same five on every job, start to finish.
      </p>
      <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {CYCLE.map(([title, detail], i) => (
          <li key={title} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <span style={{
              flex: 'none', width: 26, height: 26, borderRadius: '50%', background: '#1C2B3A', color: '#fff',
              fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 1,
            }}>{i + 1}</span>
            <span>
              <strong style={{ color: '#1C2B3A', fontSize: 15, display: 'block' }}>{title}</strong>
              <span style={{ color: '#667085', fontSize: 13.5, lineHeight: 1.45 }}>{detail}</span>
            </span>
          </li>
        ))}
      </ol>
      <p style={{ color: '#425466', fontSize: 14, margin: '16px 0 0', paddingTop: 14, borderTop: '1px solid #eef2f6' }}>
        Pick a plan below and you land straight on your dashboard with a sample job already in it.
        Your first real job takes about two minutes to set up.
      </p>
    </div>
  )
}

export default function Billing({ profile, sub, mode = 'manage' }) {
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')

  // An owner with a live subscription (or one in the grace/past-due window)
  // shouldn't be pitched the plan cards or the "no charge today" trial line —
  // show them their status and the Manage-billing button only.
  // 'comp' = a grandfathered/free account (e.g. a partner grant). Treat it like an
  // active sub for UI purposes: no plan cards, no "no charge today" pitch — so a
  // comp'd owner can't accidentally start a paid checkout that the webhook would
  // then overwrite on top of their grant.
  const status = sub && sub.status
  const activeSub = ['active', 'trialing', 'past_due', 'comp'].includes(status)
  const periodEnd = sub && sub.current_period_end ? new Date(sub.current_period_end) : null

  // The paywall is the single most expensive screen in the product — it's where
  // a trial either turns into money or turns into a churned account. Once per
  // tab so a re-render doesn't inflate it. `status` is a fixed enum, not PII.
  useEffect(() => {
    if (mode === 'paywall') trackOnce(EV.PAYWALL_HIT, { status: status || 'none' })
  }, [mode, status])

  const go = async (action, arg) => {
    setErr(''); setBusy(arg || action)
    // Fired before the redirect, so the drop-off between "clicked a plan" and
    // "Stripe webhook says subscribed" is measurable.
    if (action === 'checkout') track(EV.CHECKOUT_STARTED, { plan: arg, mode })
    try {
      const ref = (typeof localStorage !== 'undefined' && localStorage.getItem('jobtally_ref')) || undefined
      const { url } =
        action === 'portal'
          ? await authedPost('create-billing-portal', {})
          : await authedPost('create-checkout-session', { plan: arg, ref })
      window.location.href = url
    } catch (e) {
      setErr(e.message); setBusy('')
    }
  }

  // Data retention: an owner can always download a full copy of their records,
  // even after cancelling — reads are never gated, so their data is never
  // trapped behind the paywall. Pulls each owner-scoped table (RLS returns only
  // their own rows) and downloads one JSON backup.
  const exportData = async () => {
    setErr(''); setBusy('export')
    try {
      const tables = [
        'projects', 'receipts', 'time_entries', 'invoices', 'estimates',
        'change_orders', 'material_items', 'daily_logs', 'punch_items',
        'job_photos', 'warranties',
      ]
      const dump = { exported_at: new Date().toISOString(), account: profile && profile.email }
      for (const t of tables) {
        const { data, error } = await supabase.from(t).select('*')
        if (!error) dump[t] = data || []
      }
      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `jobtally-data-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      setErr('Export failed: ' + e.message)
    }
    setBusy('')
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '32px 20px' }}>
      <h2 style={{ color: 'var(--orange)', fontWeight: 800, letterSpacing: '0.02em', marginBottom: 4 }}>JobTally</h2>
      <h3 style={{ margin: '0 0 4px' }}>
        {activeSub
          ? 'Your subscription'
          : mode === 'paywall'
          // A brand-new owner (no sub row at all) now lands here on their FIRST
          // load — the card trial replaced the no-card window, so this is a
          // welcome screen, not a cutoff. A RETURNING owner (`status` exists but
          // isn't active) really is cut off, and gets the old heading.
          ? (status ? 'Pick up where you left off' : 'Start free — no card')
          : 'Your subscription'}
      </h3>
      {activeSub ? (
        <p style={{ color: '#667085', marginTop: 0 }}>
          {status === 'trialing'
            ? 'You’re on the free plan'
            : status === 'past_due'
            ? 'Your last payment didn’t go through — update your card to avoid interruption'
            : 'Your subscription is active'}
          {periodEnd
            ? ` — ${status === 'trialing' ? 'trial ends' : status === 'past_due' ? 'retry by' : 'renews'} ${periodEnd.toLocaleDateString()}`
            : ''}
          . Use <strong>Manage billing</strong> below to change your plan, update your card, or cancel.
        </p>
      ) : status ? (
        // A prior sub row exists but it's not active (canceled / unpaid /
        // expired) — a RETURNING owner, not a new account. Since 2026-08-11 this
        // is NOT a lockout: they drop to the free plan and keep running one job.
        // Saying "restore full access" at someone who still has access reads as
        // a scare tactic, and they'll find out it's untrue in about ten seconds.
        <p style={{ color: '#667085', marginTop: 0 }}>
          You’re on the <strong>free plan</strong> — one job at a time, for as long as you want, and all your
          data is right where you left it. Subscribe below to run as many jobs at once as you like. Billing
          starts today (the one job free, forever is for new accounts only) and you can cancel anytime.
        </p>
      ) : (
        <p style={{ color: '#667085', marginTop: 0 }}>
          <strong>One job is free, forever</strong>, with <strong>no card</strong>. A subscription is what lets you run more
          than one job at the same time. Billing starts the day you subscribe, through Stripe's secure checkout.
          Cancel anytime from Manage billing and you drop straight back to the
          <strong> free plan: one job at a time, forever</strong>. Nothing is ever deleted and nothing shuts off mid-job.
        </p>
      )}

      {err && (
        <div style={{ background: '#fde8e8', color: '#9b1c1c', padding: 12, borderRadius: 10, margin: '12px 0' }}>
          {err}
        </div>
      )}

      {/* Brand-new owner only. A returning owner already knows what the app does;
          showing them the tour again would just delay the button they came for. */}
      {!activeSub && !status && <Onramp />}

      {!activeSub && (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 16 }}>
          <div style={card}>
            <div style={{ fontWeight: 700, color: '#1C2B3A' }}>Monthly</div>
            <div style={{ fontSize: 28, fontWeight: 800 }}>$150<span style={{ fontSize: 15, fontWeight: 500, color: '#667085' }}>/mo</span></div>
            <div style={{ color: '#667085', fontSize: 14 }}>All features, unlimited crew. Cancel anytime.</div>
            <button style={btn} disabled={!!busy} onClick={() => go('checkout', 'monthly')}>
              {busy === 'monthly' ? 'Starting…' : 'Choose monthly'}
            </button>
          </div>

          <div style={{ ...card, borderColor: '#1C2B3A', borderWidth: 2 }}>
            <div style={{ fontWeight: 700, color: '#1C2B3A' }}>Yearly <span style={{ color: '#0a7d33', fontSize: 13 }}>· 4 months free</span></div>
            <div style={{ fontSize: 28, fontWeight: 800 }}>$1,200<span style={{ fontSize: 15, fontWeight: 500, color: '#667085' }}>/yr</span></div>
            <div style={{ display: 'inline-block', alignSelf: 'flex-start', background: 'var(--green-tint)', color: 'var(--green-dark)', fontSize: 13, fontWeight: 700, padding: '4px 10px', borderRadius: 20, marginTop: 4 }}>Save $600 vs. monthly</div>
            <button style={btn} disabled={!!busy} onClick={() => go('checkout', 'yearly')}>
              {busy === 'yearly' ? 'Starting…' : 'Choose yearly'}
            </button>
          </div>
        </div>
      )}

      <div style={{ marginTop: 24, background: '#f0f6ff', border: '1px solid #cfe0f5', borderRadius: 12, padding: 16 }}>
        <div style={{ fontWeight: 700, color: '#1C2B3A', marginBottom: 4 }}>🔒 Your data is safe</div>
        <p style={{ color: '#425466', fontSize: 14, margin: '0 0 12px' }}>
          Nothing is ever deleted if you cancel — your jobs, receipts, hours and invoices stay in your account.
          You can download a full copy anytime.
        </p>
        <button
          onClick={exportData}
          disabled={!!busy}
          style={{ ...btn, marginTop: 0, background: 'transparent', color: '#1C2B3A', border: '2px solid #1C2B3A' }}
        >
          {busy === 'export' ? 'Preparing…' : 'Export all my data'}
        </button>
      </div>

      <div style={{ marginTop: 24, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          onClick={() => go('portal')}
          disabled={!!busy}
          style={{ ...btn, background: 'transparent', color: 'var(--orange)', border: '2px solid var(--orange)', marginTop: 0 }}
        >
          {busy === 'portal' ? 'Opening…' : 'Manage billing'}
        </button>
        {mode === 'paywall' ? (
          <button
            onClick={() => supabase.auth.signOut()}
            style={{ background: 'none', border: 'none', color: '#667085', cursor: 'pointer', fontSize: 14 }}
          >
            Sign out
          </button>
        ) : (
          <a href="/" style={{ color: '#667085', fontSize: 14 }}>← Back to dashboard</a>
        )}
      </div>
    </div>
  )
}
