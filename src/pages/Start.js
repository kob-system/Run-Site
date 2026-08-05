import React, { useEffect, useState } from 'react'
import { track, trackOnce, EV } from '../utils/analytics'
import { VIDEOS, REFERRERS, INTRO_POINTS, SETUP_STEPS } from '../content/welcome'
import './Start.css'

// Public welcome page at /start — where the printed brochure QR lands
// (vercel.json redirects /josh here with ?ref=josh + the flyer UTMs). Rendered
// before any auth check in App.js, so a stranger with a card in his hand sees
// it logged-out.
//
// The funnel, in the order JP wants it:
//   ① show them WHO sent them  ② the intro video (what this is)
//   ③ the how-to (how to run it)  ④ start the trial
//
// Non-negotiable: this page has to convert with the videos missing, because
// they aren't filmed and the brochures are already in his truck. Every step
// therefore has a real written version that stands on its own. Nothing on this
// page says "coming soon."
const SIGNUP_URL = '/login?signup=1'

// Same stroke-icon approach as Remodelers.js — emoji render inconsistently
// across phones and read as unpolished on a page a stranger is judging.
const svgProps = {
  viewBox: '0 0 24 24', width: 24, height: 24, fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
}
const ICONS = {
  check: <svg {...svgProps}><path d="m4 12.5 5 5L20 6.5" /></svg>,
  play: <svg {...svgProps} width="34" height="34"><circle cx="12" cy="12" r="10" /><path d="M10 8.5 16 12l-6 3.5Z" /></svg>,
  pin: <svg {...svgProps}><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></svg>,
  receipt: <svg {...svgProps}><path d="M5 3h14v18l-2.5-1.5L14 21l-2-1.5L10 21l-2.5-1.5L5 21Z" /><path d="M9 8h6" /><path d="M9 12h6" /><path d="M9 16h4" /></svg>,
  money: <svg {...svgProps}><circle cx="12" cy="12" r="9" /><path d="M12 7v10" /><path d="M14.5 9.3a2.3 2.3 0 0 0-2.2-1.3h-.9a1.9 1.9 0 0 0 0 3.8h1.2a1.9 1.9 0 0 1 0 3.8h-1a2.3 2.3 0 0 1-2.2-1.4" /></svg>,
  doc: <svg {...svgProps}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" /><path d="M14 3v5h5" /><path d="M9 13h6" /><path d="M9 17h4" /></svg>,
}

const FEATURES = [
  { icon: 'pin', title: 'Clock in and out with GPS', body: 'Two stamps — where he stood when he started, where he stood when he finished. Not a tracker in between. You get an email either way.' },
  { icon: 'receipt', title: 'Snap the receipt', body: 'Photo at the register. It pulls the store, the total, the sales tax and the date. You just tap the job.' },
  { icon: 'money', title: 'Profit while it runs', body: "Contract price, labor out, material out, what's left for you — today, not three months from now." },
  { icon: 'doc', title: 'Estimate to invoice', body: 'Write it on your phone, turn it into an invoice with one tap, see who still owes you.' },
]

// Read ?ref= straight off the URL for DISPLAY only. App.js separately sanitizes
// and persists it to localStorage for signup attribution — that's the record of
// who earns credit. This is just the name on the screen, so it stays read-only
// and never writes anything.
function readRef() {
  try {
    const raw = new URLSearchParams(window.location.search).get('ref')
    return (raw || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32)
  } catch {
    return ''
  }
}

// One player for both slots. YouTube stays behind a click-to-load facade: no
// iframe, no youtube.com request, and nothing from Google touches the visitor
// until they actually tap play. An mp4 in public/ is same-origin and just plays.
function Player({ slot, onPlay }) {
  const [live, setLive] = useState(false)
  const v = slot.video
  if (!v) return null

  if (v.kind === 'file') {
    return (
      <div className="st-player">
        <video
          controls playsInline preload="metadata" src={v.src}
          poster={v.poster || undefined} onPlay={onPlay}
        />
      </div>
    )
  }

  if (v.kind !== 'youtube' || !v.id) return null

  if (!live) {
    return (
      <button
        type="button"
        className="st-player st-facade"
        onClick={() => { setLive(true); onPlay() }}
        aria-label={`Play: ${slot.title}`}
      >
        <img
          src={`https://i.ytimg.com/vi/${v.id}/maxresdefault.jpg`}
          alt=""
          onError={(e) => { e.currentTarget.src = `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg` }}
        />
        <span className="st-play">{ICONS.play}</span>
      </button>
    )
  }

  return (
    <div className="st-player">
      <iframe
        src={`https://www.youtube-nocookie.com/embed/${v.id}?autoplay=1&rel=0&modestbranding=1&playsinline=1`}
        title={slot.title}
        allow="accelerometer; autoplay; encrypted-media; picture-in-picture"
        allowFullScreen
      />
    </div>
  )
}

