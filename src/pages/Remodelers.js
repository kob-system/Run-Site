import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { getAttribution } from '../utils/attribution'
import { computeJobProfit, profitVerdict, formatMoney } from '../utils/jobCalc'
import './Remodelers.css'

// Public marketing page at /remodelers — remodelers & GCs running a 2–10 man
// crew. Rendered before any auth check (App.js), so it works logged-out.
// The CTA points at the REAL signup: /login opens the auth screen, ?signup=1
// flips it to Create Account. New owners get the existing 30-day no-card free
// window — no invented trials, no invented pricing.
const SIGNUP_URL = '/login?signup=1'

// Clean stroke icons (inherit color via CSS `currentColor`) instead of emoji —
// emoji render inconsistently across devices and read as unpolished on a public
// marketing page.
const svgProps = {
  viewBox: '0 0 24 24', width: 26, height: 26, fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
}
const ICONS = {
  pin: (
    <svg {...svgProps}><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></svg>
  ),
  receipt: (
    <svg {...svgProps}><path d="M5 3h14v18l-2.5-1.5L14 21l-2-1.5L10 21l-2.5-1.5L5 21Z" /><path d="M9 8h6" /><path d="M9 12h6" /><path d="M9 16h4" /></svg>
  ),
  money: (
    <svg {...svgProps}><circle cx="12" cy="12" r="9" /><path d="M12 7v10" /><path d="M14.5 9.3a2.3 2.3 0 0 0-2.2-1.3h-.9a1.9 1.9 0 0 0 0 3.8h1.2a1.9 1.9 0 0 1 0 3.8h-1a2.3 2.3 0 0 1-2.2-1.4" /></svg>
  ),
  doc: (
    <svg {...svgProps}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" /><path d="M14 3v5h5" /><path d="M9 13h6" /><path d="M9 17h4" /></svg>
  ),
}

const FEATURES = [
  {
    icon: 'pin',
    title: 'Crew clock-in with GPS',
    body:
      "Your guys tap one button on their phone and they're on the clock — with a GPS stamp showing they were at the job when they hit it. You get an email the moment anyone clocks in or out. No more \"I was there at 7.\"",
  },
  {
    icon: 'receipt',
    title: 'Snap a receipt, done',
    body:
      'Take a photo at the register. JobTally reads the store and the amount and drops them into a new expense — you just tap the job it belongs to. The pile of crumpled receipts on the dash stops existing.',
  },
  {
    icon: 'money',
    title: 'Per-job profit, live',
    body:
      "Every job shows what you're charging, what's gone out in labor and materials, and what's left for you — while the job is still running, not three months later when it's too late to fix.",
  },
  {
    icon: 'doc',
    title: 'Estimate → invoice → paid',
    body:
      'Write the estimate on your phone, turn it into an invoice with one tap, and see exactly who still owes you what. The money you already earned stops slipping through the cracks.',
  },
]

