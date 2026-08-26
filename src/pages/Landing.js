import React, { useEffect, useRef, useState } from 'react'
import './Landing.css'
import { supabase } from '../supabaseClient'
import { track, trackOnce, EV } from '../utils/analytics'
import InstallButton from '../components/InstallButton'

// Public landing page at / — what a stranger sees before they have an
// account. Rendered before the Login screen (App.js) for logged-out
// visitors; logged-in users never hit it. Screenshots in /landing/* are
// REAL app screens from the demo company (Summit Remodeling) — nothing
// mocked up. CTAs point at the real signup: /login?signup=1 opens the
// Create Account form. New owners get a one job free, forever that DOES take a
// card up front (Stripe trial_period_days=30, see api/create-checkout-session
// — the old app-side no-card window is retired). Never write "no card
// required" here: no invented trials, no invented pricing.
const SIGNUP_URL = '/login?signup=1'

const FEATURES = [
  {
    img: '/landing/clockin-active.png',
    alt: 'JobTally crew clock-in screen with GPS stamp',
    kicker: 'Crew hours',
    title: 'Your crew clocks in and out with one tap — both GPS-stamped',
    body:
      "Your guys tap one button on their phone and they're on the clock, and that tap stamps where they were standing when they made it. Same when they tap out. You get an email the moment anyone clocks in or out. No more \"I was there at 7\" — or \"I stayed till 4.\" Two stamps, start and finish, not a tracker — nothing follows your crew around in between, which is why they'll actually use it.",
  },
  {
    img: '/landing/receipts-list.png',
    alt: 'JobTally receipts list booked to a job',
    kicker: 'Receipts',
    title: 'Snap a receipt — store, total, tax and date fill themselves in',
    body:
      'Take a photo at the register and JobTally reads the store, the total, the sales tax and the date off it, and drops them into a new expense — you just tap the job it belongs to. The pile of crumpled receipts on the dash stops existing, and because the tax and the real purchase date are already on there, tax time stops being a nightmare weekend.',
  },
  {
    img: '/landing/job-profit.png',
    alt: 'JobTally job screen showing live materials, labor, and projected profit',
    kicker: 'Profit',
    title: "See what every job is making — while it's still running",
    body:
      "Every job shows what you're charging, what's gone out in labor and materials, and what's left for you — live, not three months later when it's too late to fix. If a job starts bleeding, you know that week.",
  },
  {
    img: '/landing/estimate-sent.png',
    alt: 'JobTally estimate ready to send, with one-tap accept to job',
    kicker: 'Getting paid',
    title: 'Estimate → invoice → paid, all from your phone',
    body:
      'Write the estimate on your phone, send it, and turn a "yes" into a job with one tap. Invoices come out of the same numbers, and the home screen always shows exactly who still owes you what.',
  },
]

// Was its own full-width section ("Open the app, see your money") sitting right
// under What it does — the same kind of claim, about the same product, in a
// different layout, which is most of why this page felt like it repeated itself.
// It's a feature. It goes in the feature list.
const HOME_FEATURE = {
  img: '/landing/home-owed.png',
  alt: 'JobTally home screen showing money owed to you and the guided setup checklist',
  kicker: 'Your home screen',
  title: 'Open it and the first thing you see is what you’re owed',
  body:
    "Active jobs, open estimates and your projected profit sit right underneath it. And you're never left guessing what to do first — a setup guide walks you through your first job, your crew, your first estimate and your first invoice, ticking each step off by itself as you go.",
}
const INCLUDED = [
  'Talk to it instead of tapping',
  'Crew GPS time clock',
  'Crew pay totals',
  'Estimates & invoices',
  'Client list',
  'Receipt scanning',
  'Mileage tracking',
  'Job photos & daily logs',
  'Schedule & time off',
  'Business health dashboard',
  'Reports & tax exports',
  'Insurance & license reminders',
  'Works on any phone — no install',
]

