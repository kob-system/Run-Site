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

export default function Billing({ profile, mode = 'manage' }) {
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')

  const go = async (action, arg) => {
    setErr(''); setBusy(arg || action)
    try {
      const { url } =
        action === 'portal'
          ? await authedPost('create-billing-portal', {})
          : await authedPost('create-checkout-session', { plan: arg })
      window.location.href = url
    } catch (e) {
      setErr(e.message); setBusy('')
    }
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '32px 20px' }}>
      <h2 style={{ color: 'var(--orange)', fontWeight: 800, letterSpacing: '0.02em', marginBottom: 4 }}>JobTally</h2>
      <h3 style={{ margin: '0 0 4px' }}>
        {mode === 'paywall' ? 'Start your subscription to continue' : 'Your subscription'}
      </h3>
      <p style={{ color: '#667085', marginTop: 0 }}>
        Pick a plan. You enter your card on Stripe's secure checkout and it auto-renews —
        cancel anytime from Manage billing.
      </p>

      {err && (
        <div style={{ background: '#fde8e8', color: '#9b1c1c', padding: 12, borderRadius: 10, margin: '12px 0' }}>
          {err}
        </div>
      )}

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 16 }}>
        <div style={card}>
          <div style={{ fontWeight: 700, color: '#1C2B3A' }}>Monthly</div>
          <div style={{ fontSize: 28, fontWeight: 800 }}>$200<span style={{ fontSize: 15, fontWeight: 500, color: '#667085' }}>/mo</span></div>
          <div style={{ color: '#667085', fontSize: 14 }}>Billed monthly. Cancel anytime.</div>
          <button style={btn} disabled={!!busy} onClick={() => go('checkout', 'monthly')}>
            {busy === 'monthly' ? 'Starting…' : 'Choose monthly'}
          </button>
        </div>

        <div style={{ ...card, borderColor: '#1C2B3A', borderWidth: 2 }}>
          <div style={{ fontWeight: 700, color: '#1C2B3A' }}>Yearly <span style={{ color: '#0a7d33', fontSize: 13 }}>· 2 months free</span></div>
          <div style={{ fontSize: 28, fontWeight: 800 }}>$2,000<span style={{ fontSize: 15, fontWeight: 500, color: '#667085' }}>/yr</span></div>
          <div style={{ display: 'inline-block', alignSelf: 'flex-start', background: 'var(--green-tint)', color: 'var(--green-dark)', fontSize: 13, fontWeight: 700, padding: '4px 10px', borderRadius: 20, marginTop: 4 }}>Save $400 vs. monthly</div>
          <button style={btn} disabled={!!busy} onClick={() => go('checkout', 'yearly')}>
            {busy === 'yearly' ? 'Starting…' : 'Choose yearly'}
          </button>
        </div>
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
