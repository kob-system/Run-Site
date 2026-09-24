import React, { useEffect, useRef, useState, useCallback } from 'react'
import './Landing.css'
import { track, trackOnce, EV } from '../utils/analytics'
import LeadForm from '../components/LeadForm'

// Public landing page at / — what a stranger sees before they have an account.
// Rendered before the Login screen (App.js) for logged-out visitors.
//
// ── 2026-09-21 night: visual system replaced again, same content ──────────
// The "digital blueprint" pass (commit 075d8d6, same evening) went live and
// JP rejected it on sight: "looks like a first try with AI... anime
// futuristic... I want it to look real futuristic. Look at the new X video
// Elon Musk posted about Mars." Translation: he means the SpaceX/NASA
// concept-render aesthetic — dramatic light, atmospheric depth, real
// material and scale — not the flat neon-grid/particle-canvas/hacker-HUD
// look that was live. That look, not the construction lean, was the "generic
// AI template" tell.
//
// So the particle-network canvas, the cyan/violet neon glow blobs, and the
// glassy neon buttons are gone. In their place: one real photograph (a
// tower crane silhouetted against a sunset construction site — Unsplash,
// Unsplash License, free for commercial use, no attribution required),
// self-hosted at src/images/ and graded in CSS with a duotone wash, a
// vignette and film grain instead of a flat color overlay, so it reads as a
// cinematic frame instead of a stock photo with a filter slapped on. The
// same still-image reappears, cropped differently, behind the construction
// section further down — one photographic thread running through the page
// instead of a decorative image plus an unrelated illustration style.
// (Self-hosted, not linked, for the same CSP reason as the fonts below:
// img-src is 'self' only, so an external URL would 404 silently in prod.)
//
// Content is untouched: same headline (asserted on by App.test.js — do not
// edit without updating those tests), same three tiers, same portfolio, same
// stage-select, same construction-leans-doesn't-lock section. Only the look
// changed.
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
    price: '$1,000',
    forWho: "You've got nothing online worth finding",
    body: 'A real website built to be found, plus the Google Business Profile and local SEO work that gets you showing up when someone actually searches.',
  },
  {
    n: '02',
    accent: 'orange',
    name: 'The Follow-Up System',
    price: '$2,000',
    monthly: 'then from $197/mo to keep it running',
    forWho: "You've got a site or a start, but leads still slip",
    body: 'Everything in the Starter Kit, plus every missed call texted back, every customer asked for a review, and every lead in one list on your phone. Full breakdown below.',
    link: { href: '#stack', label: "See everything that's in it" },
  },
  {
    n: '03',
    accent: 'amber',
    name: 'The Diagnostic',
    price: 'Quoted after we talk',
    forWho: "You know something's off, you just don't know what",
    body: "Bring me the problem, not the fix. I'll walk through your business and show you exactly where you're losing money, where things aren't organized, and where jobs aren't tracked the way they should be. Then I figure out the real solution, whether that's a CRM, a client portal, custom software, or making your data actually usable, and price it for the job.",
    note: 'Full custom work starts around $10,000 and scales with what you actually need. Priced for the job, not a rate card.',
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
  { item: 'Every missed call gets a text back', detail: 'Asks what they need and gets them booked, while you keep working.', worth: 'Answering services run $300/mo' },
  { item: 'Every customer asked for a review', detail: 'Sent after every visit, to every customer. Never filtered.', worth: 'Review tools run $299/mo and up' },
  { item: 'Every review answered', detail: 'Drafted in your voice, good ones and bad ones.', worth: 'Included' },
  { item: 'Google profile fixed', detail: 'Right phone, right hours, right category. Owner keeps the login.', worth: '$300 on its own' },
  { item: 'A clean website', detail: 'Built to be found, same as the Starter Kit.', worth: '$1,000 on its own' },
  { item: 'Yelp, Bing and Apple Maps listings', detail: 'Set up once, matching your Google profile.', worth: 'Included' },
  { item: 'Past customers brought back', detail: 'Seasonal check-in texts to customers who opted in.', worth: 'Included' },
  { item: 'One number a month', detail: 'Calls, missed calls, texts back, new reviews. One text, no dashboard to learn.', worth: 'Included' },
]

