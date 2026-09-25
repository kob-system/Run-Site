import React, { useEffect, useRef, useState, useCallback } from 'react'
import './Landing.css'
import { track, trackOnce, EV } from '../utils/analytics'
import LeadForm from '../components/LeadForm'

// Public landing page at / — what a stranger sees before they have an account.
// Rendered before the Login screen (App.js) for logged-out visitors.
//
// 2026-09-25 revision (JP's review): written as the business, not in first
// person. Speaks to one buyer, the local owner-operator who works in the
// business every day and wants to be found on Google and stop losing
// customers who call or text when they can't pick up. Removed: the free
// "Missed Call Check" section and the review QR counter card (not offered).
// Hero photo is now a Capital Region image (see HeroPhoto below). The hero
// headline is asserted on by App.test.js, update both together.
//
// The actual app (OwnerDashboard, WorkerDashboard, Billing, crew invites) is
// untouched underneath this page and still works exactly as before for any
// session that already exists — this file only changes what a logged-out
// stranger hitting the bare root sees.
const CONTACT_EMAIL = 'kobrossisystems@gmail.com'
const CONTACT_PHONE_HREF = 'tel:+15186089344'
const CONTACT_MAILTO = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("Let's talk about my business")}`

const TIERS = [
  {
    n: '01',
    accent: 'green',
    name: 'The Online Starter Kit',
    price: '$1,500',
    forWho: 'You want a real website and to show up on Google',
    body: 'A clean, professional website plus your Google profile set up right, so you show up on Google Maps and search when people nearby look for what you do. Local SEO included.',
  },
  {
    n: '02',
    accent: 'orange',
    name: 'The Follow-Up System',
    price: '$2,000',
    step: '+$500 over the Starter Kit',
    monthly: 'then from $197/mo to keep it running',
    forWho: "Customers call and text when you can't pick up",
    body: 'Everything in the Starter Kit, plus every missed call texted back and every customer asked for a review.',
    link: { href: '#stack', label: "See what's included" },
  },
  {
    n: '03',
    accent: 'amber',
    name: 'The Diagnostic',
    price: 'Quoted after we talk',
    forWho: "Something's off and you want it found",
    body: 'We walk through how you run, show you where time and money are slipping, then quote the fix.',
  },
]

// ── 2026-09-24: Hormozi pass ($100M Offers value stack + $100M Leads magnet
// and referral ask). Council-checked before shipping: the monthly shows only
// the founding rate ("from $197/mo") because JP hasn't ruled $200 vs $297 for
// the full rate; the guarantee covers setup (what he controls), never a
// result; review asks go to every customer (no gating, no incentive, FTC
// 16 CFR 465); texts only to customers who opted in (A2P + NY GBL 399-z).
// Stack values are what comparable services charge, labelled that way on
// the page, not a promise of results.
const STACK = [
  { item: 'Every missed call gets a text back', detail: 'They hear from you right away, while you keep working.', worth: 'Answering services run $300/mo' },
  { item: 'Every customer asked for a review', detail: 'Sent after every visit, to every customer.', worth: 'Review tools run $299/mo and up' },
  { item: 'Every review answered', detail: 'Written in your voice, good and bad.', worth: 'Included' },
  { item: 'The whole Starter Kit', detail: 'Website, Google Maps and local search. You keep the login.', worth: '$1,500 on its own' },
  { item: 'Yelp, Bing and Apple Maps', detail: 'Listed once, matching your Google profile.', worth: 'Included' },
  { item: 'Past customers brought back', detail: 'Seasonal check-in texts to customers who opted in.', worth: 'Included' },
  { item: 'One text a month', detail: 'Calls, texts back and new reviews. Nothing new to learn.', worth: 'Included' },
]

const BONUSES = [
  'Your 3 most recent unanswered reviews, answered on day one',
]

const PORTFOLIO = [
  { name: 'First Class Property Services', domain: '518firstclassservices.com' },
  { name: 'Troy Mega Laundromat', domain: 'troymegawash.com' },
  { name: 'Schenectady Marble & Granite', domain: 'schenectadymarble.com' },
  { name: 'Half Moon Smoke World', domain: 'halfmoonsmokeworld.com' },
  { name: 'USA Kitchen & Cabinets', domain: 'usakitchencabinets518.com' },
  { name: 'All Phase Maintenance', domain: 'allphasemaintenance.com' },
  { name: 'D&K Tax Services', domain: 'dktaxservice.com' },
  { name: 'Job & Crew Tracker', domain: null, href: '/demo', note: 'Custom build, tap through the demo' },
]

// Self-select by stage rather than a generic Q&A — JP's own framing ("it
// depends on what stage you are"). Each answer names the tier so this also
// works as second navigation to the section above.
const STAGES = [
  {
    n: '1',
    tier: 'Offer 1: The Online Starter Kit',
    accent: 'green',
    q: "I don't have anything online",
    a: 'Get found first. Everything else comes after.',
  },
  {
    n: '2',
    tier: 'Offer 2: The Follow-Up System',
    accent: 'orange',
    q: "I've got a website, but the phone isn't ringing",
    a: 'The site is rarely the problem. Customers slipping away after the first call is.',
  },
  {
    n: '3',
    tier: 'Offer 3: The Diagnostic',
    accent: 'amber',
    q: "I just know something's off",
    a: "Tell us how you run and we'll find it.",
  },
]

const PROCESS = [
  { n: 'STEP 01', h: 'We talk', p: 'What you want, and how you run today.' },
  { n: 'STEP 02', h: 'We build it', p: 'Website, Google profile and follow-up, done for you.' },
  { n: 'STEP 03', h: 'You go live', p: 'Live in 14 days. You keep every login.' },
]

// Construction leans first (JP's own background, BS CET) but the panel next
// to it is the explicit "not only construction" answer he asked for.
const INDUSTRIES = ['Home & Property Services', 'Laundromats', 'Retail Shops', 'Kitchen & Cabinet Shops', 'Contractors & Trades', 'Tax & Small Offices']

// First pass pulled each business's real favicon off Google's public proxy —
// looked fine locally but silently 404'd in production because the site's
// own CSP (vercel.json img-src) only allows 'self'/data:/blob:/Supabase.
// Initials avatars instead: zero network dependency, can't ever break.
const AVATAR_COLORS = ['green', 'orange', 'amber']
const initials = (name) => name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()

// ── Scroll-reveal ───────────────────────────────────────────────────────
// One IntersectionObserver per mounted section rather than a shared
// singleton — the page has ~10 sections, this is not a scale problem, and it
// keeps each Reveal instance self-contained.
function Reveal({ as: Tag = 'div', className = '', children, ...rest }) {
  const ref = useRef(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true) // no observer support (old browser, test env) — just show the content
      return
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          io.disconnect()
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -60px 0px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <Tag ref={ref} className={`ld-reveal${visible ? ' ld-in' : ''} ${className}`} {...rest}>
      {children}
    </Tag>
  )
}

// Hero photo (2026-09-25): "Albany, New York" by Quintin Soloviev, an aerial
// of downtown Albany over the Hudson.
// Source: https://commons.wikimedia.org/wiki/File:Albany,_New_York.jpg
// License: CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/), free for
// commercial use with attribution. Attribution is in the page footer.
// Resized to 1680w / 960w webp, self-hosted in public/media/hero/ so it serves
// same-origin under the CSP (img-src 'self'). Passed in as CSS variables so
// Landing.css can swap to the small file on phones.
const HERO_IMG = `${process.env.PUBLIC_URL || ''}/media/hero/hero-albany.webp`
const HERO_IMG_SM = `${process.env.PUBLIC_URL || ''}/media/hero/hero-albany-sm.webp`

function HeroPhoto() {
  return (
    <div
      className="ld-hero-photo-wrap"
      aria-hidden="true"
      style={{ '--hero-img': `url(${HERO_IMG})`, '--hero-img-sm': `url(${HERO_IMG_SM})` }}
    >
      <div className="ld-hero-photo" />
      <div className="ld-hero-grade" />
    </div>
  )
}

export default function Landing() {
  useEffect(() => {
    document.title = 'Kobrossi Systems, business consultant, Capital Region NY'
    trackOnce(EV.LANDING_VIEW)
  }, [])

  const cta = useCallback((where) => () => track(EV.LANDING_CTA, { where }), [])

  return (
    <div className="ld">
      {/* Top bar */}
      <header className="ld-top">
        <a className="ld-logo" href="/">
          <span className="ld-logo-mark" aria-hidden="true" />
          KOBROSSI SYSTEMS
          <span className="ld-logo-sub">&#47;&#47; capital region, ny</span>
        </a>
        <nav>
          <a className="ld-cta-sm" href={CONTACT_PHONE_HREF} onClick={cta('topbar')}>Call</a>
        </nav>
      </header>

      {/* Hero */}
      <section className="ld-hero">
        <HeroPhoto />
        <div className="ld-hero-inner">
          <div className="ld-eyebrow"><span className="ld-eyebrow-dot" />Local businesses &middot; Capital Region, NY</div>
          <h1>Get found on Google. Get the call. Keep the customer.</h1>
          <p className="ld-sub">Websites, Google Maps and follow-up for shops, service businesses and small offices that are too busy to chase every call.</p>
          <div className="ld-cta-row">
            <a className="ld-cta" href={CONTACT_PHONE_HREF} onClick={cta('hero-call')}>Call</a>
            <a className="ld-cta ld-cta-call" href={CONTACT_MAILTO} onClick={cta('hero-email')}>Email</a>
          </div>
        </div>
        <div className="ld-scroll-cue"><span className="ld-scroll-cue-line" />Scroll</div>
      </section>

      {/* How it works */}
      <Reveal as="section" className="ld-story">
        <div className="ld-inner">
          <span className="ld-kicker-label">How it works</span>
          <h2>You run the business. We get you found.</h2>
          <div className="ld-process">
            {PROCESS.map((s) => (
              <div className="ld-process-step" key={s.n}>
                <div className="ld-process-num">{s.n}</div>
                <h3>{s.h}</h3>
                <p>{s.p}</p>
              </div>
            ))}
          </div>
        </div>
      </Reveal>

      {/* Who it's for: the owner-operator who works in the business every day */}
      <Reveal as="section" className="ld-niche">
        <div className="ld-inner ld-niche-grid">
          <div className="ld-niche-copy">
            <span className="ld-kicker-label">Who it's for</span>
            <h2>Owners who are in the business every day.</h2>
            <p>
              You're behind the counter or on the job. <strong>We make sure the customers looking
              for you find you, and hear back.</strong>
            </p>
            <ul className="ld-niche-list">
              <li>A website that looks like a real business</li>
              <li>Show up on Google Maps when people nearby search</li>
              <li>Every missed call gets a text back</li>
            </ul>
          </div>
          <div className="ld-niche-panel ld-corners">
            <div className="ld-niche-panel-label">Who we work with</div>
            <h3>Local businesses across the Capital Region</h3>
            <div className="ld-industry-grid">
              {INDUSTRIES.map((ind) => (
                <div className="ld-industry-chip" key={ind}>{ind}</div>
              ))}
            </div>
          </div>
        </div>
      </Reveal>

      {/* The three tiers */}
      <Reveal as="section" className="ld-tiers" id="tiers">
        <div className="ld-inner">
          <span className="ld-kicker-label">Pricing</span>
          <h2>Three ways to start</h2>
          <p className="ld-kicker">Pick the one that matches where you are.</p>
          <div className="ld-tier-grid">
            {TIERS.map((t) => (
              <div className={`ld-tier-card ld-corners ld-tier-card--${t.accent}`} key={t.n}>
                <div className="ld-tier-num">{t.n}</div>
                <h3>{t.name}</h3>
                <div className="ld-tier-price">{t.price}</div>
                {t.step && <div className="ld-tier-step">{t.step}</div>}
                {t.monthly && <div className="ld-tier-monthly">{t.monthly}</div>}
                <div className="ld-tier-forwho">{t.forWho}</div>
                <p>{t.body}</p>
                {t.link && <a className="ld-inline-link ld-tier-link" href={t.link.href}>{t.link.label} &rarr;</a>}
              </div>
            ))}
          </div>
          <p className="ld-tiers-guarantee"><strong>Starter Kit and Follow-Up System: live in 14 days from the day we get your logins, or your setup fee comes back.</strong> Half down, half when it's live.</p>
          <div className="ld-how-cta">
            <a className="ld-cta" href={CONTACT_PHONE_HREF} onClick={cta('tiers')}>Get started</a>
          </div>
        </div>
      </Reveal>

      {/* The value stack for offer 2 */}
      <Reveal as="section" className="ld-stack" id="stack">
        <div className="ld-inner">
          <span className="ld-kicker-label">The Follow-Up System</span>
          <h2>Stop losing customers who call after hours.</h2>
          <p className="ld-kicker">Done for you. Nothing new to learn.</p>
          <ul className="ld-stack-list">
            {STACK.map((s) => (
              <li className="ld-stack-row" key={s.item}>
                <div>
                  <h3>{s.item}</h3>
                  <p>{s.detail}</p>
                </div>
                <div className="ld-stack-worth">{s.worth}</div>
              </li>
            ))}
          </ul>
          <div className="ld-stack-price ld-corners">
            <div className="ld-stack-price-label">Your price</div>
            <div className="ld-stack-price-big">$2,000 setup</div>
            <div className="ld-stack-price-sub">then from $197/mo, founding rate, month to month</div>
          </div>
          <div className="ld-stack-bonus">
            <div className="ld-stack-price-label">Plus, on day one</div>
            <ul>
              {BONUSES.map((b) => <li key={b}>{b}</li>)}
            </ul>
          </div>
          <p className="ld-stack-fine">Prices next to each item are what similar services charge on their own, for comparison. Not a promise of results.</p>
        </div>
      </Reveal>

      {/* Portfolio: real client work, named. */}
      <Reveal as="section" className="ld-portfolio" id="portfolio">
        <div className="ld-inner">
          <span className="ld-kicker-label">Portfolio</span>
          <h2>Recent work</h2>
          <p className="ld-kicker">Real local businesses, live sites. Tap one and look.</p>
          <ul className="ld-portfolio-grid">
            {PORTFOLIO.map((p, i) => {
              const avatar = (
                <span className={`ld-portfolio-logo ld-portfolio-logo--${AVATAR_COLORS[i % AVATAR_COLORS.length]}`} aria-hidden="true">
                  {initials(p.name)}
                </span>
              )
              const num = `PROJECT ${String(i + 1).padStart(2, '0')}`
              const text = (
                <span className="ld-portfolio-text">
                  <span className="ld-portfolio-num">{num}</span>
                  <span className="ld-portfolio-name">{p.name}</span>
                  <span className="ld-portfolio-domain">{p.domain || p.note}</span>
                </span>
              )
              return (
                <li className="ld-portfolio-card" key={p.name}>
                  {p.href ? (
                    <a href={p.href}>{avatar}{text}</a>
                  ) : p.domain ? (
                    <a href={`https://${p.domain}`} target="_blank" rel="noopener noreferrer">{avatar}{text}</a>
                  ) : (
                    <div className="ld-portfolio-static">{avatar}{text}</div>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      </Reveal>

      {/* Which one's you: each card links to the offers */}
      <Reveal as="section" className="ld-faq">
        <div className="ld-inner">
          <a className="ld-kicker-label ld-kicker-link" href="#tiers">Start here</a>
          <h2>Which one's you?</h2>
          <div className="ld-faq-list">
            {STAGES.map((s) => (
              <a className={`ld-faq-item ld-faq-item--${s.accent}`} href="#tiers" key={s.q} onClick={cta('faq-' + s.n)}>
                <div className="ld-faq-num">{s.n}</div>
                <div>
                  <span className="ld-faq-tier">{s.tier}</span>
                  <h3>"{s.q}"</h3>
                  <p>{s.a}</p>
                </div>
              </a>
            ))}
          </div>
        </div>
      </Reveal>

      {/* Referral ask. Paid on the referred business's first payment only. */}
      <Reveal as="section" className="ld-refer" id="refer">
        <div className="ld-inner ld-check-grid">
          <div>
            <span className="ld-kicker-label">Know someone?</span>
            <h2>Refer a business. Get a month free.</h2>
            <p className="ld-kicker">When a business you refer pays, your next month is free. Not on a monthly plan? You get $150.</p>
          </div>
          <div className="ld-check-form">
            <LeadForm source="referral" ctaLabel="Send the intro" askMessage="Your name, and the business you're referring" />
          </div>
        </div>
      </Reveal>

      {/* Final CTA */}
      <Reveal as="section" className="ld-final">
        <div className="ld-final-panel ld-corners">
          <div className="ld-final-glow" aria-hidden="true" />
          <h2>Ready to get found?</h2>
          <p>Tell us about your business. You'll get a straight answer on what's worth doing.</p>
          <div className="ld-final-split">
            <div className="ld-final-form">
              <LeadForm source="homepage-final" ctaLabel="Send" />
            </div>
            <div className="ld-final-or">
              <span>or</span>
            </div>
            <div className="ld-final-direct">
              <div className="ld-cta-row">
                <a className="ld-cta" href={CONTACT_PHONE_HREF} onClick={cta('final-call')}>Call</a>
                <a className="ld-cta ld-cta-call" href={CONTACT_MAILTO} onClick={cta('final')}>Email</a>
              </div>
            </div>
          </div>
        </div>
      </Reveal>

      <footer className="ld-footer">
        <a href={CONTACT_MAILTO}>Email</a>&middot;<a href={CONTACT_PHONE_HREF}>Call</a>&middot;<a href="/login">Client sign in</a>&middot;<a href="/privacy.html">Privacy</a>&middot;<a href="/terms.html">Terms</a>
        <div className="ld-footer-sig">Kobrossi Systems &middot; Menands, NY</div>
        <div className="ld-footer-credit">
          Photo: <a href="https://commons.wikimedia.org/wiki/File:Albany,_New_York.jpg" target="_blank" rel="noopener noreferrer">Albany, New York</a> by Quintin Soloviev, <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a>
        </div>
      </footer>
    </div>
  )
}
