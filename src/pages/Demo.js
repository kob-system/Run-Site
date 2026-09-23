import React, { useEffect } from 'react'
import './Demo.css'
import { track, trackOnce, EV } from '../utils/analytics'

// /demo — three short videos, no signup, no account, no card.
//
// 2026-09-23: replaced the click-around "Reynolds Contracting" sample.
// JP's own read after using it: "not very understandable... they can't put
// in any receipts, they can't put in any hours, so it just beats the
// point." The Ask tab only ever replayed three canned phrases dressed up as
// free input — it looked like you could type your own numbers in and you
// couldn't, which is worse than not offering it. He said a video would be
// easier, so this is now the intro video plus the two real narrated
// walkthroughs (owner side, worker side) that already exist at
// public/walkthrough/ for logged-in users — reused here as the front door
// instead of being hidden behind a real account.
const VIDEOS = [
  {
    id: 'intro',
    label: 'The introduction',
    length: '2 min',
    desc: "What it is and who it's for.",
    src: '/landing/JobTally-Intro.mp4',
    poster: '/landing/intro-poster.jpg',
  },
  {
    id: 'owner',
    label: 'Your side',
    length: '3 min',
    desc: 'What you see as the owner — what you\'re owed, job profit, live.',
    src: '/walkthrough/owner.mp4',
    poster: '/walkthrough/owner.jpg',
    captions: '/walkthrough/owner.vtt',
  },
  {
    id: 'worker',
    label: "Your crew's side",
    length: '1 min',
    desc: 'What a worker sees when they clock in and log a receipt.',
    src: '/walkthrough/worker.mp4',
    poster: '/walkthrough/worker.jpg',
    captions: '/walkthrough/worker.vtt',
  },
]

export default function Demo() {
  useEffect(() => { trackOnce(EV.LANDING_CTA, { where: 'demo-open' }) }, [])
  // /demo sits in sitemap.xml at priority 0.9, so it needs its own title and
  // description rather than inheriting index.html's generic pair.
  useEffect(() => {
    const prevTitle = document.title
    document.title = 'Watch JobTally — 3 short videos, no signup'
    const desc = document.querySelector('meta[name="description"]')
    const prevDesc = desc ? desc.content : null
    if (desc) desc.content = 'The introduction, the owner\'s side, and the worker\'s side. Six minutes total, no signup, no card.'
    return () => {
      document.title = prevTitle
      if (desc && prevDesc !== null) desc.content = prevDesc
    }
  }, [])

  return (
    <div className="dm">
      <header className="dm-top">
        <a className="dm-logo" href="/">JobTally</a>
        <nav>
          <a className="dm-signin" href="/login">Sign in</a>
          <a className="dm-cta-sm" href="/login?signup=1" onClick={() => track(EV.LANDING_CTA, { where: 'demo-topbar' })}>Start free</a>
        </nav>
      </header>

      <div className="dm-head">
        <p className="dm-kicker">Three videos · nothing to sign up for</p>
        <h1>See it before you touch it.</h1>
        <p className="dm-lede">
          The intro, then what it looks like from your side and your crew's side. Six
          minutes total, watch whichever one you actually need.
        </p>
      </div>

      <div className="dm-videos">
        {VIDEOS.map((v) => (
          <div className="dm-video-card" key={v.id}>
            <div className="dm-video-meta">
              <span className="dm-video-label">{v.label}</span>
              <span className="dm-video-length">{v.length}</span>
            </div>
            <video
              controls
              playsInline
              preload="metadata"
              poster={v.poster}
              onPlay={() => track(EV.LANDING_CTA, { where: 'demo-video-' + v.id })}
            >
              <source src={v.src} type="video/mp4" />
              {v.captions && <track kind="captions" srcLang="en" label="English" src={v.captions} default />}
              Your browser can't play this video.
            </video>
            <p className="dm-video-desc">{v.desc}</p>
          </div>
        ))}
      </div>

      <div className="dm-videos-cta">
        <a className="dm-cta" href="/login?signup=1" onClick={() => track(EV.LANDING_CTA, { where: 'demo-side' })}>
          Start free — no card
        </a>
        <p className="dm-fine">No card. One job free forever, then $150/mo for more at once — everything included, unlimited crew.</p>
      </div>

      <div className="dm-foot">
        <a href="/">← Back to the home page</a>
      </div>
    </div>
  )
}