const BONUSES = [
  'Your 3 most recent unanswered reviews, answered on day one',
  'A counter card with a QR code that opens your Google review page',
  'The Missed Call Check below, free, whether you buy or not',
]

const PORTFOLIO = [
  { name: 'First Class Property Services', domain: '518firstclassservices.com' },
  { name: 'Troy Mega Laundromat', domain: 'troymegawash.com' },
  { name: 'Schenectady Marble & Granite', domain: 'schenectadymarble.com' },
  { name: 'Half Moon Smoke World', domain: 'halfmoonsmokeworld.com' },
  { name: 'USA Kitchen & Cabinets', domain: 'usakitchencabinets518.com' },
  { name: 'All Phase Maintenance', domain: 'allphasemaintenance.com' },
  { name: 'D&K Tax Services', domain: 'dktaxservice.com' },
  { name: 'Job & Crew Tracker', domain: null, href: '/demo', note: 'My own build — click through the demo, live builds available on request' },
]

// Self-select by stage rather than a generic Q&A — JP's own framing ("it
// depends on what stage you are"). Each answer names the tier so this also
// works as second navigation to the section above.
const STAGES = [
  {
    n: '1',
    tier: 'Offer 1 — The Online Starter Kit',
    accent: 'green',
    q: "I don't have anything online",
    a: 'Get found first, everything else comes after that.',
  },
  {
    n: '2',
    tier: 'Offer 2 — The Follow-Up System',
    accent: 'orange',
    q: "I've got a website or some presence, but it's not really doing anything for me",
    a: "The site usually isn't the real problem. Leads slipping through the cracks is.",
  },
  {
    n: '3',
    tier: 'Offer 3 — The Diagnostic',
    accent: 'amber',
    q: "I don't know exactly what's wrong, I just know something's off",
    a: "Tell me how you run your business and I'll find the leak myself.",
  },
]

// The consultant-framing "how this works" walk, now a 3-step blueprint strip
// instead of a paragraph block.
const PROCESS = [
  { n: 'STEP — 01', h: 'Walk the business', p: 'How you actually run, not a checklist.' },
  { n: 'STEP — 02', h: 'Find the leak', p: 'The one thing costing you time, money, or jobs.' },
  { n: 'STEP — 03', h: 'Build the fix', p: 'Site, CRM, or custom software, priced on the job.' },
]

// Construction leans first (JP's own background, BS CET) but the panel next
// to it is the explicit "not only construction" answer he asked for.
const INDUSTRIES = ['Property Services', 'Laundromats', 'Retail & Smoke Shops', 'Kitchen & Cabinet Shops', 'Facilities Maintenance', 'Tax & Professional Services']

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

