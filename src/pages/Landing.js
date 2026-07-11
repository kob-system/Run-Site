import React, { useEffect } from 'react'
import './Landing.css'

// Public landing page at / — what a stranger sees before they have an
// account. Rendered before the Login screen (App.js) for logged-out
// visitors; logged-in users never hit it. Screenshots in /landing/* are
// REAL app screens from the demo company (Summit Remodeling) — nothing
// mocked up. CTAs point at the real signup: /login?signup=1 opens the
// Create Account form. New owners get the existing 7-day no-card free
// window — no invented trials, no invented pricing.
const SIGNUP_URL = '/login?signup=1'

const FEATURES = [
  {
    img: '/landing/clockin-active.png',
    alt: 'JobTally crew clock-in screen with GPS stamp',
    kicker: 'Crew hours',
    title: 'Your crew clocks in with one tap — GPS-stamped',
    body:
      "Your guys tap one button on their phone and they're on the clock, with a GPS stamp showing they were at the job when they hit it. You get an email the moment anyone clocks in or out. No more \"I was there at 7.\"",
  },
  {
    img: '/landing/receipts-list.png',
    alt: 'JobTally receipts list booked to a job',
    kicker: 'Receipts',
    title: 'Snap a receipt — the store and total fill themselves in',
    body:
      'Take a photo at the register and JobTally reads the store and the amount and drops them into a new expense — you just tap the job it belongs to. The pile of crumpled receipts on the dash stops existing, and tax time stops being a nightmare weekend.',
  },
  {
    img: '/landing/job-profit.png',
    alt: 'JobTally job screen showing live materials, labor, and projected profit',
    kicker: 'Profit',
    title: "See what every job is making — while it's still running",
    body:
      "Every job shows what you're charging, what's gone out in labor and materials, and what's left for you — live, not three months later when it's too late to fix. If a job starts bleeding, you know that week.",
  },
  {
    img: '/landing/estimate-sent.png',
    alt: 'JobTally estimate ready to send, with one-tap accept to job',
    kicker: 'Getting paid',
    title: 'Estimate → invoice → paid, all from your phone',
    body:
      'Write the estimate on your phone, send it, and turn a "yes" into a job with one tap. Invoices come out of the same numbers, and the home screen always shows exactly who still owes you what.',
  },
]

const INCLUDED = [
  'Crew GPS time clock',
  'Crew pay totals',
  'Estimates & invoices',
  'Client list',
  'Receipt scanning',
  'Mileage tracking',
  'Job photos & daily logs',
  'Schedule & time off',
  'Business health dashboard',
  'Reports & tax exports',
  'Insurance & license reminders',
  'Works on any phone — no install',
]

const FAQS = [
  {
    q: 'Do I need a credit card to try it?',
    a: 'No. You get 7 days completely free, no card. If it earns its keep, it’s $150/mo after that — every feature, unlimited crew.',
  },
  {
    q: 'What does my crew have to do?',
    a: 'Almost nothing. You text each guy an invite link, he sets a password, and from then on his whole app is basically one big Clock In / Clock Out button. If he can text, he can use it.',
  },
  {
    q: "I'm not a tech guy. How long is setup?",
    a: 'About five minutes. When you first sign in, a setup guide walks you through your first job, your crew, your first estimate and invoice — each step checks itself off as you go.',
  },
  {
    q: 'What if I want out?',
    a: 'Cancel anytime, no contract. Your data stays yours — you can export everything to a spreadsheet whenever you want, even after you cancel your subscription.',
  },
]

