import React from 'react'
import '../pages/Landing.css'
import './Switch.css'
import { track, trackOnce, EV } from '../utils/analytics'
import LeadForm from '../components/LeadForm'

// Public marketing page at /switch — a Meta-ad landing page, not a section
// of the homepage. Boulder Adventure Park's own lesson (Hormozi's "Scale or
// Fail," 2026-09 episode): one offer, one page, one bet, aimed at one
// traffic source. Sending ad clicks to the 10-section homepage instead of a
// focused page is exactly the mistake that episode fixed.
//
// The offer: businesses already paying a reseller agency ~$350/mo for a
// white-label GHL/CRM system (missed-call text-back, review requests,
// pipeline) get the same core system taken over and run for $1,000 setup +
// $200/mo — JP's own already-locked GHL floor (02-services-and-pricing.md),
// not a new number invented for this page. No long contract, cancel
// anytime, in contrast to what a reseller agency usually locks them into.
//
// Reuses Landing.css's .ld token system (imported above) instead of
// inventing a second palette — same fonts, same --ember/--panel/--line
// tokens — but skips the photographic hero: this is a fast, focused ad
// landing page, not the brand homepage, and paid-traffic pages should load
// light. Switch.css holds only what's specific to this page's layout.
const CONTACT_EMAIL = 'kobrossisystems@gmail.com'
const CONTACT_PHONE_DISPLAY = '(518) 608-9344'
const CONTACT_PHONE_HREF = 'tel:+15186089344'
const CONTACT_MAILTO = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('Switch my CRM over')}`

const COMPARE = [
  { label: 'Setup', them: 'Locked into whatever they built', us: '$1,000 once, built around how you actually work' },
  { label: 'Monthly', them: '$350/mo and up', us: '$200/mo flat' },
  { label: 'Contract', them: 'Usually 6–12 months', us: 'Month to month, cancel anytime' },
  { label: 'Who answers', them: 'A support queue', us: 'Me, directly, same number you already have' },
]

const INCLUDED = [
  'Missed-call text-back so a call that goes unanswered still gets a reply',
  'Pipeline that actually shows where every lead is, not a spreadsheet nobody updates',
  'Google review requests that go out automatically after a job’s done',
  'Everything moved over from what you’re on now — you don’t start from zero',
]

export default function Switch() {
  React.useEffect(() => {
    document.title = 'Switch your CRM — Kobrossi Systems'
    trackOnce(EV.LANDING_VIEW, { page: 'switch' })
  }, [])

  const cta = (where) => () => track(EV.LANDING_CTA, { where, page: 'switch' })

  return (
    <div className="ld sw">
      <header className="ld-top">
        <a className="ld-logo" href="/">
          <span className="ld-logo-mark" aria-hidden="true" />
          KOBROSSI SYSTEMS
          <span className="ld-logo-sub">&#47;&#47; capital region, ny</span>
        </a>
        <nav>
          <a className="ld-cta-sm" href={CONTACT_MAILTO} onClick={cta('topbar')}>Get in touch</a>
        </nav>
      </header>

      {/* Hero — no photo, this is the ad-landing page, keep it light and fast */}
      <section className="sw-hero">
        <div className="ld-inner sw-hero-inner">
          <div className="ld-eyebrow"><span className="ld-eyebrow-dot" />Already on a CRM &middot; paying too much for it</div>
          <h1 className="sw-h1">Same missed-call system. $150 less a month.</h1>
          <p className="ld-sub sw-sub">
            If you're already paying an agency $300–$400/mo for missed-call texting and review
            requests, I'll take it over, keep it running, and cut the bill to $200/mo. Month to
            month. Nobody puts you on hold.
          </p>
          <ul className="ld-trust">
            <li>$1,000 to switch it over, no downtime</li>
            <li>$200/mo after that, flat, no contract</li>
            <li>I only take on 3 of these a month</li>
          </ul>
        </div>
      </section>

      {/* The comparison — the whole pitch in one glance */}
      <section className="sw-compare-section">
        <div className="ld-inner">
          <span className="ld-kicker-label">What changes</span>
          <h2>Same system, less bleed</h2>
          <div className="sw-compare ld-corners">
            <div className="sw-compare-row sw-compare-head">
              <div />
              <div className="sw-compare-them">What you have now</div>
              <div className="sw-compare-us">What switching gets you</div>
            </div>
            {COMPARE.map((row) => (
              <div className="sw-compare-row" key={row.label}>
                <div className="sw-compare-label">{row.label}</div>
                <div className="sw-compare-them">{row.them}</div>
                <div className="sw-compare-us">{row.us}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What's included */}
      <section className="sw-included-section">
        <div className="ld-inner">
          <span className="ld-kicker-label">What stays running</span>
          <h2>Nothing you rely on stops working</h2>
          <ul className="sw-included">
            {INCLUDED.map((line) => (
              <li key={line}><span className="sw-check" aria-hidden="true">&#10003;</span>{line}</li>
            ))}
          </ul>
        </div>
      </section>

      {/* Guarantee + urgency, next to the ask */}
      <section className="sw-offer-section">
        <div className="ld-inner sw-offer-grid">
          <div className="sw-offer-copy">
            <span className="ld-kicker-label">The offer</span>
            <h2 className="sw-offer-h2">$1,000 to switch. $200/mo after.</h2>
            <p>
              I move what's already working over, so there's no gap where calls go unanswered
              during the change. If it's not fully running within 2 weeks of us starting, you
              don't owe the setup fee.
            </p>
            <p className="sw-scarcity">
              I only take on 3 of these a month so each one actually gets moved over right, not
              rushed. Once those 3 spots are gone this month, the next opening is next month.
            </p>
            <div className="ld-cta-row">
              <a className="ld-cta ld-cta-call" href={CONTACT_PHONE_HREF} onClick={cta('offer-call')}>Call or text {CONTACT_PHONE_DISPLAY}</a>
            </div>
          </div>
          <div className="sw-offer-form">
            <LeadForm
              source="ghl-switch"
              ctaLabel="Get my $200/mo quote"
              askMessage="Who's your CRM through now, and what are you paying?"
            />
          </div>
        </div>
      </section>

      <footer className="ld-footer">
        <a href={CONTACT_MAILTO}>Email</a>&middot;<a href={CONTACT_PHONE_HREF}>Call/text</a>&middot;<a href="/">Kobrossi Systems</a>&middot;<a href="/privacy.html">Privacy</a>&middot;<a href="/terms.html">Terms</a>
        <div className="ld-footer-sig">Kobrossi Systems &middot; getjobtally.com/switch</div>
      </footer>
    </div>
  )
}
