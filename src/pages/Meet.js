import React from 'react'
import './Storefront.css'
import { track, trackOnce, EV } from '../utils/analytics'
import { PHONE_DISPLAY, PHONE_HREF, emailHref, smsHref, WORK, Devices, Reveal, Wordmark } from './storefront'

// Public page at /jp: the ONE link JP texts past clients and their friends
// when he asks "do you know a business owner who...?" (2026-09-25).
//
// Opened cold on a phone from a text, so: no hero photo (fast), the three
// offers at a glance, the real live work, and exactly three ways to reach us:
// Call, Text, Email. Same design tokens as the homepage (Storefront.css,
// "The Capitol at dusk"), written as the business, not first person.
const SMS = "Hi JP, I got your link. I'd like to talk about my business."
const MAIL = 'About my business'

const OFFERS = [
  {
    key: 'starter',
    name: 'The Online Starter Kit',
    price: '$1,500',
    line: 'A professional website plus your Google profile set up, so you show up on Google Maps and local search when people nearby look.',
  },
  {
    key: 'followup',
    featured: true,
    name: 'The Follow-Up System',
    price: '$2,000',
    step: '+$500 over the Starter Kit, then from $197/mo',
    line: 'Everything in the Starter Kit, plus every missed call texted back and every customer asked for a review.',
  },
  {
    key: 'diagnostic',
    name: 'The Diagnostic',
    price: 'Quoted after we talk',
    line: 'We walk through your business, show you where time or money is slipping, then price the real fix.',
  },
]

function Reach({ where, cta }) {
  return (
    <div className="ks-actions">
      <a className="ks-btn" href={PHONE_HREF} onClick={cta(where + '-call')}>Call</a>
      <a className="ks-btn ks-btn--ghost" href={smsHref(SMS)} onClick={cta(where + '-text')}>Text</a>
      <a className="ks-btn ks-btn--ghost" href={emailHref(MAIL)} onClick={cta(where + '-email')}>Email</a>
    </div>
  )
}

export default function Meet() {
  React.useEffect(() => {
    document.title = 'Kobrossi Systems | Menands, NY'
    trackOnce(EV.LANDING_VIEW, { page: 'jp' })
  }, [])

  const cta = (where) => () => track(EV.LANDING_CTA, { where, page: 'jp' })

  return (
    <div className="ks ks-jp">
      <header className="ks-hero ks-hero--plain">
        <div className="ks-wrap ks-top">
          <Wordmark />
          <a className="ks-btn ks-btn--sm" href={PHONE_HREF} onClick={cta('topbar-call')}>Call</a>
        </div>
        <div className="ks-wrap ks-hero-copy">
          <p className="ks-eyebrow ks-rise" style={{ '--d': '0ms' }}>Websites and Google Maps &middot; Capital Region, NY</p>
          <h1 className="ks-h1 ks-h1--jp">
            <span className="ks-rise" style={{ '--d': '80ms' }}>Your business,</span>{' '}
            <span className="ks-rise" style={{ '--d': '160ms' }}><em>easy to find</em> on Google.</span>
          </h1>
          <p className="ks-lede ks-rise" style={{ '--d': '300ms' }}>
            Websites, Google Maps and follow-up for local businesses across the Capital Region.
          </p>
          <div className="ks-rise" style={{ '--d': '400ms' }}>
            <Reach where="hero" cta={cta} />
          </div>
        </div>
      </header>

      <main>
        <section className="ks-sheet ks-paper" id="offers" aria-labelledby="offers-h">
          <div className="ks-wrap">
            <Reveal className="ks-head">
              <p className="ks-label">What we do</p>
              <h2 id="offers-h" className="ks-h2">Three ways <em>to start.</em></h2>
            </Reveal>
            <ul className="ks-mini-offers">
              {OFFERS.map((o) => (
                <Reveal as="li" className={`ks-mini-offer${o.featured ? ' ks-mini-offer--featured' : ''}`} key={o.key}>
                  <div className="ks-mini-offer-top">
                    <h3>{o.name}</h3>
                    <div className={`ks-mini-offer-price${o.price.startsWith('$') ? '' : ' ks-mini-offer-price--words'}`}>{o.price}</div>
                  </div>
                  {o.step && <div className="ks-mini-offer-step">{o.step}</div>}
                  <p>{o.line}</p>
                </Reveal>
              ))}
            </ul>
            <p className="ks-fine">Full details on <a className="ks-link" href="/#pricing">the main page</a>.</p>
          </div>
        </section>

        <section className="ks-paper ks-jp-work" id="work" aria-labelledby="jp-work-h">
          <div className="ks-wrap">
            <Reveal className="ks-head">
              <p className="ks-label">Recent work</p>
              <h2 id="jp-work-h" className="ks-h2">All live. <em>Tap one and look.</em></h2>
            </Reveal>
            <ul className="ks-jp-grid">
              {WORK.map((w) => (
                <Reveal as="li" key={w.key}>
                  <a className="ks-jp-card" href={`https://${w.domain}`} target="_blank" rel="noopener noreferrer" onClick={cta('work-' + w.key)}>
                    <Devices item={w} compact />
                    <span className="ks-jp-card-name">{w.name}</span>
                    <span className="ks-jp-card-did">{w.did}</span>
                    <span className="ks-jp-card-domain">{w.domain} <span aria-hidden="true">&#8599;</span></span>
                  </a>
                </Reveal>
              ))}
            </ul>
          </div>
        </section>

        <section className="ks-sheet ks-ink ks-jp-reach" id="reach" aria-labelledby="reach-h">
          <div className="ks-wrap">
            <Reveal>
              <p className="ks-label">Contact</p>
              <h2 id="reach-h" className="ks-h2 ks-h2--xl">Tell us about <em>your business.</em></h2>
              <a className="ks-phone-big" href={PHONE_HREF} onClick={cta('reach-number')}>{PHONE_DISPLAY}</a>
              <Reach where="reach" cta={cta} />
            </Reveal>
          </div>
        </section>
      </main>

      <footer className="ks-footer">
        <div className="ks-wrap">
          <div className="ks-footer-top">
            <Wordmark />
            <p>Kobrossi Systems &middot; Menands, NY</p>
          </div>
          <nav className="ks-footer-links" aria-label="Footer">
            <a href="/">Main page</a>
            <a href="/privacy.html">Privacy</a>
            <a href="/terms.html">Terms</a>
          </nav>
        </div>
      </footer>
    </div>
  )
}
