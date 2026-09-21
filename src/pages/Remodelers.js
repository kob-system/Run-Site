import React from 'react'
import { track, trackOnce, EV } from '../utils/analytics'
import './Remodelers.css'

// Public marketing page at /remodelers — reached today only through the
// /josh and /fb redirects in vercel.json (500 printed flyers, a Facebook
// group link). Rendered before any auth check (App.js), so it works
// logged-out.
//
// ── 2026-09-20: REPURPOSED, on JP's call ────────────────────────────────────
// This used to be the self-serve JobTally signup funnel ($150/mo, "Start
// free — no card"). JP killed that as a standing product the same night —
// zero paying customers, ever. It is NOT going back up as a self-serve
// signup. JobTally survives only as a Tier 3 custom build: someone who
// scans an old flyer and is actually interested gets pitched a build made
// for their business, priced on the job, not a rate card.
//
// Deliberately no backend here — no Supabase call, no Stripe, nothing that
// can break while that infra sits paused. Just a pitch and a way to reach
// JP directly.
const CONTACT_EMAIL = 'kobrossisystems@gmail.com'
const CONTACT_PHONE_DISPLAY = '(518) 608-9344'
const CONTACT_PHONE_HREF = 'tel:+15186089344'
const CONTACT_MAILTO = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('JobTally for my business')}`

export default function Remodelers() {
  React.useEffect(() => {
    document.title = 'JobTally, built for your business — Kobrossi Systems'
    trackOnce(EV.LANDING_VIEW, { page: 'remodelers' })
  }, [])

  const cta = (where) => () => track(EV.LANDING_CTA, { where, page: 'remodelers' })

  return (
    <div className="rl">
      {/* Top bar */}
      <header className="rl-top">
        <a className="rl-logo" href="/remodelers">JobTally</a>
        <nav>
          <a className="rl-signin" href="/">Kobrossi Systems</a>
        </nav>
      </header>

      {/* Hero */}
      <section className="rl-hero">
        <h1>Interested in JobTally for your business?</h1>
        <p className="rl-sub">
          JobTally tracks crew hours, receipts, and per-job profit from a phone. It's not a
          self-serve signup anymore — I build and customize it for one business at a time, the
          same way I build everything else. Tell me about your crew and I'll tell you straight
          whether it's worth doing.
        </p>
        <a className="rl-cta" href={CONTACT_MAILTO} onClick={cta('hero-email')}>Email me</a>
        <div className="rl-cta-note">Or call/text {CONTACT_PHONE_DISPLAY}</div>
      </section>

      {/* Origin story — kept, it's still true and it's the only credibility
          a flyer scanner has before they've talked to anyone. */}
      <section className="rl-story">
        <div className="rl-inner">
          <h2>Why this exists</h2>
          <p>
            JobTally started with a contractor friend of ours in Troy, NY. Good builder,
            steady work, crew of guys who showed up. His system: crew hours scribbled in
            <strong> spiral notebooks</strong>, and every receipt from the supply house stuffed
            into a <strong>plastic sheet</strong> in the truck, crumpled, coffee-stained, half of
            them faded to nothing.
          </p>
          <p>
            Ask him if a job made money and he'd say "pretty sure." He wasn't losing money
            because he was bad at building. He was losing it because nobody could see the
            numbers until it was way too late.
          </p>
          <p>
            <strong>So I built JobTally to kill that.</strong> Now I build a version of it for
            whoever actually needs the same fix, priced for that one job, not a monthly plan.
          </p>
        </div>
      </section>

      <section className="rl-final-cta" style={{ padding: '48px 20px', textAlign: 'center', background: 'var(--navy)', color: '#fff' }}>
        <h2 style={{ fontSize: 'clamp(22px, 4vw, 30px)', fontWeight: 800 }}>Tell me about your crew.</h2>
        <p style={{ color: 'rgba(255,255,255,0.72)', marginTop: '8px', maxWidth: '480px', marginInline: 'auto' }}>
          How many guys, what you're tracking now, and what's actually going wrong with it.
        </p>
        <a className="rl-cta" href={CONTACT_MAILTO} onClick={cta('final')}>Email me</a>
        <div className="rl-cta-note">Or call/text {CONTACT_PHONE_DISPLAY}</div>
      </section>

      <footer className="rl-footer">
        <a href={CONTACT_MAILTO}>Email</a>·<a href={CONTACT_PHONE_HREF}>Call/text</a>·<a href="/privacy.html">Privacy</a>·<a href="/terms.html">Terms</a>
        <div style={{ marginTop: 8 }}>JobTally, a Kobrossi Systems build · getjobtally.com</div>
      </footer>
    </div>
  )
}
