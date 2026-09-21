import React, { useEffect, useRef, useState, useCallback } from 'react'
import './Landing.css'
import { track, trackOnce, EV } from '../utils/analytics'

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
const CONTACT_PHONE_DISPLAY = '(518) 608-9344'
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
    forWho: "You've got a site or a start, but leads still slip",
    body: 'Everything in the Starter Kit, plus the CRM set up underneath it: the pipeline, the missed-call texting, the review requests, the follow-up that makes sure a lead never goes cold.',
  },
  {
    n: '03',
    accent: 'amber',
    name: 'The Diagnostic',
    price: 'Quoted after we talk',
    forWho: "You know something's off, you just don't know what",
    body: "Bring me the problem, not the fix. I'll walk through your business and show you exactly where you're losing money, where things aren't organized, and where jobs aren't tracked the way they should be. Then I figure out the real solution, whether that's a CRM, custom software, or something new, and price it for the job.",
  },
]

const PORTFOLIO = [
  { name: 'First Class Property Services', domain: '518firstclassservices.com' },
  { name: 'Troy Mega Laundromat', domain: 'troymegawash.com' },
  { name: 'Schenectady Marble & Granite', domain: 'schenectadymarble.com' },
  { name: 'Half Moon Smoke World', domain: 'halfmoonsmokeworld.com' },
  { name: 'USA Kitchen & Cabinets', domain: 'usakitchencabinets518.com' },
  { name: 'All Phase Maintenance', domain: 'allphasemaintenance.com' },
  { name: 'D&K Tax Services', domain: null, note: 'In build' },
]

// Self-select by stage rather than a generic Q&A — JP's own framing ("it
// depends on what stage you are"). Each answer names the tier so this also
// works as second navigation to the section above.
const STAGES = [
  {
    n: '1',
    accent: 'green',
    q: "I don't have anything online",
    a: 'Start with the Online Starter Kit. Get found first, everything else comes after that.',
  },
  {
    n: '2',
    accent: 'orange',
    q: "I've got a website or some presence, but it's not really doing anything for me",
    a: "That's the Follow-Up System. The site usually isn't the real problem, leads slipping through the cracks is.",
  },
  {
    n: '3',
    accent: 'amber',
    q: "I don't know exactly what's wrong, I just know something's off",
    a: "That's the Diagnostic. Tell me how you run your business and I'll find the leak myself.",
  },
]