const FAQS = [
  {
    q: 'Do I need a credit card to try it?',
    a: 'There is no card at signup. You run one job free, for as long as you want. When you need a second job open at the same time it is $150/mo — every feature, unlimited crew.',
  },
  {
    q: 'What does my crew have to do?',
    a: 'Nothing. You text each guy an invite link, he taps it, and he is in — you already typed his name when you made the link, so there is nothing for him to fill in. No password, no email, nothing to download. From then on his whole app is basically one big Clock In / Clock Out button. If he can text, he can use it.',
  },
  {
    q: "I'm not a tech guy. How long is setup?",
    a: 'About five minutes. When you first sign in, a setup guide walks you through your first job, your crew, your first estimate and invoice — each step checks itself off as you go.',
  },
  {
    q: 'Do I really just talk to it?',
    a: 'Yes. Hold the mic and say it the way you\'d say it to a foreman — "Dave was on the Miller deck six hours," "how much am I making on the Klein job" — and it does it and reads the answer back. It always shows you what it\'s about to save before it saves, so it can\'t put something in your books you didn\'t agree to. Your crew can use it too, for clocking in and logging receipts.',
  },
  {
    q: 'What if I want out?',
    a: 'Cancel anytime, no contract. Your data stays yours — you can export everything to a spreadsheet whenever you want, even after you cancel your subscription. And if you want it all gone, there\'s a delete button in Settings that erases the whole account.',
  },
]