export default function Start() {
  const [ref] = useState(readRef)
  const partner = REFERRERS[ref] || null

  useEffect(() => {
    document.title = partner
      ? `${partner.name} sent you — JobTally`
      : 'Start here — JobTally'
    trackOnce(EV.START_VIEW, {
      ref: ref || 'none',
      intro_video: !!VIDEOS.intro.video,
      howto_video: !!VIDEOS.howto.video,
    })
  }, [ref, partner])

  const cta = (where) => () => track(EV.START_CTA, { ref: ref || 'none', where })

  return (
    <div className="st">
      <header className="st-top">
        <span className="st-logo">JobTally</span>
        <nav>
          <a className="st-signin" href="/login">Sign in</a>
          <a className="st-cta-sm" href={SIGNUP_URL} onClick={cta('header')}>Start free</a>
        </nav>
      </header>

      {/* ① Who sent you. The whole reason the QR carries ?ref=. */}
      <section className="st-hero">
        {partner && (
          <div className="st-badge">
            <span className="st-badge-ic">{ICONS.check}</span>
            <span>
              <strong>{partner.name} sent you</strong>
              {partner.company ? ` · ${partner.company}` : ''}
            </span>
          </div>
        )}
        <h1>
          {partner
            ? `${partner.name} handed you that card. Here's the two-minute version.`
            : "You scanned the card. Here's the two-minute version."}
        </h1>
        <p className="st-sub">
          {partner?.line ? `${partner.line} ` : ''}
          JobTally tells you what a job is really making — crew hours, receipts, and what's
          left for you — while the job is still running.
        </p>
        <a className="st-cta" href="#step1" onClick={cta('hero')}>Start here ↓</a>
      </section>

      {/* ② The introduction. Video when it exists; the real answers either way. */}
      <section className="st-step" id="step1">
        <div className="st-inner">
          <div className="st-steptag">Step 1</div>
          <h2>Watch this first</h2>
          <p className="st-kicker">
            {VIDEOS.intro.video
              ? `${VIDEOS.intro.title}${VIDEOS.intro.length ? ` · ${VIDEOS.intro.length}` : ''}`
              : 'The short version of what this is, who it\'s for, and what it costs.'}
          </p>

          <Player
            slot={VIDEOS.intro}
            onPlay={() => track(EV.START_INTRO_PLAY, { ref: ref || 'none' })}
          />

          <div className="st-qa">
            {INTRO_POINTS.map((p) => (
              <div className="st-qa-row" key={p.q}>
                <h3>{p.q}</h3>
                <p>{p.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ③ The how-to. Same pattern: video slot on top, real steps underneath. */}
      <section className="st-step st-alt">
        <div className="st-inner">
          <div className="st-steptag">Step 2</div>
          <h2>Then set it up — about five minutes</h2>
          <p className="st-kicker">
            {VIDEOS.howto.video
              ? `${VIDEOS.howto.title}${VIDEOS.howto.length ? ` · ${VIDEOS.howto.length}` : ''}`
              : 'Do these five things in this order and you\'re running.'}
          </p>

          <Player
            slot={VIDEOS.howto}
            onPlay={() => track(EV.START_HOWTO_PLAY, { ref: ref || 'none' })}
          />

          <ol className="st-steps">
            {SETUP_STEPS.map((s) => (
              <li key={s.title}>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* What it does — condensed. They've read this far; give them the goods. */}
      <section className="st-features">
        <div className="st-inner">
          <h2>What you actually get</h2>
          <div className="st-grid">
            {FEATURES.map((f) => (
              <div className="st-feature" key={f.title}>
                <span className="st-icon">{ICONS[f.icon]}</span>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ④ Get going. */}
      <section className="st-step st-final">
        <div className="st-inner">
          <div className="st-steptag">Step 3</div>
          <h2>Get going</h2>
          <div className="st-price">$150<span>/mo</span></div>
          <ul className="st-price-list">
            <li>Unlimited crew — no per-seat charges</li>
            <li>Every feature included, nothing gated</li>
            <li>$1,200/yr if you'd rather pay once — four months free</li>
            <li>Cancel anytime, export your data whenever</li>
          </ul>

          {/* The printed brochure says "free week, no card." The live trial is
              30 days and does take a card. Correcting it here, out loud, beats
              letting a man find out at the Stripe screen and decide we lied. */}
          {partner?.printedTrialIsWrong ? (
            <p className="st-fineprint">
              <strong>Straight up about the card in your hand:</strong> it says a free week. It's
              actually <strong>30 days free</strong> — and it does ask for a card up front so
              nothing shuts off on you mid-job. <strong>$0 charged today</strong>, billing starts
              on day 31, cancel before then and you're not charged at all.
            </p>
          ) : (
            <p className="st-fineprint">
              <strong>30 days free — $0 charged today.</strong> Card up front so it doesn't shut
              off on you mid-job. Billing starts day 31. Cancel anytime.
            </p>
          )}

          <a className="st-cta st-cta-big" href={SIGNUP_URL} onClick={cta('final')}>
            Start my 30 days free
          </a>
          <p className="st-note">Set up takes about five minutes. Your crew can clock in tomorrow morning.</p>
        </div>
      </section>

      {/* Sticky on phones — most of these scans happen standing in a driveway. */}
      <div className="st-sticky">
        <a href={SIGNUP_URL} onClick={cta('sticky')}>Start free — 30 days</a>
      </div>

      <footer className="st-footer">
        <a href="/remodelers">More on JobTally</a>·<a href="/privacy.html">Privacy</a>·
        <a href="/terms.html">Terms</a>·<a href="/login">Sign in</a>
        <div style={{ marginTop: 8 }}>JobTally · getjobtally.com</div>
      </footer>
    </div>
  )
}
