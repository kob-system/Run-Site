import React, { useEffect } from 'react'
import './Landing.css'

// A real not-found page.
//
// THE PROBLEM IT FIXES: vercel.json rewrites every non-/api path to
// index.html so the SPA can own its routes, and App.js fell through to the
// LANDING PAGE for anything it didn't recognise. So
// getjobtally.com/any-nonsense answered HTTP 200 with a full marketing page.
// That's a "soft 404", and for a site running eleven SEO pages, a sitemap and
// a robots.txt that explicitly invites AI crawlers, it is a real cost: Google
// indexes junk URLs as valid pages, every typo'd or stale link looks alive,
// and the duplicate-content signal is spread across infinite addresses.
//
// A static SPA cannot return a genuine 404 status from the client, so we do
// the two things that DO work: tell search engines not to index this response
// with a robots meta tag (which Google honours for soft-404 detection), and
// tell the human plainly what happened and where to go.
export default function NotFound() {
  useEffect(() => {
    document.title = 'Page not found — JobTally'
    // noindex is the part that actually matters for SEO. Added at runtime and
    // removed on unmount so it can never leak onto a real page during a
    // client-side route change.
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex, follow'
    document.head.appendChild(meta)
    return () => { document.head.removeChild(meta) }
  }, [])

  return (
    <div className="ld">
      <header className="ld-top">
        <a className="ld-logo" href="/">JobTally</a>
        <nav>
          <a className="ld-signin" href="/login">Sign in</a>
          <a className="ld-cta-sm" href="/login?signup=1">Start free</a>
        </nav>
      </header>
      <section className="ld-hero">
        <div className="ld-inner" style={{ maxWidth: 640, textAlign: 'center' }}>
          <h1 style={{ marginBottom: 12 }}>That page isn't here.</h1>
          <p style={{ fontSize: 17, color: 'rgba(255,255,255,0.82)', lineHeight: 1.6, margin: '0 auto 8px' }}>
            The link might be old, or there might be a typo in it. Nothing is broken on your end.
          </p>
          <a className="ld-cta" href="/">Go to the home page</a>
          <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.6)', marginTop: 26, lineHeight: 1.8 }}>
            Looking for something specific?<br />
            <a href="/demo" style={{ color: 'var(--orange)', fontWeight: 700 }}>See it work</a>
            {' · '}
            <a href="/pricing/" style={{ color: 'var(--orange)', fontWeight: 700 }}>Pricing</a>
            {' · '}
            <a href="/login" style={{ color: 'var(--orange)', fontWeight: 700 }}>Sign in</a>
            {' · '}
            <a href="mailto:support@getjobtally.com" style={{ color: 'var(--orange)', fontWeight: 700 }}>Email us</a>
          </p>
        </div>
      </section>
    </div>
  )
}
