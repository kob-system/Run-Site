import React, { useEffect } from 'react'
import './Landing.css'
import { track, trackOnce, EV } from '../utils/analytics'

// Public landing page at / — what a stranger sees before they have an account.
// Rendered before the Login screen (App.js) for logged-out visitors.
//
// ── 2026-09-20: REPURPOSED, on JP's call ────────────────────────────────────
// JobTally the self-serve product is done as a standing offer — zero paying
// customers, ever. JP killed the old ONE-OFFER lock the same night and this
// domain becomes the storefront for the new one instead: a 3-tier ladder
// (site + SEO / + texting system / problem-solved, value-priced), sold local
// in the Capital Region under the existing KS Digital name. JobTally itself
// didn't disappear — it survives as a Tier 3 case (a custom job-costing build
// for whoever specifically asks and pays for it), which is what the /josh and
// /fb flyer links now lead to (see Remodelers.js — same route, new pitch).
//
// The actual app (OwnerDashboard, WorkerDashboard, Billing, crew invites) is
// untouched underneath this page and still works exactly as before for any
// session that already exists — this file only changes what a logged-out
// stranger hitting the bare root sees.
const CONTACT_EMAIL = 'kobrossisystems@gmail.com'
const CONTACT_PHONE_DISPLAY = '(518) 608-9344'
const CONTACT_PHONE_HREF = 'tel:+15186089344'
const CONTACT_MAILTO = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("Let's talk about my business")}`

const TIERS = [
  {
    n: '1',
    name: 'The site',
    price: '$1,000',
    body: 'A real website built to be found, plus the Google Business Profile and local SEO work that gets you showing up when someone actually searches.',
  },
  {
    n: '2',
    name: 'The site, answering back',
    price: 'Tier 1 + a monthly texting system',
    body: "Missed calls text themselves back, reviews get asked for and answered, slow seasons get an outreach push, and whatever else fits how your business actually runs. Monthly price is a quote, not a rate card — I'll tell you the number after I see the job.",
  },
  {
    n: '3',
    name: 'The problem, solved',
    price: 'Priced on the job',
    body: "Tell me what's actually costing you time or money. If AI or a piece of software is genuinely the fix, I build it and price it on what solving it is worth, not an hourly rate.",
  },
]

const FAQS = [
  {
    q: "Do I need all three tiers?",
    a: "No. Most people start with the site. The texting system and the custom problem-solving are there when you're ready for them, not a bundle you're pushed into.",
  },
  {
    q: 'What does "AI" actually mean here?',
    a: "Whatever actually saves you time. Sometimes that's a chatbot answering questions on your site, sometimes it's an automation that stops a lead from going cold, sometimes the honest answer is you don't need it yet — I'll tell you which.",
  },
  {
    q: "Why should I use someone local?",
    a: "Because you can meet me, see what I've built for other businesses near you, and call the same number in a year if something breaks. Not a ticket number in another state.",
  },
]

export default function Landing() {
  useEffect(() => {
    document.title = 'KS Digital — websites, texting, and AI for Capital Region businesses'
    trackOnce(EV.LANDING_VIEW)
  }, [])

  const cta = (where) => () => track(EV.LANDING_CTA, { where })

  return (
    <div className="ld">
      {/* Top bar */}
      <header className="ld-top">
        <a className="ld-logo" href="/">KS Digital</a>
        <nav>
          <a className="ld-cta-sm" href={CONTACT_MAILTO} onClick={cta('topbar')}>Get in touch</a>
        </nav>
      </header>

      {/* Hero */}
      <section className="ld-hero">
        <div className="ld-hero-grid ld-hero-grid--solo">
          <div className="ld-hero-copy">
            <h1>Your website's not the problem. Nobody's answering the phone.</h1>
            <p className="ld-sub">
              I build the site, get you found on Google, and wire up the texting so no lead
              goes cold. If AI is genuinely the fix for what's eating your time, I build that too.
            </p>
            <ul className="ld-trust">
              <li>Local — Capital Region, will travel up to an hour</li>
              <li>2 years, 7 businesses of real work behind it</li>
              <li>Talk to me directly, not a call center</li>
            </ul>
            <a className="ld-cta" href={CONTACT_MAILTO} onClick={cta('hero-email')}>Email me</a>
            <a className="ld-cta ld-cta-secondary" href={CONTACT_PHONE_HREF} onClick={cta('hero-call')}>Or call/text {CONTACT_PHONE_DISPLAY}</a>
          </div>
        </div>
      </section>

      {/* Why this exists — same slot the old origin story used, honest and short */}
      <section className="ld-story">
        <div className="ld-inner ld-story-inner">
          <div className="ld-story-kicker">Why local</div>
          <h2>I've done this for 7 businesses so far.</h2>
          <p>
            Every one of them had the same problem in a different costume: a site nobody found,
            a phone nobody answered fast enough, or a slow process that a small piece of software
            could fix. Not a "digital transformation." Just the specific thing that was costing
            them money.
          </p>
          <p className="ld-story-punch">
            I'm local, I show up, and you can check my work before you hire me. That's the whole pitch.
          </p>
        </div>
      </section>

      {/* The three tiers */}
      <section className="ld-tiers" id="tiers">
        <div className="ld-inner">
          <h2>Three ways to start</h2>
          <p className="ld-kicker">Pick the one that matches the problem you actually have.</p>
          <div className="ld-tier-grid">
            {TIERS.map((t) => (
              <div className="ld-tier-card" key={t.n}>
                <div className="ld-tier-num">{t.n}</div>
                <h3>{t.name}</h3>
                <div className="ld-tier-price">{t.price}</div>
                <p>{t.body}</p>
              </div>
            ))}
          </div>
          <div className="ld-how-cta">
            <a className="ld-cta" href={CONTACT_MAILTO} onClick={cta('tiers')}>Tell me the problem</a>
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
        <h2>Tell me what's broken.</h2>
        <p>I'll tell you straight whether I can fix it and what it's worth doing.</p>
        <a className="ld-cta" href={CONTACT_MAILTO} onClick={cta('final')}>Email me</a>
        <div className="ld-cta-note">Or call/text {CONTACT_PHONE_DISPLAY}</div>
      </section>

      <footer className="ld-footer">
        <a href={CONTACT_MAILTO}>Email</a>·<a href={CONTACT_PHONE_HREF}>Call/text</a>·<a href="/login">Client sign in</a>·<a href="/privacy.html">Privacy</a>·<a href="/terms.html">Terms</a>
        <div style={{ marginTop: 8 }}>KS Digital · getjobtally.com</div>
      </footer>
    </div>
  )
}
