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
//
// ── 2026-08-28: THIS SCREEN IS ONE DECISION, NOT A COMPARISON ────────────────
// It used to open with a five-step "what you're about to run" tour, then two
// side-by-side plan cards of equal weight, then a data-safety panel, then two
// more buttons. Somebody who arrives here has ALREADY used the product free and
// has already decided; every extra element between them and Stripe is a place
// to change their mind. So: one sentence, one big button (monthly, the default
// everyone picks), yearly demoted to a line underneath, everything else below
// the fold.
//
// The wallet line is not decoration. Stripe Checkout shows Apple Pay / Google
// Pay / Link automatically on a device that has them — but only if those methods
// are switched on in the Stripe Dashboard (Settings -> Payments -> Payment
// methods). We deliberately do NOT send payment_method_types from
// api/create-checkout-session, because sending it PINS the list to cards and
// kills the wallets. If wallets ever stop appearing, check the Dashboard first
// and that file second.

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

const primaryBtn = {
  width: '100%', padding: '17px 20px', fontSize: 18, fontWeight: 800, borderRadius: 12,
  border: 'none', background: 'var(--orange)', color: '#fff', cursor: 'pointer', minHeight: 56,
}
const quietBtn = {
  padding: '12px 16px', fontSize: 15, fontWeight: 700, borderRadius: 10,
  background: 'transparent', cursor: 'pointer', minHeight: 44,
}

export default function Billing({ profile, sub, mode = 'manage' }) {
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [showExtras, setShowExtras] = useState(false)

  // An owner with a live subscription (or one in the grace/past-due window)
  // shouldn't be pitched the plan at all — show them their status and the
  // Manage-billing button only. 'comp' = a grandfathered/free grant; treat it
  // like an active sub so a comp'd owner can't start a paid checkout that the
  // webhook would then overwrite on top of their grant.
  const status = sub && sub.status
  const activeSub = ['active', 'trialing', 'past_due', 'comp'].includes(status)
  const periodEnd = sub && sub.current_period_end ? new Date(sub.current_period_end) : null

  // The paywall is the single most expensive screen in the product — it's where
  // a free account either turns into money or churns. Once per tab so a
  // re-render doesn't inflate it. `status` is a fixed enum, not PII.
  useEffect(() => {
    if (mode === 'paywall') trackOnce(EV.PAYWALL_HIT, { status: status || 'none' })
  }, [mode, status])

  const go = async (action, arg) => {
    setErr(''); setBusy(arg || action)
    // Fired before the redirect, so the drop-off between "tapped subscribe" and
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
    <div style={{ maxWidth: 460, margin: '0 auto', padding: '32px 20px 48px' }}>
      <h2 style={{ color: 'var(--orange)', fontWeight: 800, letterSpacing: '0.02em', marginBottom: 18, fontSize: 20 }}>JobTally</h2>

      {err && (
        <div style={{ background: '#fde8e8', color: '#9b1c1c', padding: 12, borderRadius: 10, margin: '0 0 14px' }}>
          {err}
        </div>
      )}

      {activeSub ? (
        <>
          <h3 style={{ margin: '0 0 6px', fontSize: 22, color: '#1C2B3A' }}>
            {status === 'past_due' ? 'Your last payment didn’t go through' : 'Your subscription is active'}
          </h3>
          <p style={{ color: '#667085', marginTop: 0, fontSize: 15, lineHeight: 1.5 }}>
            {status === 'past_due'
              ? 'Update your card and everything carries on. Nothing has shut off.'
              : 'Unlimited jobs, unlimited crew.'}
            {periodEnd ? ` ${status === 'past_due' ? 'Retry by' : 'Renews'} ${periodEnd.toLocaleDateString()}.` : ''}
          </p>
          <button onClick={() => go('portal')} disabled={!!busy} style={{ ...primaryBtn, marginTop: 14 }}>
            {busy === 'portal' ? 'Opening…' : 'Manage billing'}
          </button>
        </>
      ) : (
        <>
          <h3 style={{ margin: '0 0 6px', fontSize: 22, color: '#1C2B3A', lineHeight: 1.25 }}>
            Run as many jobs as you want.
          </h3>
          <p style={{ color: '#667085', marginTop: 0, marginBottom: 22, fontSize: 15, lineHeight: 1.5 }}>
            Every feature, unlimited crew, no per-seat charges. Cancel any time and you drop straight
            back to the free plan with everything still in it.
          </p>

          <div style={{ textAlign: 'center', marginBottom: 18 }}>
            <div style={{ fontSize: 52, fontWeight: 800, color: '#1C2B3A', lineHeight: 1 }}>
              $150<span style={{ fontSize: 20, fontWeight: 600, color: '#667085' }}>/mo</span>
            </div>
          </div>

          <button style={primaryBtn} disabled={!!busy} onClick={() => go('checkout', 'monthly')}>
            {busy === 'monthly' ? 'Opening checkout…' : 'Subscribe'}
          </button>

          {/* Said out loud because it is the difference between "I'll do it at
              my desk later" and thumb-print, done. Stripe only renders the
              wallet the device actually has, so this stays honest either way. */}
          <p style={{ textAlign: 'center', fontSize: 13, color: '#667085', margin: '12px 0 0' }}>
             Apple Pay, Google Pay, or card. Secure checkout by Stripe.
          </p>

          <p style={{ textAlign: 'center', margin: '18px 0 0' }}>
            <button
              onClick={() => go('checkout', 'yearly')}
              disabled={!!busy}
              style={{ ...quietBtn, border: '2px solid #d9e0ea', color: '#1C2B3A', width: '100%' }}
            >
              {busy === 'yearly' ? 'Opening checkout…' : 'Pay yearly instead — $1,200 (save $600)'}
            </button>
          </p>
        </>
      )}

      {/* Everything that is not the decision. Collapsed, because on the paywall
          it is exactly the material that makes someone put the phone down. */}
      <p style={{ textAlign: 'center', marginTop: 26 }}>
        <button
          onClick={() => setShowExtras((s) => !s)}
          style={{ ...quietBtn, border: 'none', color: '#667085', fontSize: 14, fontWeight: 600 }}
        >
          {showExtras ? 'Hide' : 'Your data, and other options'}
        </button>
      </p>

      {showExtras && (
        <div style={{ marginTop: 4, background: '#f7f9fc', border: '1px solid #e3e8ef', borderRadius: 12, padding: 16 }}>
          <p style={{ color: '#425466', fontSize: 14, margin: '0 0 12px', lineHeight: 1.55 }}>
            Nothing is ever deleted if you cancel. Your jobs, receipts, hours and invoices stay in your
            account, and you can download a full copy any time — including after you cancel.
          </p>
          <button
            onClick={exportData}
            disabled={!!busy}
            style={{ ...quietBtn, border: '2px solid #1C2B3A', color: '#1C2B3A', width: '100%' }}
          >
            {busy === 'export' ? 'Preparing…' : 'Export all my data'}
          </button>
          {!activeSub && (
            <button
              onClick={() => go('portal')}
              disabled={!!busy}
              style={{ ...quietBtn, border: 'none', color: '#667085', width: '100%', marginTop: 8, fontSize: 14 }}
            >
              {busy === 'portal' ? 'Opening…' : 'Manage billing / past invoices'}
            </button>
          )}
        </div>
      )}

      <div style={{ marginTop: 22, textAlign: 'center' }}>
        {mode === 'paywall' ? (
          <button
            onClick={() => supabase.auth.signOut()}
            style={{ background: 'none', border: 'none', color: '#98a2b3', cursor: 'pointer', fontSize: 14 }}
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