export default function Landing() {
  useEffect(() => {
    document.title = 'JobTally — know what every job really makes'
  }, [])

  return (
    <div className="ld">
      {/* Top bar */}
      <header className="ld-top">
        <a className="ld-logo" href="/">JobTally</a>
        <nav>
          <a className="ld-signin" href="/login">Sign in</a>
          <a className="ld-cta-sm" href={SIGNUP_URL}>Start free</a>
        </nav>
      </header>

      {/* Hero */}
      <section className="ld-hero">
        <div className="ld-hero-grid">
          <div className="ld-hero-copy">
            <h1>Know what every job really makes.</h1>
            <p className="ld-sub">
              JobTally tracks your crew's hours, your receipts, and your profit — live,
              from the phone already in your pocket. Built for contractors running a
              2–10 man crew.
            </p>
            <a className="ld-cta" href={SIGNUP_URL}>Start free — no card needed</a>
            <div className="ld-cta-note">Free for 7 days. Then $150/mo, everything included.</div>
            <ul className="ld-trust">
              <li>Set up in ~5 minutes</li>
              <li>Works on any phone</li>
              <li>No modules, no training, no 3-week setup</li>
            </ul>
          </div>
          <div className="ld-hero-shot">
            <div className="ld-phone">
              <img src="/landing/jobs-list.png" alt="JobTally jobs list showing live projected profit per job" width="390" height="844" />
            </div>
            <div className="ld-shot-caption">Real screens from the app — this is what you get.</div>
          </div>
        </div>
      </section>

      {/* Watch-it-run video — click-to-play, nothing loads until they hit play */}
      <section className="ld-video">
        <div className="ld-inner">
          <h2>See it run — 3-minute walkthrough</h2>
          <p className="ld-kicker">Watch a real job go from clock-in to profit. No sign-up needed.</p>
          <div className="ld-video-frame">
            <video
              controls
              playsInline
              preload="none"
              poster="/landing/pitch-poster.jpg"
              src="/landing/JobTally-Pitch.mp4"
            >
              Your browser can't play this video.
            </video>
          </div>
        </div>
      </section>

      {/* Features — alternating rows, real screenshots */}
      <section className="ld-features">
        <div className="ld-inner">
          <h2>What it does</h2>
          <p className="ld-kicker">Four things, done properly. Sign up and it works.</p>
          {FEATURES.map((f, i) => (
            <div className={'ld-row' + (i % 2 ? ' ld-row-flip' : '')} key={f.title}>
              <div className="ld-row-copy">
                <div className="ld-row-kicker">{f.kicker}</div>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </div>
              <div className="ld-row-shot">
                <div className="ld-phone ld-phone-sm">
                  <img src={f.img} alt={f.alt} loading="lazy" width="390" height="844" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Home screen / guided setup */}
      <section className="ld-home">
        <div className="ld-inner ld-home-grid">
          <div className="ld-row-shot">
            <div className="ld-phone ld-phone-sm">
              <img src="/landing/home-owed.png" alt="JobTally home screen showing money owed to you and the guided setup checklist" loading="lazy" width="390" height="844" />
            </div>
          </div>
          <div className="ld-home-copy">
            <h2>Open the app, see your money.</h2>
            <p>
              The home screen leads with the number that matters: <strong>what you're owed</strong>.
              Active jobs, open estimates, and your projected profit sit right under it.
            </p>
            <p>
              And you're never left guessing what to do first — a <strong>setup guide</strong> walks
              you through your first job, your crew, your first estimate and invoice, checking
              each step off automatically as you go.
            </p>
            <a className="ld-cta" href={SIGNUP_URL}>Start free — no card needed</a>
          </div>
        </div>
      </section>

      {/* Everything included */}
      <section className="ld-included">
        <div className="ld-inner">
          <h2>Everything's included. Nothing's gated.</h2>
          <p className="ld-kicker">One plan, every feature, unlimited crew. No per-seat charges, no add-ons.</p>
          <ul className="ld-inc-grid">
            {INCLUDED.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      </section>

      {/* How it works */}
      <section className="ld-how">
        <div className="ld-inner">
          <h2>Up and running by tomorrow morning</h2>
          <div className="ld-steps">
            <div className="ld-step">
              <span className="ld-step-num">1</span>
              <h3>Create your account</h3>
              <p>Two minutes, no card. Name, company, done.</p>
            </div>
            <div className="ld-step">
              <span className="ld-step-num">2</span>
              <h3>Add your first job</h3>
              <p>The setup guide walks you through it step by step.</p>
            </div>
            <div className="ld-step">
              <span className="ld-step-num">3</span>
              <h3>Text your crew the invite link</h3>
              <p>They set a password and clock in tomorrow morning.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="ld-pricing">
        <div className="ld-inner">
          <h2>One price. Everything. No games.</h2>
          <div className="ld-price-card">
            <div className="ld-price">$150<span>/mo</span></div>
            <ul>
              <li>Unlimited crew — no per-seat charges</li>
              <li>Every feature included, nothing gated</li>
              <li>7 days free up front, no card needed</li>
              <li>$1,200/yr if you'd rather pay once (4 months free)</li>
              <li>Cancel anytime — your data stays yours, export it whenever</li>
            </ul>
            <a className="ld-cta" href={SIGNUP_URL}>Start free — no card needed</a>
            <p className="ld-price-note">
              One caught receipt pile or one job that stops bleeding pays for the year.
            </p>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="ld-faq">
        <div className="ld-inner">
          <h2>Straight answers</h2>
          <div className="ld-faq-list">
            {FAQS.map((f) => (
              <div className="ld-faq-item" key={f.q}>
                <h3>{f.q}</h3>
                <p>{f.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="ld-final">
        <h2>Know your number before the job's over.</h2>
        <p>Set up takes about five minutes. Your crew clocks in tomorrow morning.</p>
        <a className="ld-cta" href={SIGNUP_URL}>Start free — no card needed</a>
      </section>

      <footer className="ld-footer">
        <a href="/login">Sign in</a>·<a href="/remodelers">For remodelers</a>·<a href="/privacy.html">Privacy</a>·<a href="/terms.html">Terms</a>
        <div style={{ marginTop: 8 }}>JobTally · getjobtally.com</div>
      </footer>
    </div>
  )
}
