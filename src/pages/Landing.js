import React, { useEffect, useRef } from 'react'
import './Landing.css'
import { track, trackOnce, EV } from '../utils/analytics'

// Public landing page at / — what a stranger sees before they have an account.
// Rendered before the Login screen (App.js) for logged-out visitors; logged-in
// users never hit it. Screenshots in /landing/* are REAL app screens from the
// demo company (Summit Remodeling) — nothing mocked up. CTAs point at the real
// signup: /login?signup=1 opens the Create Account form.
//
// ── 2026-08-28: CUT TO THE BONE, on JP's call ───────────────────────────────
// "Plain and simple, only the necessary. Get rid of everything that isn't. We
// can always add things back."
//
// What came out, and why, so nobody re-adds it by accident:
//   · "How it works" (3 numbered steps)  — the FAQ already answers all three,
//                                          two screens further down, better.
//   · "Everything, for that one price" (13-item grid) — a third pass over the
//                                          same feature list, in list form.
//   · Two of the six feature rows (estimates, home screen) — the page sells on
//                                          hours, receipts and profit. The rest
//                                          is what they find once they're in.
//   · The trust bullets, the add-to-home-screen band, the testimonial grid
//                                        — nobody has given a quote yet, so
//                                          that section rendered empty anyway.
//   · Two of the five FAQs.
//
// THE RULE FOR PUTTING ANYTHING BACK: it has to answer a question a contractor
// actually asks before signing up. Nothing here exists to look complete.
//
// ⚠️ The offer on this page is "one job free forever, no card." There is no
// trial. api/create-checkout-session.js sends no trial_period_days. If that
// ever changes, this page, /pricing, /faq and the FAQ JSON-LD change with it.
const SIGNUP_URL = '/login?signup=1'

const FEATURES = [
  {
    img: '/landing/clockin-active.png',
    alt: 'JobTally crew clock-in screen with GPS stamp',
    kicker: 'Crew hours',
    title: 'Your crew clocks in and out with one tap, both GPS-stamped',
    body:
      "Your guys tap one button on their phone and they're on the clock, and that tap stamps where they were standing when they made it. Same when they tap out. You get an email the moment anyone clocks in or out. Two stamps, start and finish, not a tracker. Nothing follows your crew around in between, which is why they'll actually use it.",
  },
  {
    img: '/landing/receipts-list.png',
    alt: 'JobTally receipts list booked to a job',
    kicker: 'Receipts',
    title: 'Snap a receipt and the store, total, tax and date fill themselves in',
    body:
      'Take a photo at the register and JobTally reads the store, the total, the sales tax and the date off it, and drops them into a new expense. You just tap the job it belongs to. The pile of crumpled receipts on the dash stops existing.',
  },
  {
    img: '/landing/job-profit.png',
    alt: 'JobTally job screen showing live materials, labor, and projected profit',
    kicker: 'Profit',
    title: "See what every job is making, while it's still running",
    body:
      "Every job shows what you're charging, what's gone out in labor and materials, and what's left for you. Live, not three months later when it's too late to fix. If a job starts bleeding, you know that week.",
  },
]

const FAQS = [
  {
    q: 'Do I need a credit card to try it?',
    a: 'There is no card at signup. You run one job free, for as long as you want. When you need a second job open at the same time it is $150/mo for every feature, unlimited crew.',
  },
  {
    q: 'What does my crew have to do?',
    a: 'Nothing. You text each guy an invite link, he taps it, and he is in. You already typed his name when you made the link, so there is nothing for him to fill in. No password, no email, nothing to download. From then on his whole app is basically one big Clock In / Clock Out button. If he can text, he can use it.',
  },
  {
    q: 'What if I want out?',
    a: 'Cancel anytime, no contract. Your data stays yours. You can export everything to a spreadsheet whenever you want, even after you cancel. And if you want it all gone, there is a delete button in Settings that erases the whole account.',
  },
]