export default function Landing() {
  // Real customer quotes, approved by hand in Supabase (testimonials.approved).
  // Empty until someone actually says something — the section simply doesn't
  // render rather than shipping invented praise.
  const [quotes, setQuotes] = useState([])

  useEffect(() => {
    document.title = 'JobTally — know what every job really makes'
    // Top of the funnel. Once per tab so a re-render doesn't inflate it.
    trackOnce(EV.LANDING_VIEW)
  }, [])

  useEffect(() => {
    let alive = true
    supabase
      .from('testimonials')
      .select('id, quote, author_name, company_name, city, rating')
      .eq('approved', true)
      .order('created_at', { ascending: false })
      .limit(6)
      .then(({ data, error }) => {
        // A missing table (migration not run) or an RLS refusal both just mean
        // "no proof to show" — never an error on a stranger's first visit.
        if (alive && !error && data) setQuotes(data)
      })
    return () => { alive = false }
  }, [])

  // Which CTA got the click matters — hero vs pricing vs final tells us whether
  // the page sells on the promise or on the price.
  const cta = (where) => () => track(EV.LANDING_CTA, { where })

  // Two videos sit on this page and they answer different questions: "did a
  // stranger trust a face enough to press play" vs "did they stay for the
  // product". Each gets its own guard so one play is one event, not one per
  // scrub, and its own `where` so the two never collapse into each other.
  const introPlayedRef = useRef(false)
  const onIntroPlay = () => {
    if (introPlayedRef.current) return
    introPlayedRef.current = true
    track(EV.LANDING_CTA, { where: 'intro-video-play' })
  }
  const pitchPlayedRef = useRef(false)
  const onPitchPlay = () => {
    if (pitchPlayedRef.current) return
    pitchPlayedRef.current = true
    track(EV.LANDING_CTA, { where: 'video-play' })
  }

  return (
    <div className="ld">
      {/* Top bar */}
      <header className="ld-top">
        <a className="ld-logo" href="/">JobTally</a>
        <nav>
          <a className="ld-signin" href="/login">Sign in</a>
          <a className="ld-cta-sm" href={SIGNUP_URL} onClick={cta('topbar')}>Start free</a>
        </nav>
      </header>

      {/* Hero */}
      <section className="ld-hero">
        <div className="ld-hero-grid">
          <div className="ld-hero-copy">
            <h1>Know what every job really makes.</h1>
            <p className="ld-sub">
              JobTally tracks your crew's hours, your receipts, and your profit — live,
              from the phone already in your pocket. Built for contractors running a
              2–10 man crew.
            </p>
            <a className="ld-cta" href={SIGNUP_URL} onClick={cta('hero')}>Start free — no card</a>
            <div className="ld-cta-note">One job, free forever — no card. $150/mo when you want two at once.</div>
            <a className="ld-intro-link" href="#intro">
              <span className="ld-play" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5v14l11-7Z" /></svg>
              </span>
              New here? Start with the 3-minute introduction
            </a>
            {/* The demo sits right under the primary CTA because it converts
                the visitor who is NOT ready to hand over a card yet — which,
                on a page whose trial asks for one up front, is most of them.
                Watching a video is passive; tapping through the actual app is
                the thing that makes someone believe it. */}
            <a className="ld-demo-link" href="/demo" onClick={cta('hero-demo')}>
              Or try it yourself — no signup, no card
            </a>
            <ul className="ld-trust">
              <li>Set up in ~5 minutes</li>
              <li>Works on any phone</li>
              <li>No modules, no training, no 3-week setup</li>
            </ul>
            {/* The strongest objection-killer we have and it went unsaid for
                months: there is nothing to download. Renders only on a phone
                that can actually act on it. */}
            <div className="ld-a2hs">
              <div className="ld-a2hs-copy">
                <strong>Nothing to download.</strong> No app store, no waiting — it's a web page.
                Put it on your home screen and it opens like anything else on your phone.
              </div>
              <InstallButton />
            </div>
          </div>
          <div className="ld-hero-shot">
            <div className="ld-phone">
              <img src="/landing/jobs-list.png" alt="JobTally jobs list showing live projected profit per job" width="390" height="844" />
            </div>
            <div className="ld-shot-caption">Real screens from the app — this is what you get.</div>
          </div>
        </div>
      </section>
      {/* Features — alternating rows, real screenshots */}
      <section className="ld-features">
        <div className="ld-inner">
          <h2>What it does</h2>
          <p className="ld-kicker">Five things, done properly. Sign up and it works.</p>
          {[...FEATURES, HOME_FEATURE].map((f, i) => (
            <div className={'ld-row' + (i % 2 ? ' ld-row-flip' : '')} key={f.title}>
              <div className="ld-row-copy">
                <div className="ld-row-kicker">{f.kicker}</div>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </div>
              <div className="ld-row-shot">
                <div className="ld-phone ld-phone-sm">
                  <img src={f.img} alt={f.alt} loading="lazy" width="390" height="844" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
      {/* The assistant. This is the one thing in JobTally that no competitor
          has, it has been live in production since June, and until now the
          landing page did not mention it once — a visitor could read this
          entire page and never learn the app can be talked to.
          No screenshot on purpose: a still frame of a chat panel is the least
          convincing possible way to sell "you can just say it out loud." The
          spoken sentences ARE the demo, so they're the whole section. Kept to
          one tight band because the page's last pass was specifically about
          not describing the product four times. */}
      <section className="ld-say">
        <div className="ld-inner">
          <div className="ld-say-kicker">The part nobody else has</div>
          <h2>Or don't tap anything. Just say it.</h2>
          <p className="ld-say-lede">
            Hold the mic and talk like you'd talk to a foreman. It does the work, reads the
            answer back out loud, and shows you exactly what it's about to save before it
            saves it. Built for a truck, a job site, and hands that aren't clean.
          </p>
          <div className="ld-say-list">
            {[
              {
                said: '"Put Dave and Tony on the Miller deck, six hours each, and I drove fifteen miles each way."',
                did: 'Two time entries and a mileage trip — one confirmation, all at once.',
              },
              {
                said: '"How much am I actually making on the Klein bathroom?"',
                did: 'Reads you the contract, what’s gone out in labor and materials, and what’s left.',
              },
              {
                said: '"New job, Delgado basement, twenty-two thousand."',
                did: 'Walks you through it one question at a time and creates the job.',
              },
            ].map((x) => (
              <div className="ld-say-item" key={x.said}>
                <div className="ld-say-said"><span aria-hidden="true">🎤</span> {x.said}</div>
                <div className="ld-say-did">{x.did}</div>
              </div>
            ))}
          </div>
          <p className="ld-say-foot">
            Your crew gets it too — they can clock in, log a receipt, or ask for a day off
            without learning a single screen.
          </p>
        </div>
      </section>
      {/* Why this exists — origin story / trust band */}
      <section className="ld-story">
        <div className="ld-inner ld-story-inner">
          <div className="ld-story-kicker">Why this exists</div>
          <h2>Built for a contractor who was losing money he couldn't see.</h2>
          <p>
            JobTally started with a contractor friend of ours in Troy, NY. Good builder, steady
            work, crew of guys who showed up. His system: crew hours scribbled in
            <strong> spiral notebooks</strong>, and every receipt from the supply house stuffed into
            a <strong>plastic sheet</strong> in the truck — crumpled, coffee-stained, half of them
            faded to nothing.
          </p>
          <p>
            Ask him if a job made money and he'd say "pretty sure." Come tax time it was a
            <strong> nightmare weekend</strong> of flattening receipts on the kitchen table, trying
            to remember which job the lumber run belonged to. He wasn't losing money because he was
            bad at building — he was losing it because nobody could see the numbers until it was way
            too late.
          </p>
          <p className="ld-story-punch">
            <strong>So we built JobTally to kill that.</strong> The notebook, the plastic sheet, the
            tax-time archaeology — all of it. One app, on the phones you and your crew already carry,
            that keeps score while the job is running.
          </p>
          <a className="ld-intro-link" href="#intro">
            <span className="ld-play" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5v14l11-7Z" /></svg>
            </span>
            Hear it from the guy who built it — 3-minute introduction
          </a>
        </div>
      </section>
      {/* Introduction — a face and the honest origin, before anyone is asked
          for anything. Same file and same placement rule as /remodelers: it
          sits ABOVE the walkthrough, because the intro's closing line points
          down at it. 14 MB, so preload="none" — a guy standing on a job site
          on cell data downloads nothing until he actually presses play. */}
      <section className="ld-intro" id="intro">
        <div className="ld-inner">
          <h2>Introduction video</h2>
          <p className="ld-kicker">John Paul Kobrossi — the builder of JobTally</p>
          <div className="ld-video-frame">
            <video
              controls
              playsInline
              preload="none"
              poster="/landing/intro-poster.jpg"
              src="/landing/JobTally-Intro.mp4"
              onPlay={onIntroPlay}
            >
              Your browser can't play this video.
            </video>
          </div>
          <div className="ld-video-after">
            <a className="ld-cta" href={SIGNUP_URL} onClick={cta('intro-video')}>Start free — no card</a>
            <div className="ld-cta-note">Or watch the walkthrough below first — no sign-up needed for either.</div>
          </div>
        </div>
      </section>
      {/* How it works */}
      <section className="ld-how">
        <div className="ld-inner">
          <h2>Up and running by tomorrow morning</h2>
          <div className="ld-steps">
            <div className="ld-step">
              <span className="ld-step-num">1</span>
              <h3>Create your account</h3>
              <p>Two minutes. Your name, your company, done. No card.</p>
            </div>
            <div className="ld-step">
              <span className="ld-step-num">2</span>
              <h3>Add your first job</h3>
              <p>The setup guide walks you through it step by step.</p>
            </div>
            <div className="ld-step">
              <span className="ld-step-num">3</span>
              <h3>Text your crew the invite link</h3>
              <p>He taps it once and he is in. Nothing to type, no password.</p>
            </div>
          </div>
        </div>
      </section>
      {/* Social proof — real, approved quotes only. Renders nothing until there
          are some, because a fake testimonial is worse than no testimonial. */}
      {quotes.length > 0 && (
        <section className="ld-proof">
          <div className="ld-inner">
            <h2>From contractors running it</h2>
            <div className="ld-proof-grid">
              {quotes.map((t) => {
                const who = [t.author_name, t.company_name].filter(Boolean).join(' · ')
                return (
                  <figure className="ld-proof-card" key={t.id}>
                    {t.rating ? <div className="ld-proof-stars" aria-label={`${t.rating} out of 5`}>{'★'.repeat(t.rating)}</div> : null}
                    <blockquote>{t.quote}</blockquote>
                    {(who || t.city) && (
                      <figcaption>
                        {who}{who && t.city ? ' — ' : ''}{t.city}
                      </figcaption>
                    )}
                  </figure>
                )
              })}
            </div>
          </div>
        </section>
      )}

      {/* Watch-it-run video — click-to-play, nothing loads until they hit play */}
      <section className="ld-video" id="video">
        <div className="ld-inner">
          <h2>See it run — 3-minute walkthrough</h2>
          <p className="ld-kicker">Watch a real job go from clock-in to profit. No sign-up needed.</p>
          <div className="ld-video-frame">
            <video
              controls
              playsInline
              preload="none"
              poster="/landing/pitch-poster.jpg"
              src="/landing/JobTally-Pitch.mp4"
              onPlay={onPitchPlay}
            >
              Your browser can't play this video.
            </video>
          </div>
        </div>
      </section>
      <section className="ld-pricing">
        <div className="ld-inner">
          <h2>One price. Everything. No games.</h2>
          <div className="ld-price-card">
            <div className="ld-price">$150<span>/mo</span></div>
            <ul>
              <li>Unlimited crew — no per-seat charges</li>
              <li>Every feature included, nothing gated</li>
              <li>One job free, forever — no card</li>
              <li>$1,200/yr if you'd rather pay once (4 months free)</li>
              <li>Cancel anytime — your data stays yours, export it whenever</li>
            </ul>
            {/* The old "Everything's included. Nothing's gated." section was a
                third full-width pass over the feature list, three screens above
                the price. It answers one question — what do I get for $150 —
                so it belongs where that question gets asked. */}
            <div className="ld-price-inc">
              <div className="ld-price-inc-head">Everything, for that one price</div>
              <ul className="ld-inc-grid">
                {INCLUDED.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
            <a className="ld-cta" href={SIGNUP_URL} onClick={cta('pricing')}>Start free — no card</a>
            <p className="ld-price-note">
              One caught receipt pile or one job that stops bleeding pays for the year.
            </p>
          </div>
        </div>
      </section>
      {/* FAQ */}
      <section className="ld-faq">
        <div className="ld-inner">
          <h2>Straight answers</h2>
          <div className="ld-faq-list">
            {FAQS.map((f) => (
              <div className="ld-faq-item" key={f.q}>
                <h3>{f.q}</h3>
                <p>{f.a}</p>
              </div>
            ))}
          </div>
          {/* The full FAQ and the trust page are real URLs a stranger can read
              before signing up — and the ones a skeptical contractor goes
              looking for. Buried in the footer they were effectively hidden. */}
          <p className="ld-faq-more">
            <a href="/faq/">Every question, answered in full</a> · <a href="/your-data/">What happens to your data</a>
          </p>
        </div>
      </section>
      {/* Free calculator — the give-before-you-ask page. It lived only as an
          anchor two thirds down /remodelers (one partner's flyer page), so the
          home page never sent anyone to the one thing a contractor will use
          before he trusts us. */}
      <section className="ld-calc-strip">
        <div className="ld-inner">
          <h2>Not ready to sign up? Run your last job through it.</h2>
          <p>
            Contract price, hours, materials, overhead — thirty seconds and you'll see what that
            job really made. Free, no signup, no card.
          </p>
          <a className="ld-cta" href="/calculator" onClick={cta('calculator')}>
            Open the free profit calculator
          </a>
        </div>
      </section>
      {/* Final CTA */}
      <section className="ld-final">
        <h2>Know your number before the job's over.</h2>
        <p>Setup takes about five minutes. Your crew clocks in tomorrow morning.</p>
        <a className="ld-cta" href={SIGNUP_URL} onClick={cta('final')}>Start free — no card</a>
        <a className="ld-intro-link ld-intro-link-onnavy" href="#intro">
          <span className="ld-play" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5v14l11-7Z" /></svg>
          </span>
          Still deciding? Watch the 3-minute introduction
        </a>
      </section>

      <footer className="ld-footer">
        <a href="/login">Sign in</a>·<a href="/faq/">FAQ</a>·<a href="/calculator">Profit calculator</a>·<a href="/your-data/">Your data</a>·<a href="/remodelers">For remodelers</a>·<a href="/privacy.html">Privacy</a>·<a href="/terms.html">Terms</a>
        <div style={{ marginTop: 8 }}>JobTally · getjobtally.com</div>
      </footer>
    </div>
  )
}
