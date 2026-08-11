import React, { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import { getAttribution } from '../utils/attribution'
import { track, trackOnce, EV } from '../utils/analytics'
import { computeJobProfit, profitVerdict, formatMoney } from '../utils/jobCalc'
import './Remodelers.css'

// Public marketing page at /remodelers — remodelers & GCs running a 2–10 man
// crew. Rendered before any auth check (App.js), so it works logged-out.
// The CTA points at the REAL signup: /login opens the auth screen, ?signup=1
// flips it to Create Account. New owners get the existing 30-day free trial,
// which DOES take a card up front (see api/create-checkout-session.js — the
// old no-card window is retired). No invented trials, no invented pricing.
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
    title: 'Crew clock-in and clock-out with GPS',
    body:
      "Your guys tap one button on their phone and they're on the clock — and that tap stamps where they were standing when they made it. Same when they tap out. You get an email the moment anyone clocks in or out. No more \"I was there at 7\" or \"I stayed till 4.\" Two stamps, start and finish — not an all-day tracker.",
  },
  {
    icon: 'receipt',
    title: 'Snap a receipt, done',
    body:
      'Take a photo at the register. JobTally reads the store, the total, the sales tax and the date, and drops them into a new expense — you just tap the job it belongs to. The pile of crumpled receipts on the dash stops existing.',
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
    trackOnce(EV.LANDING_VIEW, { page: 'remodelers' })
  }, [])

  // Which CTA actually moved someone. `where` rides along so the flyer funnel
  // (/josh → here) can be read end to end: view → video play → CTA → signup.
  const cta = (where) => () => track(EV.LANDING_CTA, { where, page: 'remodelers' })

  // "Did the flyer crowd actually watch the video" is the whole question this
  // page exists to answer, so the play is worth an event. onPlay fires again on
  // every resume after a pause, hence the guard — we want one row meaning "this
  // visitor started it", not one per scrub. Not trackOnce(): that dedupes on the
  // event NAME, so it would burn the shared landing_cta key for the whole tab.
  const playedRef = useRef(false)
  const onVideoPlay = () => {
    if (playedRef.current) return
    playedRef.current = true
    track(EV.LANDING_CTA, { where: 'video-play', page: 'remodelers' })
  }

  // The intro gets its OWN guard and its own `where`. Two videos now sit on this
  // page and they answer different questions: "did the flyer crowd trust a face
  // enough to press play" vs "did they stay for the product". One shared ref
  // would collapse both into whichever they hit first.
  const introPlayedRef = useRef(false)
  const onIntroPlay = () => {
    if (introPlayedRef.current) return
    introPlayedRef.current = true
    track(EV.LANDING_CTA, { where: 'intro-video-play', page: 'remodelers' })
  }

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
      //    Attribution rides along so the owner alert says where the lead came
      //    from (which flyer, which QR) without a second round-trip to `leads`.
      body: JSON.stringify({
        email: addr,
        results,
        source: 'remodelers-calculator',
        // `ref` is the referrer code off the flyer QR (?ref=josh). It isn't part
        // of getAttribution(), and it's the single most useful thing on the
        // alert — it says WHICH piece of paper produced this lead.
        attrib: { ...attrib, ref: (typeof localStorage !== 'undefined' && localStorage.getItem('jobtally_ref')) || null },
      }),
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
          <a className="rl-cta-sm" href={SIGNUP_URL} onClick={cta('topbar')}>Start free</a>
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
        <a className="rl-cta" href={SIGNUP_URL} onClick={cta('hero')}>Start your 30-day free trial</a>
        {/* Says card-required UP FRONT on purpose. The Stripe screen comes right
            after sign-up, and a card nobody warned them about is the drop point. */}
        <div className="rl-cta-note">30 days free — $0 charged today. Card up front so it doesn't shut off on you mid-job. Then $150/mo, everything included. Cancel anytime.</div>
        {/* Most people landing here came off a paper flyer's QR code and have
            never heard of JobTally — or of the person who built it. Point them
            at the introduction first: a face and a reason beat a feature list
            when nobody knows who you are yet. */}
        <a className="rl-watch-link" href="#intro" onClick={cta('hero-watch')}>
          <span className="rl-play" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5v14l11-7Z" /></svg>
          </span>
          New here? Start with the 2-minute introduction
        </a>
        <br />
        <a className="rl-calc-link" href="#calculator">Not ready? Run your last job through the free profit calculator ↓</a>
      </section>

      {/* Introduction — the FIRST thing flyer traffic should hit. Someone who
          just scanned a QR code in their truck has no idea who is behind this,
          and the honest origin (a contractor described the problem, so it got
          built) is the only credibility available before they've used anything.
          Same preload="none" rule as below: 12.5 MB, cell data, click to play. */}
      <section className="rl-intro" id="intro">
        <div className="rl-inner">
          <h2>Introduction video</h2>
          <p className="rl-kicker">
            John Paul Kobrossi — the builder of JobTally
          </p>
          <div className="rl-video-frame">
            <video
              controls
              playsInline
              preload="none"
              poster="/landing/intro-poster.jpg"
              src="/landing/JobTally-Intro.mp4"
              onPlay={onIntroPlay}
            >
              Your browser can't play this video.
            </video>
          </div>
          <div className="rl-video-after">
            <a className="rl-cta" href={SIGNUP_URL} onClick={cta('intro-video')}>Start your 30-day free trial</a>
            <div className="rl-cta-note">Or watch the walkthrough below first — no sign-up needed for either.</div>
          </div>
        </div>
      </section>

      {/* Watch-it-run video. This is the "how-to" the introduction points at, so
          it has to stay BELOW the intro — the closing line of that video tells
          people it's down here. Click-to-play with preload="none" — the file is
          ~8 MB and a lot of these visitors are standing on a job site on
          cell data, so nothing downloads until they actually hit play. */}
      <section className="rl-video" id="video">
        <div className="rl-inner">
          <h2>See it run — 3-minute walkthrough</h2>
          <p className="rl-kicker">
            Watch a real job go from clock-in to profit. No sign-up, nothing to fill out.
          </p>
          <div className="rl-video-frame">
            <video
              controls
              playsInline
              preload="none"
              poster="/landing/pitch-poster.jpg"
              src="/landing/JobTally-Pitch.mp4"
              onPlay={onVideoPlay}
            >
              Your browser can't play this video.
            </video>
          </div>
          <div className="rl-video-after">
            <a className="rl-cta" href={SIGNUP_URL} onClick={cta('video')}>Start your 30-day free trial</a>
            <div className="rl-cta-note">Then follow the four steps below — you'll be running by tomorrow morning.</div>
          </div>
        </div>
      </section>

      {/* Getting started. The video sells it; this removes every "…okay, but
          what do I actually DO?" excuse between watching and signing up. */}
      <section className="rl-how" id="get-started">
        <div className="rl-inner">
          <h2>How to get started</h2>
          <p className="rl-kicker">Four steps. About five minutes total, and you only do it once.</p>
          <ol className="rl-steps">
            <li className="rl-step">
              <span className="rl-step-num">1</span>
              <div>
                <h3>Make your account</h3>
                <p>
                  Tap <strong>Start your 30-day free trial</strong>. Your name, your company name,
                  email and a password. That's the whole form — about two minutes.
                </p>
              </div>
            </li>
            <li className="rl-step">
              <span className="rl-step-num">2</span>
              <div>
                <h3>Put a card on file</h3>
                <p>
                  <strong>$0 is charged today.</strong> The card just holds your spot so the app
                  doesn't shut off on you in the middle of a job. 30 days free, then $150/mo —
                  cancel anytime before day 30 and you're never billed.
                </p>
              </div>
            </li>
            <li className="rl-step">
              <span className="rl-step-num">3</span>
              <div>
                <h3>Put in one real job</h3>
                <p>
                  Not a test — a job you're actually running. The name, the address, what you're
                  charging. A setup guide on your home screen walks you through it and checks
                  each step off as you go.
                </p>
              </div>
            </li>
            <li className="rl-step">
              <span className="rl-step-num">4</span>
              <div>
                <h3>Text your crew the invite link</h3>
                <p>
                  JobTally gives you a link — text it to your guys. They set a password on their
                  own phone and clock in tomorrow morning. Nothing to install, no training.
                </p>
              </div>
            </li>
          </ol>
          <div className="rl-how-first">
            <strong>Your very first move:</strong> snap a photo of the last receipt sitting in your
            truck. It reads the store, the total and the tax by itself and books it to the job.
            That's the whole thing in about ten seconds — and that's when it clicks.
          </div>
          <div className="rl-how-cta">
            <a className="rl-cta" href={SIGNUP_URL} onClick={cta('how')}>Start your 30-day free trial</a>
          </div>
        </div>
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
              <li>30 days free up front — $0 charged today, card on file</li>
              <li>$1,200/yr if you'd rather pay once (4 months free)</li>
              <li>Cancel anytime — your data stays yours, export it whenever</li>
            </ul>
            <a className="rl-cta" href={SIGNUP_URL} onClick={cta('pricing')}>Start your 30-day free trial</a>
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
        <a className="rl-cta" href={SIGNUP_URL} onClick={cta('final')}>Start your 30-day free trial</a>
        <div className="rl-cta-note">Sign up, put a card on file, and nothing is charged for 30 days.</div>
      </section>

      <footer className="rl-footer">
        <a href="/privacy.html">Privacy</a>·<a href="/terms.html">Terms</a>·<a href="/login">Sign in</a>
        <div style={{ marginTop: 8 }}>JobTally · getjobtally.com</div>
      </footer>
    </div>
  )
}