// ── Hero background: one real photograph, cinematically graded ───────────
// Replaces the old particle-network canvas. Three stacked layers, all pure
// CSS (Landing.css): the photo itself (.ld-hero-photo, a slow 26s Ken-Burns
// drift), a duotone/vignette color grade on top of it (.ld-hero-grade), and
// a faint drifting dust layer (.ld-hero-dust) for atmosphere. No canvas, no
// per-frame JS — cheaper than the field it replaced and doesn't fight
// prefers-reduced-motion the way a requestAnimationFrame loop did.
function HeroPhoto() {
  return (
    <div className="ld-hero-photo-wrap" aria-hidden="true">
      <div className="ld-hero-photo" />
      <div className="ld-hero-grade" />
      <div className="ld-hero-dust" />
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
          <a className="ld-cta-sm" href={CONTACT_MAILTO} onClick={cta('topbar')}>Get in touch</a>
        </nav>
      </header>

      {/* Hero */}
      <section className="ld-hero">
        <HeroPhoto />
        <div className="ld-hero-inner">
          <div className="ld-eyebrow"><span className="ld-eyebrow-dot" />Civil engineer, systems builder &middot; Capital Region, NY</div>
          <h1>Every business has a leak. I find it, then I fix it.</h1>
          <div className="ld-cta-row">
            <a className="ld-cta" href={CONTACT_MAILTO} onClick={cta('hero-email')}>Email me</a>
            <a className="ld-cta ld-cta-call" href={CONTACT_PHONE_HREF} onClick={cta('hero-call')}>Call me</a>
          </div>
        </div>
        <div className="ld-scroll-cue"><span className="ld-scroll-cue-line" />Scroll</div>
      </section>

      {/* How this works — the consultant framing as a 3-step blueprint strip */}
      <Reveal as="section" className="ld-story">
        <div className="ld-inner">
          <span className="ld-kicker-label">How this works</span>
          <h2>I look for the leak first. The fix comes second.</h2>
          <div className="ld-process">
            {PROCESS.map((s) => (
              <div className="ld-process-step" key={s.n}>
                <div className="ld-process-num">{s.n}</div>
                <h3>{s.h}</h3>
                <p>{s.p}</p>
              </div>
            ))}
          </div>
          <p className="ld-story-punch">
            <strong>That's the whole job.</strong> Find what's actually costing you, build whichever fix closes it.
          </p>
        </div>
      </Reveal>

      {/* Free lead magnet — $100M Leads: solve one narrow problem free, which
          shows the bigger one. Costs JP ~20 minutes per request. */}
      <Reveal as="section" className="ld-check" id="check">
        <div className="ld-inner ld-check-grid">
          <div>
            <span className="ld-kicker-label">Free, no strings</span>
            <h2>The Missed Call Check</h2>
            <p className="ld-kicker">Most owners don't know how many calls they miss. I'll find out for you.</p>
            <ol className="ld-check-list">
              <li>I call your business after hours from a few different phones and hear exactly what a customer hears.</li>
              <li>I check your Google profile: phone, hours, category, photos.</li>
              <li>I count your reviews against the top 3 near you.</li>
              <li>You get a one-page result. Keep it, fix it yourself, or have me do it.</li>
            </ol>
          </div>
          <div className="ld-check-form">
            <LeadForm source="missed-call-check" ctaLabel="Check my business" askMessage="Business name and the number customers call" />
          </div>
        </div>
      </Reveal>

      {/* Niche — construction leans, doesn't lock. JP's explicit ask. */}
      <Reveal as="section" className="ld-niche">
        <div className="ld-inner ld-niche-grid">
          <div className="ld-niche-copy">
            <span className="ld-kicker-label">Why construction</span>
            <h2>Built by someone who's also on the job site.</h2>
            <p>
              I've worked NY State highway and bridge inspection, so job costing, crews, and
              change orders aren't foreign to me. <strong>That's the lean, not the limit.</strong> I
              also built <a href="/demo" className="ld-inline-link">getjobtally.com</a>, a
              job-tracking app for contractors, from scratch.
            </p>
            <ul className="ld-niche-list">
              <li>Job costing that matches how a bid actually gets built</li>
              <li>Crew scheduling and time tracking that works from a phone in a truck</li>
              <li>Follow-up systems so a lead never goes cold between jobs</li>
            </ul>
          </div>
          <div className="ld-niche-panel ld-corners">
            <div className="ld-niche-panel-label">Also built for</div>
            <h3>Any business with the same leak</h3>
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
          <p className="ld-kicker">Pick the one that matches where you're at, not a bundle you're pushed into. I take on 3 new builds a month, so whichever one you pick gets real attention, not a template.</p>
          <div className="ld-tier-grid">
            {TIERS.map((t) => (
              <div className={`ld-tier-card ld-corners ld-tier-card--${t.accent}`} key={t.n}>
                <div className="ld-tier-num">{t.n}</div>
                <h3>{t.name}</h3>
                <div className="ld-tier-price">{t.price}</div>
                {t.monthly && <div className="ld-tier-monthly">{t.monthly}</div>}
                <div className="ld-tier-forwho">{t.forWho}</div>
                <p>{t.body}</p>
                {t.note && <p className="ld-tier-note">{t.note}</p>}
                {t.link && <a className="ld-inline-link ld-tier-link" href={t.link.href}>{t.link.label} &rarr;</a>}
              </div>
            ))}
          </div>
          <p className="ld-tiers-guarantee"><strong>Tiers 1 and 2: live in 14 days from the day you hand me your logins, or your setup fee comes back.</strong> Half down, half when it's live, unlimited revisions until it's right.</p>
          <div className="ld-how-cta">
            <a className="ld-cta" href={CONTACT_MAILTO} onClick={cta('tiers')}>Tell me the problem</a>
          </div>
        </div>
      </Reveal>

      {/* The value stack for offer 2 — $100M Offers: show everything that's
          in it and what it's worth before the price does the talking. */}
      <Reveal as="section" className="ld-stack" id="stack">
        <div className="ld-inner">
          <span className="ld-kicker-label">Offer 2, all of it</span>
          <h2>Every call answered. Every customer asked for a review.</h2>
          <p className="ld-kicker">Done for you. One visit to set it up, then one short call a month. You don't learn anything new.</p>
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
            <div className="ld-stack-price-sub">then from $197/mo, founding rate for the first 5 businesses, month to month</div>
          </div>
          <div className="ld-stack-bonus">
            <div className="ld-stack-price-label">Plus, when you sign up</div>
            <ul>
              {BONUSES.map((b) => <li key={b}>{b}</li>)}
            </ul>
          </div>
          <p className="ld-stack-fine">The prices next to each item are what similar services charge on their own, for comparison. Not a promise of results.</p>
        </div>
      </Reveal>

      {/* Portfolio — real client work, named. */}
      <Reveal as="section" className="ld-portfolio" id="portfolio">
        <div className="ld-inner">
          <span className="ld-kicker-label">Portfolio</span>
          <h2>Work I've actually shipped</h2>
          <p className="ld-kicker">Real businesses, real sites. Click through and check for yourself.</p>
          <ul className="ld-portfolio-grid">
            {PORTFOLIO.map((p, i) => {
              const avatar = (
                <span className={`ld-portfolio-logo ld-portfolio-logo--${AVATAR_COLORS[i % AVATAR_COLORS.length]}`} aria-hidden="true">
                  {initials(p.name)}
                </span>
              )
              const num = `PROJECT — ${String(i + 1).padStart(2, '0')}`
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

      {/* Which one's you — self-select by stage. Each card is its own link,
          not just a label, so picking the one that sounds like you actually
          takes you to that offer instead of leaving you to scroll for it. */}
      <Reveal as="section" className="ld-faq">
        <div className="ld-inner">
          <a className="ld-kicker-label ld-kicker-link" href="#tiers">Start here</a>
          <h2>Which one's you?</h2>
          <p className="ld-kicker">Tap the one that sounds like you, it'll take you straight to that offer.</p>
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

      {/* Referral ask — $100M Leads, Lead Getters: customers are the best
          source. 7 of JP's 9 clients came by referral. Paid on the referred
          business's first payment only. */}
      <Reveal as="section" className="ld-refer" id="refer">
        <div className="ld-inner ld-check-grid">
          <div>
            <span className="ld-kicker-label">Know someone?</span>
            <h2>Send me a business. Get a month free.</h2>
            <p className="ld-kicker">When a business you send me pays, you get your next month free. Not on a monthly plan? You get $150 instead. Most of my clients came from someone they trust, that's the point.</p>
          </div>
          <div className="ld-check-form">
            <LeadForm source="referral" ctaLabel="Send the intro" askMessage="Your name, and the business you're sending me" />
          </div>
        </div>
      </Reveal>

      {/* Final CTA */}
      <Reveal as="section" className="ld-final">
        <div className="ld-final-panel ld-corners">
          <div className="ld-final-glow" aria-hidden="true" />
          <h2>Tell me what's broken.</h2>
          <p>I'll tell you straight whether I can fix it and what it's worth doing.</p>
          <div className="ld-final-split">
            <div className="ld-final-form">
              <LeadForm source="homepage-final" ctaLabel="Tell me the leak" />
            </div>
            <div className="ld-final-or">
              <span>or</span>
            </div>
            <div className="ld-final-direct">
              <div className="ld-cta-row">
                <a className="ld-cta" href={CONTACT_MAILTO} onClick={cta('final')}>Email me</a>
                <a className="ld-cta ld-cta-call" href={CONTACT_PHONE_HREF} onClick={cta('final-call')}>Call me</a>
              </div>
            </div>
          </div>
        </div>
      </Reveal>

      <footer className="ld-footer">
        <a href={CONTACT_MAILTO}>Email</a>&middot;<a href={CONTACT_PHONE_HREF}>Call</a>&middot;<a href="/login">Client sign in</a>&middot;<a href="/privacy.html">Privacy</a>&middot;<a href="/terms.html">Terms</a>
        <div className="ld-footer-sig">Kobrossi Systems &middot; getjobtally.com</div>
      </footer>
    </div>
  )
}
