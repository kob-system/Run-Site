import React, { useState } from 'react'
import { supabase } from '../supabaseClient'

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

  const go = async (action, arg) => {
    setErr(''); setBusy(arg || action)
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
        {activeSub ? 'Your subscription' : (mode === 'paywall' ? 'Start your subscription to continue' : 'Your subscription')}
      </h3>
      {activeSub ? (
        <p style={{ color: '#667085', marginTop: 0 }}>
          {status === 'trialing'
            ? 'You’re on your free trial'
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
        // expired) — a RETURNING owner, not a new account. The 7-day free trial
        // is for new accounts only, so don't promise it again here.
        <p style={{ color: '#667085', marginTop: 0 }}>
          Your subscription isn’t active. Resubscribe below to restore full access — billing starts today
          (the free trial is for new accounts only). Your data is safe and you can cancel anytime from Manage billing.
        </p>
      ) : (
        <p style={{ color: '#667085', marginTop: 0 }}>
          New accounts start with a <strong>7-day free trial</strong> — no charge today. You enter your card on
          Stripe's secure checkout and it auto-renews after the trial. Cancel anytime from Manage billing.
        </p>
      )}

      {err && (
        <div style={{ background: '#fde8e8', color: '#9b1c1c', padding: 12, borderRadius: 10, margin: '12px 0' }}>
          {err}
        </div>
      )}

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