export default function Landing() {
  useEffect(() => {
    document.title = 'JobTally: know what every job really makes'
    // Top of the funnel. Once per tab so a re-render doesn't inflate it.
    trackOnce(EV.LANDING_VIEW)
  }, [])

  // Which CTA got the click matters — hero vs pricing vs video tells us whether
  // the page sells on the promise or on the price.
  const cta = (where) => () => track(EV.LANDING_CTA, { where })

  // One play is one event, not one per scrub.
  const introPlayedRef = useRef(false)
  const onIntroPlay = () => {
    if (introPlayedRef.current) return
    introPlayedRef.current = true
    track(EV.LANDING_CTA, { where: 'intro-video-play' })
  }

  return (
    <div className="ld">
      {/* Top bar */}
      <header className="ld-top">
        <a className="ld-logo" href="/">JobTally</a>
        <nav>
          {/* A crew member with no link in hand lands HERE, and every other
              door on this page is an owner door. His account has no password,
              so "Sign in" is a form he can never pass. This is his. */}
          <a className="ld-signin" href="/crew">On a crew?</a>
          <a className="ld-signin" href="/login">Sign in</a>
          <a className="ld-cta-sm" href={SIGNUP_URL} onClick={cta('topbar')}>Start free</a>
        </nav>
      </header>

      {/* Hero */}
      <section className="ld-hero">
        <div className="ld-hero-grid">
          <div className="ld-hero-copy">
            <h1>Know what every job really makes.</h1>
            <p className="ld-sub">
              JobTally tracks your crew's hours, your receipts, and your profit, live,
              from the phone already in your pocket. Built for contractors running a
              2–10 man crew.
            </p>
            {/* THE BIG IDEA, and JP called it that: "one active job, free,
                forever, no card" is the whole offer, not a footnote under the
                button. His framing, word for word: "give it a shot, it's free,
                just track one job with it and see how that goes." So it gets
                its own band above the button, at a size you cannot miss. */}
            <div className="ld-free">
              <div className="ld-free-big">One job. Free forever.</div>
              <div className="ld-free-sub">No card. Not a trial. Track one job with it and see how it goes.</div>
            </div>
            <a className="ld-cta" href={SIGNUP_URL} onClick={cta('hero')}>Start free, no card</a>
            <div className="ld-cta-note">$150/mo only when you want a second job open at the same time.</div>
            {/* Kept because it converts the visitor who is not ready to hand
                over an email yet: watching is passive, tapping through the real
                app is the thing that makes someone believe it. */}
            <a className="ld-demo-link" href="/demo" onClick={cta('hero-demo')}>
              Or try it yourself first. No signup, no card
            </a>
          </div>
          <div className="ld-hero-shot">
            <div className="ld-phone">
              <img src="/landing/jobs-list.png" alt="JobTally jobs list showing live projected profit per job" width="390" height="844" />
            </div>
            <div className="ld-shot-caption">Real screens from the app. This is what you get.</div>
          </div>
        </div>
      </section>

      {/* Introduction — a face and the honest origin, before anyone is asked for
          anything. 14 MB, so preload="none": a guy standing on a job site on
          cell data downloads nothing until he actually presses play. */}
      <section className="ld-intro" id="intro">
        <div className="ld-inner">
          <h2>Who built this</h2>
          <p className="ld-kicker">John Paul Kobrossi, founder of JobTally. I built the whole thing myself.</p>
          <div className="ld-video-frame">
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
        </div>
      </section>

      {/* Features — alternating rows, real screenshots */}
      <section className="ld-features">
        <div className="ld-inner">
          <h2>What it does</h2>
          <p className="ld-kicker">Three things, done properly. Sign up and it works.</p>
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

      <section className="ld-pricing">
        <div className="ld-inner">
          <h2>One price. Everything. No games.</h2>
          <div className="ld-price-card">
            <div className="ld-price">$150<span>/mo</span></div>
            <ul>
              <li>Unlimited crew, no per-seat charges</li>
              <li>Every feature included, nothing gated</li>
              <li>One job free, forever, no card</li>
              <li>$1,200/yr if you'd rather pay once (4 months free)</li>
              <li>Cancel anytime. Your data stays yours, export it whenever</li>
            </ul>
            <a className="ld-cta" href={SIGNUP_URL} onClick={cta('pricing')}>Start free, no card</a>
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
          {/* The full FAQ and the trust page are real URLs a stranger can read
              before signing up — and the ones a skeptical contractor goes
              looking for. Buried in the footer they were effectively hidden. */}
          <p className="ld-faq-more">
            <a href="/faq/">Every question, answered in full</a> · <a href="/your-data/">What happens to your data</a>
          </p>
        </div>
      </section>

      <footer className="ld-footer">
        <a href="/crew">On a crew?</a>·<a href="/login">Sign in</a>·<a href="/faq/">FAQ</a>·<a href="/your-data/">Your data</a>·<a href="/privacy.html">Privacy</a>·<a href="/terms.html">Terms</a>
        <div style={{ marginTop: 8 }}>JobTally · getjobtally.com</div>
      </footer>
    </div>
  )
}