export default function Remodelers() {
  useEffect(() => {
    document.title = 'JobTally for Remodelers — know what every job really makes'
  }, [])

  // ── Calculator state ────────────────────────────────────────────
  const [inputs, setInputs] = useState({ contract: '', hours: '', rate: '', materials: '', overheadPct: '10' })
  const set = (k) => (e) => setInputs((s) => ({ ...s, [k]: e.target.value }))
  const results = useMemo(() => computeJobProfit(inputs), [inputs])
  const verdict = useMemo(() => profitVerdict(results), [results])
  const hasNumbers = results.contract > 0

  // ── Email-me-my-numbers gate (optional — calculator works without it) ──
  const [email, setEmail] = useState('')
  const [gate, setGate] = useState('idle') // idle | sending | done | error
  const [gateErr, setGateErr] = useState('')

  const sendNumbers = async (e) => {
    e.preventDefault()
    setGateErr('')
    const addr = email.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) {
      setGateErr('Enter a real email and we’ll send your numbers there.')
      return
    }
    setGate('sending')
    const attrib = getAttribution() || {}
    const payload = { inputs, results }
    // 1) Store the lead (anon INSERT allowed by RLS; nothing readable back).
    const { error } = await supabase.from('leads').insert({
      email: addr,
      source: 'remodelers-calculator',
      utm_source: attrib.utm_source || null,
      utm_medium: attrib.utm_medium || null,
      utm_campaign: attrib.utm_campaign || null,
      payload,
    })
    if (error) {
      console.error('Lead save failed:', error)
      setGate('error')
      setGateErr('That didn’t go through. Give it another try in a second.')
      return
    }
    // 2) Email them their numbers — best-effort. The lead is already saved,
    //    so a mail hiccup never turns into a user-facing failure.
    fetch('/api/send-lead-numbers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: addr, results }),
    }).catch(() => {})
    setGate('done')
  }

  return (
    <div className="rl">
      {/* Top bar */}
      <header className="rl-top">
        <a className="rl-logo" href="/remodelers">JobTally</a>
        <nav>
          <a className="rl-signin" href="/login">Sign in</a>
          <a className="rl-cta-sm" href={SIGNUP_URL}>Start free</a>
        </nav>
      </header>

      {/* Hero */}
      <section className="rl-hero">
        <h1>Still running jobs out of a notebook?</h1>
        <p className="rl-sub">
          JobTally shows you what every job is really making — crew hours, receipts, and
          what's left for you — from the phone already in your pocket. Built for remodelers
          and GCs with a 2–10 man crew.
        </p>
        <a className="rl-cta" href={SIGNUP_URL}>Start free — no card needed</a>
        <div className="rl-cta-note">Free for 30 days. Then $150/mo, everything included.</div>
        <br />
        <a className="rl-calc-link" href="#calculator">Not ready? Run your last job through the free profit calculator ↓</a>
      </section>

      {/* Origin story */}
      <section className="rl-story">
        <div className="rl-inner">
          <h2>Why this exists</h2>
          <p>
            JobTally started with a contractor friend of ours in Troy, NY. Good builder,
            steady work, crew of guys who showed up. His system: crew hours scribbled in
            <strong> spiral notebooks</strong>, and every receipt from the supply house stuffed
            into a <strong>plastic sheet</strong> in the truck — crumpled, coffee-stained, half of
            them faded to nothing.
          </p>
          <p>
            Ask him if a job made money and he'd say "pretty sure." Come tax time it was a
            <strong> nightmare weekend</strong> of flattening receipts on the kitchen table and
            trying to remember which job the lumber run belonged to. He wasn't losing money
            because he was bad at building — he was losing it because nobody could see the
            numbers until it was way too late.
          </p>
          <p>
            <strong>So we built JobTally to kill that.</strong> The notebook, the plastic sheet,
            the tax-time archaeology — all of it. One app, on the phones you and your crew
            already carry, that keeps score while the job is running.
          </p>
        </div>
      </section>

      {/* Features */}
      <section className="rl-features">
        <div className="rl-inner">
          <h2>What it does</h2>
          <p className="rl-kicker">No modules, no add-ons, no 3-week setup. Sign up and it works.</p>
          <div className="rl-grid">
            {FEATURES.map((f) => (
              <div className="rl-feature" key={f.title}>
                <span className="rl-icon" aria-hidden="true">{ICONS[f.icon]}</span>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Free calculator */}
      <section className="rl-calc" id="calculator">
        <div className="rl-inner">
          <h2>Free Job Profit Calculator</h2>
          <p className="rl-kicker">
            Grab your last finished job and put the real numbers in. Takes 30 seconds. No signup.
          </p>
          <div className="rl-calc-box">
            <div className="rl-calc-inputs">
              <label htmlFor="rl-contract">Contract price ($)</label>
              <input id="rl-contract" type="number" inputMode="decimal" min="0" placeholder="24000"
                value={inputs.contract} onChange={set('contract')} />
              <div className="rl-two">
                <div>
                  <label htmlFor="rl-hours">Total labor hours</label>
                  <input id="rl-hours" type="number" inputMode="decimal" min="0" placeholder="120"
                    value={inputs.hours} onChange={set('hours')} />
                </div>
                <div>
                  <label htmlFor="rl-rate">Avg hourly rate ($)</label>
                  <input id="rl-rate" type="number" inputMode="decimal" min="0" placeholder="35"
                    value={inputs.rate} onChange={set('rate')} />
                </div>
              </div>
              <label htmlFor="rl-materials">Materials + receipts ($)</label>
              <input id="rl-materials" type="number" inputMode="decimal" min="0" placeholder="9000"
                value={inputs.materials} onChange={set('materials')} />
              <label htmlFor="rl-overhead">Overhead (% of contract — truck, insurance, fuel, phone)</label>
              <input id="rl-overhead" type="number" inputMode="decimal" min="0" max="100" placeholder="10"
                value={inputs.overheadPct} onChange={set('overheadPct')} />
            </div>

            <div className="rl-calc-results" aria-live="polite">
              <div className="rl-line"><span>Labor</span><span>{formatMoney(results.labor)}</span></div>
              <div className="rl-line"><span>Materials</span><span>{formatMoney(results.materials)}</span></div>
              <div className="rl-line"><span>Overhead</span><span>{formatMoney(results.overhead)}</span></div>
              <div className="rl-line"><span>Total cost</span><span>{formatMoney(results.cost)}</span></div>
              <div className="rl-profit">
                <div className={'rl-profit-num ' + (results.profit >= 0 ? 'good' : 'bad')}>
                  {formatMoney(results.profit)}
                </div>
                <div className="rl-profit-label">
                  true profit{hasNumbers ? ` · ${results.margin}% margin` : ''}
                </div>
              </div>
              <div className="rl-verdict">{verdict}</div>

              <div className="rl-email-gate">
                {gate === 'done' ? (
                  <div className="rl-email-ok">
                    Got it — your numbers are on the way to {email.trim()}. Check spam if it hides.
                  </div>
                ) : (
                  <>
                    <p>Want these numbers in your inbox to chew on later?</p>
                    <form className="rl-email-row" onSubmit={sendNumbers}>
                      <input
                        type="email" inputMode="email" autoComplete="email" placeholder="you@email.com"
                        aria-label="Your email" value={email} onChange={(e) => setEmail(e.target.value)}
                      />
                      <button type="submit" disabled={gate === 'sending'}>
                        {gate === 'sending' ? 'Sending…' : 'Email me my numbers'}
                      </button>
                    </form>
                    {gateErr && <div className="rl-email-err">{gateErr}</div>}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="rl-pricing">
        <div className="rl-inner">
          <h2>One price. Everything. No games.</h2>
          <div className="rl-price-card">
            <div className="rl-price">$150<span>/mo</span></div>
            <ul>
              <li>Unlimited crew — no per-seat charges</li>
              <li>Every feature included, nothing gated</li>
              <li>30 days free up front, no card needed</li>
              <li>$1,200/yr if you'd rather pay once (4 months free)</li>
              <li>Cancel anytime — your data stays yours, export it whenever</li>
            </ul>
            <a className="rl-cta" href={SIGNUP_URL}>Start free — no card needed</a>
            <p className="rl-price-note">
              One caught receipt pile or one job that stops bleeding pays for the year.
            </p>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="rl-final">
        <h2>Know your number before the job's over.</h2>
        <p>Set up takes about five minutes. Your crew clocks in tomorrow morning.</p>
        <a className="rl-cta" href={SIGNUP_URL}>Start free — no card needed</a>
      </section>

      <footer className="rl-footer">
        <a href="/privacy.html">Privacy</a>·<a href="/terms.html">Terms</a>·<a href="/login">Sign in</a>
        <div style={{ marginTop: 8 }}>JobTally · getjobtally.com</div>
      </footer>
    </div>
  )
}
