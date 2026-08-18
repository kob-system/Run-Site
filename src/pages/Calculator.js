import React, { useEffect } from 'react'
import ProfitCalculator from '../components/ProfitCalculator'
import { track, trackOnce, EV } from '../utils/analytics'
import './Remodelers.css'

// /calculator — the free Job Profit Calculator on its own URL.
//
// It already existed, buried two thirds of the way down /remodelers, which is a
// flyer landing page for one referral partner. A calculator is the piece a
// contractor searches for ("job profit calculator"), links to, and forwards to
// another contractor — none of which it can do while its only address is an
// anchor inside somebody else's campaign page.
//
// The arithmetic is NOT reimplemented here. Both pages render the same
// <ProfitCalculator/>, which is the same computeJobProfit() the app itself
// uses — two versions of "what did this job make" is the one bug this product
// cannot afford to ship.
const SIGNUP_URL = '/login?signup=1'

export default function Calculator() {
  useEffect(() => {
    trackOnce(EV.LANDING_VIEW, { page: 'calculator' })
  }, [])

  // Own title and description — it's in sitemap.xml, and a standalone page that
  // inherits index.html's generic pair is indistinguishable from the home page
  // in a search result. Restored on unmount so a client-side nav away doesn't
  // leave the calculator's title on the next screen.
  useEffect(() => {
    const prevTitle = document.title
    document.title = 'Free Job Profit Calculator for Contractors — JobTally'
    const desc = document.querySelector('meta[name="description"]')
    const prevDesc = desc ? desc.content : null
    if (desc) desc.content = 'Put your last job in and see what it really made after labor, materials and overhead. Free, no signup — from JobTally, job costing for small contractors.'
    return () => {
      document.title = prevTitle
      if (desc && prevDesc !== null) desc.content = prevDesc
    }
  }, [])

  const cta = (where) => () => track(EV.LANDING_CTA, { where, page: 'calculator' })

  return (
    <div className="rl">
      <header className="rl-top">
        <a className="rl-logo" href="/">JobTally</a>
        <nav>
          <a className="rl-signin" href="/login">Sign in</a>
          <a className="rl-cta-sm" href={SIGNUP_URL} onClick={cta('topbar')}>Start free</a>
        </nav>
      </header>

      <section className="rl-hero">
        <div className="rl-inner">
          <h1>What did that job actually make?</h1>
          <p className="rl-sub">
            Most contractors find out months later, if ever. Put your last finished job in below —
            contract price, hours, materials, overhead — and see the real number in about thirty
            seconds. Free, no signup, nothing to install.
          </p>
        </div>
      </section>

      <ProfitCalculator
        source="calculator-page"
        heading="Job Profit Calculator"
        kicker="Real numbers off a job you already finished work best. Nothing is saved unless you ask us to email it to you."
      />

      <section className="rl-prose">
        <div className="rl-inner">
          <h2>What the number is telling you</h2>
          <p>
            Overhead is the part most guys leave out, and it's why a job that "felt fine" can land
            under water. The truck, the insurance, the fuel, the phone, the hours you spend
            quoting — that all gets paid out of jobs, so a slice of every contract has to cover it.
            Ten percent is a common starting point; if you've never worked yours out, start there
            and adjust.
          </p>
          <p>
            <strong>Under 10% margin</strong> is one surprise away from red — a re-do, a busted
            water heater, two rain days. <strong>Twenty percent and up</strong> is the range that
            keeps the truck paid. And if the number came out negative, that job didn't just pay you
            less than you thought; you paid to do it.
          </p>
          <h2>The problem this calculator can't solve</h2>
          <p>
            This tells you about a job that's already over. You can't re-price a deck you finished
            in June. The number that changes anything is the one you can see <em>while the job is
            still running</em> — on Tuesday, when there's still time to call the client about the
            change order, pull a guy off, or stop eating a material overage.
          </p>
          <p>
            That's what JobTally does the rest of the week. Your crew clocks in from their phones,
            receipts get photographed at the counter, and the job's profit updates itself as the
            work happens. Same math as this page — it just doesn't wait until the job's over to
            show you.
          </p>
        </div>
      </section>

      <section className="rl-final">
        <h2>Know the number while you can still do something about it.</h2>
        <p>Setup takes about five minutes. Your crew clocks in tomorrow morning.</p>
        <a className="rl-cta" href={SIGNUP_URL} onClick={cta('final')}>Start your 30-day free trial</a>
        <div className="rl-cta-note">
          $0 charged today &mdash; 30 days free, cancel anytime. Or{' '}
          <a href="/demo" onClick={cta('demo')}>tap through the demo first</a>.
        </div>
      </section>
    </div>
  )
}
