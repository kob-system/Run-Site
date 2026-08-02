import React, { useEffect } from 'react'
import './HowItWorks.css'
import VideoBlock from '../components/VideoBlock'
import { track, trackOnce, EV } from '../utils/analytics'

// Public instructions page at /how-it-works — the written manual that sits
// next to the walkthrough video. Rendered before any auth check (App.js) so a
// stranger, a trial owner and a crew member can all read it.
//
// Every claim on this page has to survive being read next to the live app.
// Things that are NOT true and must never appear here: clients e-signing in
// the app, clients paying inside the app, payroll filing, and a "free trial,
// no card" (the trial is 30 days and it does take a card up front).
const SIGNUP_URL = '/login?signup=1'

// The order matches the video, and the video starts where the money is —
// materials, labor, profit — because that's the reason anyone signs up.
const STEPS = [
  {
    n: '01',
    title: 'The money on a job',
    where: 'Jobs → pick a job → Money',
    body:
      "Every job carries four numbers: your contract price, what you budgeted for materials, what you budgeted for labor, and the profit you want to walk away with. The Money tab shows those against what has actually gone out — real receipts, real clocked hours — so you can see what's left for you while the job is still running.",
    points: [
      'Contract price, materials and labor, side by side with what you have actually spent',
      'Projected profit and margin, updated as your crew clocks in and receipts land',
      'Extras and add-ons tracked separately, so change-order work does not quietly eat the job',
    ],
  },
  {
    n: '02',
    title: 'Everything that happens on the job',
    where: 'Jobs → pick a job → Work, Plan, Docs',
    body:
      'The Work tab is the running record of the job: hours, receipts, mileage and daily notes, each in its own section you can open and close. Plan holds the schedule, the shopping list and the fix-it (punch) list. Docs holds permits and inspections. Everything you log here books to this job and nowhere else.',
    points: [
      'Time — every clocked shift, who worked it, and what it cost you',
      'Receipts — photograph one and it reads the store, the total, the sales tax and the date',
      'Mileage and daily notes — the small stuff that never makes it into a notebook',
      'Shopping list and fix-it list, so the punch list stops living on the back of an envelope',
    ],
  },
  {
    n: '03',
    title: 'Starting a job',
    where: 'Jobs → + New job',
    body:
      'Name, client, address, then three numbers: materials, labor and the profit you want. JobTally adds them up into your contract price, so you are quoting off costs instead of a gut feeling. Takes about thirty seconds.',
    points: [
      'Materials + labor + profit = your contract price, added up for you',
      'Client name, phone and job address stay attached to the job',
      'Change any of it later — the profit numbers re-figure themselves',
    ],
  },
  {
    n: '04',
    title: 'Your crew',
    where: 'Crew',
    body:
      "Add each guy once and set his hourly rate. Then assign him to a job — that assignment is what puts the job on his phone and lets him clock in on it. His clock-in is stamped with where he was standing when he tapped it. It is one stamp at the start, not a tracker that follows him around all day.",
    points: [
      'Set a rate once — every hour he clocks costs the job the right amount',
      'Assign him to a job so it shows up on his phone',
      "Weekly pay totals come straight out of clocked hours (JobTally does not file payroll or move money)",
      'Your crew can log expenses and notes on the job too, not just hours',
    ],
  },
  {
    n: '05',
    title: 'Quote it, bill it, get paid',
    where: 'Money → Estimates, Invoices, Clients',
    body:
      'Write an estimate on your phone and send it. When the client says yes, one tap turns that estimate into a live job with the numbers already in it. Invoices come out of the same numbers, and you mark them paid when the money actually shows up.',
    points: [
      'Estimate → accepted → job, without retyping anything',
      'Invoice off the real job numbers, then mark it paid when you are paid',
      'Client list shows everyone you have worked with and what they still owe',
      'Clients do not sign or pay inside the app — you send it, they pay you the way they always have',
    ],
  },
  {
    n: '06',
    title: 'Knowing where you stand',
    where: 'Money → Business health, Reports',
    body:
      'One screen for the whole business: who owes you and how far behind they are, what you collected this month, and how many jobs you won. At year end, the reports section packs it up for your accountant.',
    points: [
      'Outstanding money, aged — you stop finding out in March',
      'Collected by month and jobs won, so you can see the trend',
      'Tax pack and QuickBooks-ready exports; everything exports to a spreadsheet, anytime',
    ],
  },
  {
    n: '07',
    title: 'The assistant — just tell it what you need',
    where: 'The ✨ button, any screen',
    body:
      'Tap the sparkle and either ask a question about your business or tell it to do something. Ask "where do I stand this month" and it answers off your real numbers. Tell it "add a worker named Luis at 32 an hour" and it walks you through the missing pieces one question at a time, shows you exactly what it is about to save, and waits. Nothing is written until you hit Confirm.',
    points: [
      'Ask anything — your jobs, your money, who owes you',
      'Tell it to add a job, a worker, an expense — one question at a time',
      'It shows you the finished thing before it saves it. Nothing saves until you Confirm.',
      'Tap a template chip if you would rather not type',
    ],
  },
  {
    n: '08',
    title: 'Setting it up once',
    where: 'More',
    body:
      'The stuff you set up in the first fifteen minutes and then forget about: your business name, address and logo (they land on every estimate and invoice), your insurance and license expiry dates so nothing lapses on you, and your callback/warranty list for work that comes back.',
    points: [
      'Business info, so estimates and invoices go out looking like a real company',
      'Insurance and license reminders before they expire, not after',
      'Callbacks and warranty work, tracked against the original job',
      'Your subscription and billing live here too',
    ],
  },
]

