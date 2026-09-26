import React, { useEffect, useCallback, useRef } from 'react'
import './Storefront.css'
import { track, trackOnce, EV } from '../utils/analytics'
import LeadForm from '../components/LeadForm'
import {
  PHONE_DISPLAY, PHONE_HREF, emailHref, smsHref, asset,
  WORK, Devices, Reveal, Wordmark,
  LIGHTHOUSE, LIGHTHOUSE_DATE, CountUp, Compare, usePointerCraft,
} from './storefront'

// Public homepage at / : what a logged-out stranger sees. Rendered before the
// Login screen (App.js). The JobTally app itself (OwnerDashboard,
// WorkerDashboard, Billing, crew invites) is untouched underneath.
//
// 2026-09-25 redesign ("The Capitol at dusk"): editorial serif type, one
// photo, scroll-driven motion that is off under prefers-reduced-motion.
// Every color in Storefront.css is sampled from the one hero photo below, so
// if the photo ever changes, the palette has to be reviewed with it.
//
// The h1 is asserted on by App.test.js (by role + name), update both together.

// Hero photo: "Empire State Plaza at sunset" by Sashimi-b, 2026-05-29.
// Source: https://commons.wikimedia.org/wiki/File:Empire_State_Plaza_at_sunset.jpg
// License: CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/), free
// for commercial use with attribution. The crops/resizes below are an
// adaptation and are shared under the same license. Credit is in the footer.
// Self-hosted webp in public/media/hero/ (CSP img-src is 'self'):
//   plaza-{1100,1600,2400}.webp  16:9 crop, desktop and tablet
//   plaza-p-{1000,1400}.webp     4:5 crop on the Capitol and the Egg, desktop (60 / 92 KB)
//   plaza-s-{700,1000}.webp      square crop, Capitol high in frame, phones
const HERO = (f) => asset(`/media/hero/${f}`)

const TOWNS = ['Albany', 'Troy', 'Schenectady', 'Menands', 'Colonie', 'Cohoes', 'Watervliet', 'Latham', 'Clifton Park', 'Saratoga Springs', 'Rensselaer', 'Delmar']

const PARTS = [
  {
    n: '01',
    h: 'A website that looks the part',
    p: 'Fast on a phone, clear about what you do, one tap to call. You own it and keep every login.',
  },
  {
    n: '02',
    h: 'Show up on Google Maps',
    p: 'Your Google profile set up right and local search done, so you show up when people nearby look.',
  },
  {
    n: '03',
    h: 'Every missed call, answered back',
    p: 'Missed calls get a text back and every customer gets asked for a review. Part of the Follow-Up System.',
  },
]

const OFFERS = [
  {
    key: 'starter',
    name: 'The Online Starter Kit',
    price: '$1,500',
    terms: 'One time',
    forWho: 'You need a real website and to show up on Google.',
    items: [
      'A professional website, built for phones',
      'Your Google Business Profile set up right',
      'Local search (SEO) done',
      'You own it and keep every login',
    ],
  },
  {
    key: 'followup',
    featured: true,
    name: 'The Follow-Up System',
    price: '$2,000',
    step: '+$500 over the Starter Kit',
    terms: 'then from $197/mo, founding rate, month to month',
    forWho: "Customers call and text when you can't pick up.",
    items: [
      'Everything in the Starter Kit',
      'Every missed call gets a text back',
      'Every customer asked for a review',
      'Reviews answered in your voice',
      'Listed on Yelp, Bing and Apple Maps',
      'Past customers who opted in get a seasonal check-in',
      'One text a month: calls, texts back, new reviews',
    ],
    bonus: 'Day one: your 3 most recent unanswered reviews, answered.',
  },
  {
    key: 'diagnostic',
    name: 'The Diagnostic',
    price: 'Quoted after we talk',
    forWho: "Something's off and you want it found.",
    items: [
      'We walk through your business with you',
      'You see where time and money are slipping',
      'The real fix, priced before any work starts',
    ],
  },
]

