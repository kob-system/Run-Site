import React, { useEffect } from 'react'
import './Landing.css'
import { track, trackOnce, EV } from '../utils/analytics'

// Public landing page at / — what a stranger sees before they have an account.
// Rendered before the Login screen (App.js) for logged-out visitors.
//
// ── 2026-09-21: REFRAMED on JP's call ───────────────────────────────────────
// First pass (b4e7e23) kept the JobTally shape — a software vendor with three
// SKUs. JP rejected that outright: he wants to read as a business consultant
// who finds what's costing an owner time or money and fixes it, not a guy
// selling tiers. Same three price points ($1,000 / $2,000 / quoted), new
// framing, new names (his ask — "figure out what they usually call it" for
// tier 2 turned up nothing good in the industry, so it's named for what it
// actually does: stops leads from going cold). Tier 3 rewritten from "the
// monthly bill" into what it actually is — a diagnostic, not a rate card.
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
    accent: 'green',
    name: 'The Online Starter Kit',
    price: '$1,000',
    forWho: "You've got nothing online worth finding",
    body: 'A real website built to be found, plus the Google Business Profile and local SEO work that gets you showing up when someone actually searches.',
  },
  {
    n: '2',
    accent: 'orange',
    name: 'The Follow-Up System',
    price: '$2,000',
    forWho: "You've got a site or a start, but leads still slip",
    body: 'Everything in the Starter Kit, plus the CRM set up underneath it: the pipeline, the missed-call texting, the review requests, the follow-up that makes sure a lead never goes cold.',
  },
  {
    n: '3',
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

// Google's public favicon proxy — pulls the real icon straight off the
// client's own live domain, so a "logo" shows up here without JP handing over
// or hosting a single image file for any of these 7 businesses.
const favicon = (domain) => `https://www.google.com/s2/favicons?sz=64&domain=${domain}`

const initials = (name) => name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()

export default function Landing() {
  useEffect(() => {
    document.title = 'Kobrossi Systems, business consultant, Capital Region NY'
    trackOnce(EV.LANDING_VIEW)
  }, [])

  const cta = (where) => () => track(EV.LANDING_CTA, { where })

  return (
    <div className="ld">
      {/* Top bar */}
      <header className="ld-top">
        <a className="ld-logo" href="/">Kobrossi Systems</a>
        <nav>
          <a className="ld-cta-sm" href={CONTACT_MAILTO} onClick={cta('topbar')}>Get in touch</a>
        </nav>
      </header>

      {/* Hero */}
      <section className="ld-hero">
        <div className="ld-hero-glow" aria-hidden="true" />
        <div className="ld-hero-grid ld-hero-grid--solo">
          <div className="ld-hero-copy">
            <div className="ld-eyebrow"><span className="ld-eyebrow-dot" />Business consultant · Capital Region, NY</div>
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
        </div>
      </section>

      {/* How this works — replaces the old "why local" slot with the actual
          consultant framing JP asked for: find the leak first, sell second. */}
      <section className="ld-story">
        <div className="ld-inner ld-story-inner">
          <div className="ld-story-kicker">How this works</div>
          <h2>I look for the leak first. The fix comes second.</h2>
          <p>
            Every business I've worked with had the same problem in a different costume. A site
            nobody found, a phone nobody answered fast enough, a process bleeding hours nobody was
            tracking. I don't start by selling you a website. I start by figuring out what's
            actually costing you time or money.
          </p>
          <p className="ld-story-punch">
            Then I build whichever fix actually closes it. That's the whole job.
          </p>
        </div>
      </section>

      {/* The three tiers */}
      <section className="ld-tiers" id="tiers">
        <div className="ld-inner">
          <h2>Three ways to start</h2>
          <p className="ld-kicker">Pick the one that matches where you're at, not a bundle you're pushed into.</p>
          <div className="ld-tier-grid">
            {TIERS.map((t) => (
              <div className={`ld-tier-card ld-tier-card--${t.accent}`} key={t.n}>
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
      </section>

      {/* Portfolio — real client work, named. Smoke shops excluded on JP's
          standing rule except Half Moon Smoke World, which he's fine naming.
          Sized up from the first pass and each card carries the business's
          own favicon (or initials, for the one not live yet) — a small,
          real signal of "this is an actual business," not a stock icon. */}
      <section className="ld-portfolio" id="portfolio">
        <div className="ld-inner">
          <h2>Work I've actually shipped</h2>
          <p className="ld-kicker">Real businesses, real sites. Click through and check for yourself.</p>
          <ul className="ld-portfolio-grid">
            {PORTFOLIO.map((p) => (
              <li className="ld-portfolio-card" key={p.name}>
                {p.domain ? (
                  <a href={`https://${p.domain}`} target="_blank" rel="noopener noreferrer">
                    <img className="ld-portfolio-logo" src={favicon(p.domain)} alt="" loading="lazy" width="28" height="28" />
                    <span className="ld-portfolio-text">
                      <span className="ld-portfolio-name">{p.name}</span>
                      <span className="ld-portfolio-domain">{p.domain}</span>
                    </span>
                  </a>
                ) : (
                  <div className="ld-portfolio-static">
                    <span className="ld-portfolio-logo ld-portfolio-logo--initials" aria-hidden="true">{initials(p.name)}</span>
                    <span className="ld-portfolio-text">
                      <span className="ld-portfolio-name">{p.name}</span>
                      <span className="ld-portfolio-domain">{p.note}</span>
                    </span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Which one's you — self-select by stage instead of a generic FAQ.
          JP's own framing: it depends where you're at, not a fixed Q&A. */}
      <section className="ld-faq">
        <div className="ld-inner">
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
      </section>

      {/* Final CTA */}
      <section className="ld-final">
        <h2>Tell me what's broken.</h2>
        <p>I'll tell you straight whether I can fix it and what it's worth doing.</p>
        <div className="ld-cta-row ld-cta-row--center">
          <a className="ld-cta" href={CONTACT_MAILTO} onClick={cta('final')}>Email me</a>
          <a className="ld-cta ld-cta-call" href={CONTACT_PHONE_HREF} onClick={cta('final-call')}>Call me</a>
        </div>
        <div className="ld-cta-note">Or text {CONTACT_PHONE_DISPLAY}</div>
      </section>

      <footer className="ld-footer">
        <a href={CONTACT_MAILTO}>Email</a>·<a href={CONTACT_PHONE_HREF}>Call/text</a>·<a href="/login">Client sign in</a>·<a href="/privacy.html">Privacy</a>·<a href="/terms.html">Terms</a>
        <div style={{ marginTop: 8 }}>Kobrossi Systems · getjobtally.com</div>
      </footer>
    </div>
  )
}
