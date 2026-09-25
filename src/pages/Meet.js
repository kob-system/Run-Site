import React from 'react'
import './Landing.css'
import './Meet.css'
import { track, trackOnce, EV } from '../utils/analytics'
import LeadForm from '../components/LeadForm'

// Public page at /jp: the ONE link JP texts past clients and their friends
// when he asks "do you know a business owner who...?" (2026-09-25).
//
// Written for someone opening it cold on a phone, from a text, with no idea
// who JP is: who he is, the three offers at a glance, real live work they can
// tap, and one way to reach him (call/text, or the form). No hero photo, so
// it loads fast on a phone. Reuses Landing.css's .ld tokens, same as /switch.
//
// Proof rules: only sites that were curl-checked live on 2026-09-25, one line
// each of what was actually built (read off the served sites), no numbers,
// no results claims, no testimonials. Owner-facing words only: never "AI",
// "software", "app", "platform", "automation" or "POS" (CLAUDE.md §4).
const PHONE_DISPLAY = '(518) 608-9344'
const PHONE_HREF = 'tel:+15186089344'
const SMS_HREF = `sms:+15186089344?&body=${encodeURIComponent("Hi JP, I got your link. I'd like to talk about my business.")}`

const OFFERS = [
  {
    accent: 'green',
    name: 'The Online Starter Kit',
    price: '$1,500',
    line: 'A real website, plus your Google profile set up so you show up on Google Maps and search when people nearby look for what you do.',
  },
  {
    accent: 'orange',
    name: 'The Follow-Up System',
    price: '$2,000',
    step: '+$500 over the Starter Kit, then from $197/mo',
    line: 'Everything in the Starter Kit, plus every missed call texted back and every customer asked for a review.',
  },
  {
    accent: 'amber',
    name: 'The Diagnostic',
    price: 'Quoted after we talk',
    line: "I walk your business, show you where you're losing time or money, then price the real fix.",
  },
]

const PROOF = [
  {
    name: 'D&K Tax Services',
    domain: 'dktaxservice.com',
    did: 'English and Spanish website with online booking for both offices, Bronx and Albany.',
  },
  {
    name: 'First Class Property Services',
    domain: '518firstclassservices.com',
    did: 'Website with online booking and a quote estimator for a home repair and remodeling company.',
  },
  {
    name: 'Troy Mega Laundromat',
    domain: 'troymegawash.com',
    did: 'Website for a Troy laundromat: hours, prices and wash, dry and fold drop-off, all in one place.',
  },
  {
    name: 'Half Moon Smoke World',
    domain: 'halfmoonsmokeworld.com',
    did: "Website with the shop's product menu online, so customers can look before they drive over.",
  },
]

export default function Meet() {
  React.useEffect(() => {
    document.title = 'JP Kobrossi | Kobrossi Systems, Menands NY'
    trackOnce(EV.LANDING_VIEW, { page: 'jp' })
  }, [])

  const cta = (where) => () => track(EV.LANDING_CTA, { where, page: 'jp' })

  return (
    <div className="ld mt">
      <header className="ld-top">
        <a className="ld-logo" href="/">
          <span className="ld-logo-mark" aria-hidden="true" />
          KOBROSSI SYSTEMS
          <span className="ld-logo-sub">&#47;&#47; capital region, ny</span>
        </a>
        <nav>
          <a className="ld-cta-sm" href={PHONE_HREF} onClick={cta('topbar-call')}>Call</a>
        </nav>
      </header>

      {/* Who JP is + the one way to reach him, all above the fold on a phone */}
      <section className="mt-hero">
        <div className="mt-inner">
          <div className="ld-eyebrow"><span className="ld-eyebrow-dot" />Local &middot; Menands, NY</div>
          <h1 className="mt-h1">Hi, I'm JP.</h1>
          <p className="mt-sub">
            If someone sent you this, they probably worked with me. I help local businesses around the
            Capital Region get found on Google, stop missing calls, and fix whatever is costing them time
            or money. It's just me, and I answer my own phone.
          </p>
          <a className="mt-phone" href={PHONE_HREF} onClick={cta('hero-call')}>
            <span className="mt-phone-label">Call or text</span>
            <span className="mt-phone-num">{PHONE_DISPLAY}</span>
          </a>
          <div className="ld-cta-row ld-cta-row--center">
            <a className="ld-cta" href={PHONE_HREF} onClick={cta('hero-call-btn')}>Call me</a>
            <a className="ld-cta ld-cta-call" href={SMS_HREF} onClick={cta('hero-text')}>Text me</a>
          </div>
        </div>
      </section>

      {/* The three offers at a glance */}
      <section className="mt-section" id="offers">
        <div className="mt-inner">
          <span className="ld-kicker-label">What I do</span>
          <h2>Three ways to start</h2>
          <ul className="mt-offers">
            {OFFERS.map((o) => (
              <li className={`mt-offer mt-offer--${o.accent}`} key={o.name}>
                <div className="mt-offer-top">
                  <h3>{o.name}</h3>
                  <div className="mt-offer-price">{o.price}</div>
                </div>
                {o.step && <div className="mt-offer-step">{o.step}</div>}
                <p>{o.line}</p>
              </li>
            ))}
          </ul>
          <p className="mt-fine">Full details on <a className="ld-inline-link" href="/#tiers">the main page</a>.</p>
        </div>
      </section>

      {/* Proof: live sites, tap and check */}
      <section className="mt-section" id="work">
        <div className="mt-inner">
          <span className="ld-kicker-label">Real work</span>
          <h2>Local businesses I've built for</h2>
          <p className="ld-kicker">All live right now. Tap one and look for yourself.</p>
          <ul className="mt-proof">
            {PROOF.map((p) => (
              <li key={p.domain}>
                <a className="mt-proof-card" href={`https://${p.domain}`} target="_blank" rel="noopener noreferrer">
                  <span className="mt-proof-name">{p.name}</span>
                  <span className="mt-proof-did">{p.did}</span>
                  <span className="mt-proof-domain">{p.domain} &rarr;</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* One clear way in */}
      <section className="mt-section" id="reach">
        <div className="mt-inner mt-reach">
          <span className="ld-kicker-label">Reach me</span>
          <h2>Tell me about your business.</h2>
          <p className="ld-kicker">Call or text {PHONE_DISPLAY}, or leave your info and I'll reach out, usually same day.</p>
          <div className="ld-cta-row ld-cta-row--center">
            <a className="ld-cta" href={PHONE_HREF} onClick={cta('reach-call')}>Call {PHONE_DISPLAY}</a>
          </div>
          <div className="mt-form">
            <LeadForm source="referral-page" ctaLabel="Send it to JP" askMessage="Your business, and what you'd like help with" textMeAfter />
          </div>
        </div>
      </section>

      <footer className="ld-footer">
        <a href={PHONE_HREF}>Call</a>&middot;<a href="/">Main page</a>&middot;<a href="/privacy.html">Privacy</a>&middot;<a href="/terms.html">Terms</a>
        <div className="ld-footer-sig">Kobrossi Systems &middot; Menands, NY</div>
      </footer>
    </div>
  )
}