const FIRST_DAY = [
  'Sign up and put in your business name — five minutes.',
  'Add your crew and set each guy’s hourly rate.',
  'Create your first job: materials, labor, profit. Let it price the contract.',
  'Assign your crew to that job so it lands on their phones.',
  'Tomorrow morning they tap Clock In, and you start seeing the number.',
]

export default function HowItWorks() {
  useEffect(() => {
    document.title = 'How JobTally works — the full walkthrough'
    trackOnce(EV.LANDING_VIEW, { page: 'how-it-works' })
  }, [])

  const cta = (where) => () => track(EV.LANDING_CTA, { where: `howitworks-${where}` })

  return (
    <div className="hw">
      <header className="hw-top">
        <a className="hw-logo" href="/">JobTally</a>
        <nav>
          <a className="hw-signin" href="/login">Sign in</a>
          <a className="hw-cta-sm" href={SIGNUP_URL} onClick={cta('topbar')}>Start free</a>
        </nav>
      </header>

      <section className="hw-hero">
        <div className="hw-inner">
          <div className="hw-eyebrow">How it works</div>
          <h1>Every screen in the app, and what you do with it.</h1>
          <p className="hw-sub">
            Watch the walkthrough or read it below — same eight things, either way.
            This is the live app, not a mock-up.
          </p>
        </div>
      </section>

      <VideoBlock
        name="howTo"
        footer={<>Prefer to read? The whole thing is written out below.</>}
        onPlay={() => track(EV.LANDING_CTA, { where: 'howitworks-video-play' })}
      />

      <section className="hw-steps">
        <div className="hw-inner">
          {STEPS.map((s) => (
            <article className="hw-step" key={s.n} id={`step-${s.n}`}>
              <div className="hw-step-n">{s.n}</div>
              <div className="hw-step-body">
                <h2>{s.title}</h2>
                <div className="hw-where">{s.where}</div>
                <p>{s.body}</p>
                <ul>
                  {s.points.map((p) => <li key={p}>{p}</li>)}
                </ul>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="hw-firstday">
        <div className="hw-inner">
          <h2>Your first fifteen minutes</h2>
          <ol>
            {FIRST_DAY.map((f) => <li key={f}>{f}</li>)}
          </ol>
          <p className="hw-firstday-note">
            A setup guide walks you through these the first time you sign in, and checks
            each one off as you go.
          </p>
        </div>
      </section>

      <section className="hw-final">
        <div className="hw-inner">
          <h2>Know your number before the job’s over.</h2>
          <a className="hw-cta" href={SIGNUP_URL} onClick={cta('final')}>
            Start your 30-day free trial
          </a>
          <div className="hw-cta-note">
            Free for 30 days — $0 charged today. Then $150/mo, or $1,200/yr. Cancel anytime.
          </div>
        </div>
      </section>

      <footer className="hw-footer">
        <a href="/">Home</a>·<a href="/remodelers">For remodelers</a>·
        <a href="/privacy.html">Privacy</a>·<a href="/terms.html">Terms</a>·
        <a href="/login">Sign in</a>
        <div style={{ marginTop: 8 }}>JobTally · getjobtally.com</div>
      </footer>
    </div>
  )
}