// How a build actually runs, in order. Step 04 matches the pricing guarantee.
const STEPS = [
  { n: '01', h: 'Walkthrough', p: 'We walk through your business with you and see how customers find you today.' },
  { n: '02', h: 'Build', p: 'Your website, written for your customers and built for phones first.' },
  { n: '03', h: 'Google profile', p: 'Your Google Business Profile set up right, so you show up on Maps.' },
  { n: '04', h: 'Launch', p: 'Live in 14 days from the day we get your logins.' },
  { n: '05', h: 'You own it', p: 'You own it and keep every login. Nothing held back.' },
]

const SMS_HELLO = "Hi, I found getjobtally.com. I'd like to talk about my business."
const SMS_REFER = "Hi, I'd like to refer a business to you. Their name and number: "

export default function Landing() {
  useEffect(() => {
    document.title = 'Kobrossi Systems | Websites and Google Maps, Capital Region NY'
    trackOnce(EV.LANDING_VIEW)
  }, [])

  const cta = useCallback((where) => () => track(EV.LANDING_CTA, { where }), [])
  const rootRef = useRef(null)
  usePointerCraft(rootRef)

  return (
    <div className="ks" ref={rootRef}>
      {/* ── Hero (ink) ─────────────────────────────────────────────── */}
      <header className="ks-hero">
        <div className="ks-wrap ks-top">
          <Wordmark />
          <nav className="ks-nav" aria-label="Main">
            <a href="#work">Work</a>
            <a href="#pricing">Pricing</a>
            <a href="#contact">Contact</a>
          </nav>
          <a className="ks-btn ks-btn--sm" href={PHONE_HREF} onClick={cta('topbar')}>Call</a>
        </div>

        <div className="ks-hero-grid">
          <div className="ks-hero-copy">
            <p className="ks-eyebrow ks-rise" style={{ '--d': '0ms' }}>Websites and Google Maps &middot; Capital Region, NY</p>
            <h1 className="ks-h1">
              <span className="ks-rise" style={{ '--d': '80ms' }}>Your business,</span>{' '}
              <span className="ks-rise" style={{ '--d': '160ms' }}><em>easy to find</em></span>{' '}
              <span className="ks-rise" style={{ '--d': '240ms' }}>on Google.</span>
            </h1>
            <p className="ks-lede ks-rise" style={{ '--d': '340ms' }}>
              We build websites for local businesses and set up their Google listing, so when people
              nearby search for what you do, they find you.
            </p>
            <div className="ks-actions ks-rise" style={{ '--d': '420ms' }}>
              <a className="ks-btn ks-btn--call" data-magnetic href={PHONE_HREF} onClick={cta('hero-call')}>Call {PHONE_DISPLAY}</a>
              <a className="ks-btn ks-btn--ghost" data-magnetic href={smsHref(SMS_HELLO)} onClick={cta('hero-text')}>Text</a>
              <a className="ks-btn ks-btn--ghost" data-magnetic href={emailHref("Let's talk about my business")} onClick={cta('hero-email')}>Email</a>
            </div>
          </div>

          <figure className="ks-hero-media">
            <div className="ks-hero-frame">
              <picture>
                {/* Phones: square crop, Capitol high in frame. Desktop: 4:5. Tablets: 16:9. */}
                <source media="(max-width: 700px)" type="image/webp" srcSet={`${HERO('plaza-s-700.webp')} 700w, ${HERO('plaza-s-1000.webp')} 1000w`} sizes="100vw" />
                <source media="(min-width: 1000px)" type="image/webp" srcSet={`${HERO('plaza-p-1000.webp')} 1000w, ${HERO('plaza-p-1400.webp')} 1400w`} sizes="50vw" />
                <img
                  src={HERO('plaza-1600.webp')}
                  srcSet={`${HERO('plaza-1100.webp')} 1100w, ${HERO('plaza-1600.webp')} 1600w, ${HERO('plaza-2400.webp')} 2400w`}
                  sizes="100vw"
                  alt="The New York State Capitol, the Egg and the Empire State Plaza towers at sunset, Albany"
                  width="1600"
                  height="900"
                  fetchpriority="high"
                  decoding="async"
                />
              </picture>
              <figcaption className="ks-hero-cap">
                <span className="ks-hero-cap-dot" aria-hidden="true" />
                Empire State Plaza, Albany
              </figcaption>
            </div>
          </figure>
        </div>

        <div className="ks-marquee" aria-label="Where we work">
          <div className="ks-marquee-track">
            {[0, 1].map((copy) => (
              <ul key={copy} aria-hidden={copy === 1 ? 'true' : undefined}>
                {TOWNS.map((t) => <li key={t}>{t}</li>)}
              </ul>
            ))}
          </div>
        </div>
      </header>

      <main>
        {/* ── What we do (paper) ───────────────────────────────────── */}
        <section className="ks-sheet ks-paper ks-what" aria-labelledby="what-h">
          <div className="ks-wrap">
            <Reveal>
              <p className="ks-label">What we do</p>
              <h2 id="what-h" className="ks-statement">
                People find a local business on their phone. They search, check the map, look at the
                website, then call. <em>We make sure every step leads to you.</em>
              </h2>
            </Reveal>
            <div className="ks-parts">
              {PARTS.map((p, i) => (
                <Reveal className="ks-part" key={p.n} style={{ '--i': i }}>
                  <span className="ks-part-n">{p.n}</span>
                  <h3>{p.h}</h3>
                  <p>{p.p}</p>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ── Recent work (paper) ──────────────────────────────────── */}
        <section className="ks-paper ks-work" id="work" aria-labelledby="work-h">
          <div className="ks-wrap">
            <Reveal className="ks-head">
              <p className="ks-label">Recent work</p>
              <h2 id="work-h" className="ks-h2">Real local businesses. <em>Live sites.</em></h2>
              <p className="ks-sub">Tap any one and look for yourself.</p>
            </Reveal>
            <ol className="ks-cases">
              {WORK.map((w, i) => (
                <Reveal as="li" className={`ks-case${i % 2 ? ' ks-case--flip' : ''}`} key={w.key}>
                  <a className="ks-case-stage" data-glow href={`https://${w.domain}`} target="_blank" rel="noopener noreferrer" tabIndex={-1} aria-hidden="true">
                    <Devices item={w} />
                  </a>
                  <div className="ks-case-copy">
                    <span className="ks-case-n">{String(i + 1).padStart(2, '0')} / {String(WORK.length).padStart(2, '0')} &middot; {w.place}</span>
                    <h3>{w.name}</h3>
                    <p>{w.did}</p>
                    <a className="ks-link" href={`https://${w.domain}`} target="_blank" rel="noopener noreferrer" onClick={cta('work-' + w.key)}>
                      Visit {w.domain} <span aria-hidden="true">&#8599;</span>
                    </a>
                  </div>
                </Reveal>
              ))}
            </ol>
            <p className="ks-work-more">
              Need something built around how you run? <a className="ks-link" href="/demo">See a custom job and crew tracker we built</a>
            </p>
          </div>
        </section>

        {/* ── The craft, up close (ink) ────────────────────────────── */}
        <section className="ks-sheet ks-ink ks-craft" id="craft" aria-labelledby="craft-h">
          <div className="ks-wrap">
            <Reveal className="ks-head">
              <p className="ks-label">The craft, up close</p>
              <h2 id="craft-h" className="ks-h2">Built right, <em>checked by Google.</em></h2>
            </Reveal>

            <div className="ks-craft-grid">
              <Reveal className="ks-craft-lang">
                <Compare
                  left={asset('/media/work/dktax-en.webp')}
                  right={asset('/media/work/dktax-es.webp')}
                  leftLabel="English"
                  rightLabel="Español"
                  alt="The D&K Tax Services homepage on a phone, in English and in Spanish"
                />
                <div className="ks-craft-lang-copy">
                  <span className="ks-case-n">D&amp;K Tax Services &middot; dktaxservice.com</span>
                  <h3>One site. <em>Two languages.</em></h3>
                  <p>D&amp;K serves customers in English and Spanish, so every page does too, with one tap to switch. Drag the line to see both.</p>
                </div>
              </Reveal>

              <Reveal className="ks-craft-score">
                <div className="ks-score-big">
                  <span className="ks-score-num"><CountUp to={100} /></span>
                  <span className="ks-score-of">/100</span>
                </div>
                <p className="ks-score-what">
                  <strong>SEO score on all four sites above,</strong> from Google Lighthouse, the test Google
                  publishes for how well a page is set up for search.
                </p>
                <ul className="ks-rings">
                  {LIGHTHOUSE.map((l, i) => (
                    <li key={l.key} style={{ '--i': i }}>
                      <svg viewBox="0 0 44 44" aria-hidden="true">
                        <circle className="ks-ring-bg" cx="22" cy="22" r="19" />
                        <circle className="ks-ring-fg" cx="22" cy="22" r="19" pathLength="100" style={{ '--v': l.seo }} />
                      </svg>
                      <span className="ks-ring-n">{l.seo}</span>
                      <span className="ks-ring-name">{l.name}</span>
                    </li>
                  ))}
                </ul>
                <p className="ks-score-more">D&amp;K Tax Services and Half Moon Smoke World also score 100 for accessibility and 100 for best practices.</p>
                <p className="ks-score-src">Lighthouse mobile test of each live homepage, {LIGHTHOUSE_DATE}.</p>
              </Reveal>
            </div>
          </div>
        </section>

        {/* ── How we build it (paper) ──────────────────────────────── */}
        <section className="ks-sheet ks-paper ks-process" aria-labelledby="steps-h">
          <div className="ks-wrap">
            <Reveal className="ks-head">
              <p className="ks-label">How we build it</p>
              <h2 id="steps-h" className="ks-h2">You run the business. <em>We handle this.</em></h2>
            </Reveal>
            <div className="ks-flow-wrap">
            <span className="ks-flow-line" aria-hidden="true"><span className="ks-flow-fill" /></span>
            <ol className="ks-flow">
              {STEPS.map((s, i) => (
                <li className="ks-flow-step" key={s.n} style={{ '--i': i }}>
                  <span className="ks-flow-dot" aria-hidden="true" />
                  <span className="ks-flow-n">{s.n}</span>
                  <h3>{s.h}</h3>
                  <p>{s.p}</p>
                </li>
              ))}
            </ol>
            </div>
          </div>
        </section>

        {/* ── Pricing (ink) ────────────────────────────────────────── */}
        <section className="ks-sheet ks-ink ks-pricing" id="pricing" aria-labelledby="pricing-h">
          <div className="ks-wrap">
            <Reveal className="ks-head">
              <p className="ks-label">Pricing</p>
              <h2 id="pricing-h" className="ks-h2">Three ways <em>to start.</em></h2>
              <p className="ks-sub">Flat prices. Pick the one that fits where you are.</p>
            </Reveal>
            <div className="ks-offers">
              {OFFERS.map((o, i) => (
                <Reveal className={`ks-offer${o.featured ? ' ks-offer--featured' : ''}`} key={o.key} style={{ '--i': i }}>
                  {o.featured && <span className="ks-offer-badge">Most complete</span>}
                  <h3 className="ks-offer-name">{o.name}</h3>
                  <p className="ks-offer-for">{o.forWho}</p>
                  <div className={`ks-offer-price${o.price.startsWith('$') ? '' : ' ks-offer-price--words'}`}>{o.price}</div>
                  {o.step && <div className="ks-offer-step">{o.step}</div>}
                  {o.terms && <div className="ks-offer-terms">{o.terms}</div>}
                  {o.items && (
                    <ul className="ks-offer-items">
                      {o.items.map((it) => <li key={it}>{it}</li>)}
                    </ul>
                  )}
                  {o.body && <p className="ks-offer-body">{o.body}</p>}
                  {o.bonus && <p className="ks-offer-bonus">{o.bonus}</p>}
                  <a className={`ks-btn${o.featured ? '' : ' ks-btn--ghost'} ks-offer-cta`} href={PHONE_HREF} onClick={cta('offer-' + o.key)}>
                    {o.key === 'diagnostic' ? 'Book a conversation' : 'Get started'}
                  </a>
                </Reveal>
              ))}
            </div>
            <Reveal className="ks-guarantee">
              <strong>Live in 14 days</strong> from the day we get your logins, or your setup fee comes back.
              Starter Kit and Follow-Up System. Half down, half when it's live.
            </Reveal>
          </div>
        </section>

        {/* ── Contact (ink) ────────────────────────────────────────── */}
        <section className="ks-sheet ks-ink ks-contact" id="contact" aria-labelledby="contact-h">
          <div className="ks-wrap ks-contact-grid">
            <Reveal className="ks-contact-copy">
              <p className="ks-label">Contact</p>
              <h2 id="contact-h" className="ks-h2 ks-h2--xl">Let's talk about <em>your business.</em></h2>
              <a className="ks-phone-big" href={PHONE_HREF} onClick={cta('contact-number')}>{PHONE_DISPLAY}</a>
              <div className="ks-actions">
                <a className="ks-btn" data-magnetic href={PHONE_HREF} onClick={cta('contact-call')}>Call</a>
                <a className="ks-btn ks-btn--ghost" data-magnetic href={smsHref(SMS_HELLO)} onClick={cta('contact-text')}>Text</a>
                <a className="ks-btn ks-btn--ghost" data-magnetic href={emailHref("Let's talk about my business")} onClick={cta('contact-email')}>Email</a>
              </div>
            </Reveal>
            <Reveal className="ks-contact-form">
              <p className="ks-form-title">Or leave your details and we'll reach out.</p>
              <LeadForm source="homepage-final" ctaLabel="Send" />
            </Reveal>
          </div>
          <div className="ks-wrap">
            <Reveal className="ks-refer">
              <div>
                <p className="ks-label">Know a business owner?</p>
                <p className="ks-refer-line">Refer them. When they pay, your next month is free. Not on a monthly plan? You get $150 off.</p>
              </div>
              <a className="ks-btn ks-btn--ghost" href={smsHref(SMS_REFER)} onClick={cta('refer-text')}>Send a referral</a>
            </Reveal>
          </div>
        </section>
      </main>

      <footer className="ks-footer">
        <div className="ks-wrap">
          <div className="ks-footer-cols">
            <div className="ks-footer-brand">
              <Wordmark />
              <p>Websites and Google Maps for local businesses. Based in Menands, NY.</p>
              <a className="ks-footer-phone" href={PHONE_HREF}>{PHONE_DISPLAY}</a>
            </div>
            <nav className="ks-footer-col" aria-label="Recent work">
              <p className="ks-footer-h">Recent work</p>
              {WORK.map((w) => (
                <a key={w.key} href={`https://${w.domain}`} target="_blank" rel="noopener noreferrer">{w.domain}</a>
              ))}
            </nav>
            <div className="ks-footer-col">
              <p className="ks-footer-h">Where we work</p>
              <p className="ks-footer-towns">{TOWNS.slice(0, 8).join(', ')} and the rest of the Capital Region.</p>
            </div>
            <nav className="ks-footer-col" aria-label="Footer">
              <p className="ks-footer-h">Reach us</p>
              <a href={PHONE_HREF}>Call</a>
              <a href={smsHref(SMS_HELLO)}>Text</a>
              <a href={emailHref("Let's talk about my business")}>Email</a>
            </nav>
          </div>
        </div>
        <p className="ks-footer-mark" aria-hidden="true">Kobrossi <em>Systems</em></p>
        <div className="ks-wrap ks-footer-base">
          <nav className="ks-footer-links" aria-label="Legal">
            <a href="/login">Client sign in</a>
            <a href="/privacy.html">Privacy</a>
            <a href="/terms.html">Terms</a>
          </nav>
          <p className="ks-credit">
            Photo: <a href="https://commons.wikimedia.org/wiki/File:Empire_State_Plaza_at_sunset.jpg" target="_blank" rel="noopener noreferrer">Empire State Plaza at sunset</a> by Sashimi-b,{' '}
            <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer">CC BY-SA 4.0</a>, cropped.
          </p>
        </div>
      </footer>
    </div>
  )
}