// The consultant-framing "how this works" walk, now a 3-step blueprint strip
// instead of a paragraph block.
const PROCESS = [
  { n: 'STEP — 01', h: 'Walk the business', p: "I look at how you actually run, not a checklist. Site, phone, the way a lead turns into a job, or doesn't." },
  { n: 'STEP — 02', h: 'Find the leak', p: 'One thing is usually costing you the most, whether that\'s time, money, or jobs going to someone else.' },
  { n: 'STEP — 03', h: 'Build the fix', p: 'A website, a CRM and texting system, or custom software. Whatever actually closes the leak, priced on the job.' },
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
          <span className="ld-logo-sub">&#47;&#47; menands, ny</span>
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
          <p className="ld-sub">
            I'm not just a web guy. I look at how you actually run, find what's costing you
            time or money, and build the exact fix: a website, a CRM, custom software, or
            something nobody else has built yet.
          </p>
          <ul className="ld-trust">
            <li>Local, Capital Region, will travel up to an hour</li>
            <li>7 businesses fixed so far</li>
            <li>Talk to me directly, not a call center</li>
          </ul>
          <div className="ld-cta-row">
            <a className="ld-cta" href={CONTACT_MAILTO} onClick={cta('hero-email')}>Email me</a>
            <a className="ld-cta ld-cta-call" href={CONTACT_PHONE_HREF} onClick={cta('hero-call')}>Call me</a>
          </div>
          <div className="ld-cta-note">Or text {CONTACT_PHONE_DISPLAY}, same number either way</div>
        </div>
        <div className="ld-scroll-cue"><span className="ld-scroll-cue-line" />Scroll</div>
      </section>

      {/* Ticker — quick credibility read before anyone scrolls to the grid */}
      <div className="ld-ticker" aria-hidden="true">
        <div className="ld-ticker-track">
          {[...PORTFOLIO, ...PORTFOLIO].map((p, i) => (
            <span className="ld-ticker-item" key={`${p.name}-${i}`}><b>{p.name}</b></span>
          ))}
        </div>
      </div>

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

      {/* Niche — construction leans, doesn't lock. JP's explicit ask. */}
      <Reveal as="section" className="ld-niche">
        <div className="ld-inner ld-niche-grid">
          <div className="ld-niche-copy">
            <span className="ld-kicker-label">Why construction</span>
            <h2>Built by someone who's also on the job site.</h2>
            <p>
              I'm a civil engineering student, so estimates, crews, schedules, and change
              orders aren't a foreign language I'm reading off a brief. <strong>That's the
              lean, not the limit.</strong>
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
          <p className="ld-kicker">Pick the one that matches where you're at, not a bundle you're pushed into.</p>
          <div className="ld-tier-grid">
            {TIERS.map((t) => (
              <div className={`ld-tier-card ld-corners ld-tier-card--${t.accent}`} key={t.n}>
                <div className="ld-tier-num">{t.n}</div>
                <h3>{t.name}</h3>
                <div className="ld-tier-price">{t.price}</div>
                <div className="ld-tier-forwho">{t.forWho}</div>
                <p>{t.body}</p>
              </div>
            ))}
          </div>
          <div className="ld-how-cta">
            <a className="ld-cta" href={CONTACT_MAILTO} onClick={cta('tiers')}>Tell me the problem</a>
          </div>
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
              return (
                <li className="ld-portfolio-card" key={p.name}>
                  {p.domain ? (
                    <a href={`https://${p.domain}`} target="_blank" rel="noopener noreferrer">
                      {avatar}
                      <span className="ld-portfolio-text">
                        <span className="ld-portfolio-num">{num}</span>
                        <span className="ld-portfolio-name">{p.name}</span>
                        <span className="ld-portfolio-domain">{p.domain}</span>
                      </span>
                    </a>
                  ) : (
                    <div className="ld-portfolio-static">
                      {avatar}
                      <span className="ld-portfolio-text">
                        <span className="ld-portfolio-num">{num}</span>
                        <span className="ld-portfolio-name">{p.name}</span>
                        <span className="ld-portfolio-domain">{p.note}</span>
                      </span>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      </Reveal>

      {/* Which one's you — self-select by stage */}
      <Reveal as="section" className="ld-faq">
        <div className="ld-inner">
          <span className="ld-kicker-label">Start here</span>
          <h2>Which one's you?</h2>
          <p className="ld-kicker">Say the one that sounds like you and that's where you start.</p>
          <div className="ld-faq-list">
            {STAGES.map((s) => (
              <div className={`ld-faq-item ld-faq-item--${s.accent}`} key={s.q}>
                <div className="ld-faq-num">{s.n}</div>
                <div>
                  <h3>"{s.q}"</h3>
                  <p>{s.a}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Reveal>

      {/* Final CTA */}
      <Reveal as="section" className="ld-final">
        <div className="ld-final-panel ld-corners">
          <div className="ld-final-glow" aria-hidden="true" />
          <h2>Tell me what's broken.</h2>
          <p>I'll tell you straight whether I can fix it and what it's worth doing.</p>
          <div className="ld-cta-row ld-cta-row--center">
            <a className="ld-cta" href={CONTACT_MAILTO} onClick={cta('final')}>Email me</a>
            <a className="ld-cta ld-cta-call" href={CONTACT_PHONE_HREF} onClick={cta('final-call')}>Call me</a>
          </div>
          <div className="ld-cta-note">Or text {CONTACT_PHONE_DISPLAY}</div>
        </div>
      </Reveal>

      <footer className="ld-footer">
        <a href={CONTACT_MAILTO}>Email</a>&middot;<a href={CONTACT_PHONE_HREF}>Call/text</a>&middot;<a href="/login">Client sign in</a>&middot;<a href="/privacy.html">Privacy</a>&middot;<a href="/terms.html">Terms</a>
        <div className="ld-footer-sig">Kobrossi Systems &middot; getjobtally.com</div>
      </footer>
    </div>
  )
}
