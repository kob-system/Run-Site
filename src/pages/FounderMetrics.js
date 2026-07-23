import React, { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'

// The founder readout, at /?metrics=1.
//
// Analytics nobody looks at is theatre. product_events only pays off if there's
// somewhere to read it, so this screen is the other half of that feature: one
// call to public.founder_funnel() (SECURITY DEFINER, FIX-DATABASE-24) which
// returns the entire funnel as a single jsonb blob — counts only, never another
// customer's rows. Anyone not in public.app_admins gets 'not authorized' from
// the database itself, so this screen has nothing to hide behind a secret URL.

const wrap = {
  maxWidth: 960, margin: '0 auto', padding: '28px 18px 60px',
  fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', color: '#0f172a',
}
const grid = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12,
}
const tile = {
  border: '1px solid #e3e8ef', borderRadius: 12, padding: '14px 16px', background: '#fff',
}
const tileLabel = { fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.04em' }
const tileValue = { fontSize: 26, fontWeight: 800, marginTop: 4, lineHeight: 1.1 }
const h2 = { fontSize: 15, fontWeight: 800, margin: '28px 0 10px', color: '#334155' }
const barRow = { display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', fontSize: 14 }

const nf = (n) => (typeof n === 'number' ? n.toLocaleString('en-US') : '—')

// One number in a box.
function Tile({ label, value, hint }) {
  return (
    <div style={tile}>
      <div style={tileLabel}>{label}</div>
      <div style={tileValue}>{nf(value)}</div>
      {hint ? <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{hint}</div> : null}
    </div>
  )
}

// A {name: count} object rendered as a proportional bar list. Used for the
// event breakdown and the traffic sources, both of which are open-ended.
function BarList({ data, empty }) {
  const entries = Object.entries(data || {}).sort((a, b) => b[1] - a[1])
  if (!entries.length) return <div style={{ fontSize: 14, color: '#94a3b8' }}>{empty}</div>
  const max = entries[0][1] || 1
  return (
    <div>
      {entries.map(([name, n]) => (
        <div key={name} style={barRow}>
          <div style={{ width: 190, flexShrink: 0, fontFamily: 'ui-monospace, monospace', fontSize: 13 }}>
            {name}
          </div>
          <div style={{ flex: 1, background: '#f1f5f9', borderRadius: 4, height: 10, overflow: 'hidden' }}>
            <div style={{ width: `${Math.max(2, (n / max) * 100)}%`, height: '100%', background: 'var(--orange, #f97316)' }} />
          </div>
          <div style={{ width: 56, textAlign: 'right', fontWeight: 700 }}>{nf(n)}</div>
        </div>
      ))}
    </div>
  )
}

export default function FounderMetrics() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true); setErr('')
    try {
      const { data: d, error } = await supabase.rpc('founder_funnel')
      if (error) {
        // Two failures worth telling apart: not on the allow-list, versus the
        // migration simply hasn't been run in the SQL editor yet.
        const msg = String(error.message || '')
        if (/not authorized/i.test(msg)) setErr('Not authorized. This account is not in app_admins.')
        else if (/(does not exist|schema cache|404)/i.test(msg)) {
          setErr('founder_funnel() not found — run FIX-DATABASE-24-growth-engine.sql in the Supabase SQL editor.')
        } else setErr(msg || 'Could not load metrics.')
      } else {
        setData(d)
      }
    } catch (e) {
      setErr(e.message || 'Could not load metrics.')
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  if (loading) return <div className="loading">Loading metrics...</div>

  if (err) {
    return (
      <div style={wrap}>
        <h1 style={{ fontSize: 22, fontWeight: 800 }}>Metrics</h1>
        <p style={{ color: '#b91c1c', marginTop: 10 }}>{err}</p>
        <button onClick={load} style={{ marginTop: 12, padding: '10px 18px', fontSize: 15, cursor: 'pointer' }}>
          Try again
        </button>
        <p style={{ marginTop: 20 }}>
          <a href="/" style={{ color: '#f97316', fontWeight: 700 }}>← Back to the app</a>
        </p>
      </div>
    )
  }

  const d = data || {}
  // Activation rate is the number that actually matters: of everyone who signed
  // up, how many put a REAL job in (the seeded demo job is excluded server-side).
  const activation = d.owners_total ? Math.round((d.owners_with_job / d.owners_total) * 100) : 0
  const paying = (d.subs_active || 0) + (d.subs_past_due || 0)
  const conversion = d.owners_total ? Math.round((paying / d.owners_total) * 100) : 0

  return (
    <div style={wrap}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>JobTally — funnel</h1>
        <div style={{ fontSize: 12, color: '#94a3b8' }}>
          {d.generated_at ? new Date(d.generated_at).toLocaleString() : ''}
          <button onClick={load} style={{ marginLeft: 10, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>
            Refresh
          </button>
        </div>
      </div>

      <div style={h2}>THE TWO NUMBERS</div>
      <div style={grid}>
        <Tile label="Activation" value={activation} hint={`${nf(d.owners_with_job)} of ${nf(d.owners_total)} made a real job`} />
        <Tile label="Paid conversion" value={conversion} hint={`${nf(paying)} paying of ${nf(d.owners_total)} signups`} />
      </div>

      <div style={h2}>ACCOUNTS</div>
      <div style={grid}>
        <Tile label="Owners" value={d.owners_total} />
        <Tile label="New (7d)" value={d.owners_7d} />
        <Tile label="New (30d)" value={d.owners_30d} />
        <Tile label="Workers" value={d.workers_total} />
      </div>

      <div style={h2}>DID THEY ACTUALLY USE IT</div>
      <div style={grid}>
        <Tile label="Made a real job" value={d.owners_with_job} hint="demo job excluded" />
        <Tile label="Real jobs" value={d.real_jobs_total} />
        <Tile label="Added a receipt" value={d.owners_with_receipt} />
        <Tile label="Logged time" value={d.owners_with_time} />
      </div>

      <div style={h2}>MONEY</div>
      <div style={grid}>
        <Tile label="Active" value={d.subs_active} />
        <Tile label="Trialing" value={d.subs_trialing} />
        <Tile label="Past due" value={d.subs_past_due} hint="chase these" />
        <Tile label="Canceled" value={d.subs_canceled} />
      </div>

      <div style={h2}>EVENTS — LAST 7 DAYS ({nf(d.events_7d)} of {nf(d.events_total)} all-time)</div>
      <BarList data={d.events_by_name_7d} empty="No events recorded yet." />

      <div style={h2}>WHERE THEY CAME FROM</div>
      <BarList data={d.top_sources} empty="No attribution recorded yet." />
      <div style={{ fontSize: 13, color: '#64748b', marginTop: 8 }}>
        Landing-page leads captured: <strong>{nf(d.leads_total)}</strong>
      </div>

      <div style={h2}>SOCIAL PROOF</div>
      <div style={grid}>
        <Tile label="Approved" value={d.testimonials_approved} hint="live on the landing page" />
        <Tile
          label="Awaiting review"
          value={d.testimonials_pending}
          hint="approve in Supabase → testimonials"
        />
      </div>

      <p style={{ marginTop: 30 }}>
        <a href="/" style={{ color: '#f97316', fontWeight: 700 }}>← Back to the app</a>
      </p>
    </div>
  )
}
