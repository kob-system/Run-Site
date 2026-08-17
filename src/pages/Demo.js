import React, { useState, useRef, useEffect } from 'react'
import './Demo.css'
import { track, trackOnce, EV } from '../utils/analytics'

// /demo — the whole product in sixty seconds, no signup, no account, no card.
//
// WHY THIS IS ITS OWN COMPONENT AND NOT THE REAL DASHBOARD
// Two obvious approaches were rejected on purpose:
//   1. Run OwnerDashboard against fixture data. It is ~3,900 lines wired
//      directly to supabase.from(...) on every screen. Intercepting all of that
//      means threading a fake client through money-critical code that paying
//      customers depend on — a large regression surface for a marketing page.
//   2. A shared "demo login" everyone signs into. That needs a real auth
//      account with its password shipped in a public JS bundle, and the state
//      is shared and mutable: the first visitor who deletes a job ruins the
//      demo for everyone after them, forever, until someone notices.
// So this is a purpose-built walkthrough with its own data, reusing the app's
// real design language. Risk to the paid app: zero. It can never read or write
// a single row.
//
// WHAT IT HAS TO PROVE, in order:
//   1. "Open it and you see what you're owed."   -> Home
//   2. "Know if a job is making money RIGHT NOW." -> Job
//   3. "You don't even have to tap — just say it." -> Ask, and crucially the
//      numbers on the Job screen actually MOVE when you do. A demo where the
//      assistant prints a canned reply proves nothing; one where you say a
//      sentence and watch labor cost change proves the entire product.
// Everything is obviously a sample company. Never use a real client's name here.

const money0 = (n) => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US')
const money2 = (n) =>
  (n < 0 ? '-$' : '$') +
  Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// THE NUMBERS ARE THE MOST IMPORTANT THING ON THIS PAGE, and the first draft of
// them was wrong in a way worth recording. The math here mirrors the real app
// exactly (profit so far = contract − what's actually gone out), but the jobs
// were barely started, so a $22k job with $1.8k spent displayed a 92% margin.
// Faithful math, unbelievable output — and a contractor who reads "92% margin"
// concludes the product is lying to him and closes the tab.
//
// So every job here is genuinely underway, and the three of them deliberately
// tell three different stories, because a demo where everything is green
// proves nothing:
//   Maple    — healthy, mid-job. The one the assistant scene acts on.
//   Klein    — BLEEDING. Materials blew past budget and the margin is down to
//              10%. This is the whole product thesis in one card: you'd have
//              seen it the week it happened instead of at tax time.
//   Delgado  — solid, well run.
const START_JOBS = [
  {
    id: 'maple',
    name: 'Maple St. Deck',
    client: 'Karen Whitfield',
    contract: 18400,
    materials: 6780.44,
    materialsBudget: 7000,
    labor: 5420,
    laborBudget: 6000,
    invoiced: 9200,
    paid: 0,
  },
  {
    id: 'klein',
    name: 'Master Bath Reno – Klein',
    client: 'Dan Klein',
    contract: 24000,
    materials: 12400.18,
    materialsBudget: 9500,
    labor: 9150,
    laborBudget: 8000,
    invoiced: 12000,
    paid: 12000,
  },
  {
    id: 'delgado',
    name: 'Basement Finish – Delgado',
    client: 'Carlos Delgado',
    contract: 22000,
    materials: 8120.6,
    materialsBudget: 9000,
    labor: 6340,
    laborBudget: 7000,
    invoiced: 0,
    paid: 0,
  },
]

const spent = (j) => j.materials + j.labor
const profit = (j) => j.contract - spent(j)
const margin = (j) => (j.contract > 0 ? Math.round((profit(j) / j.contract) * 100) : 0)

// The three things a visitor can "say". Each one is a real tool the live
// assistant has, and each one visibly changes a number on the Job screen —
// that's the whole point of the scene.
const PHRASES = [
  {
    id: 'hours',
    said: 'Dave and Tony were on Maple St. six hours each today',
    thinking: 'Looking up your crew and the job…',
    card: {
      title: '2 things',
      lines: [
        'Log 6.0h for Dave Ruiz on Maple St. Deck — $198.00',
        'Log 6.0h for Tony Barnes on Maple St. Deck — $174.00',
      ],
    },
    done: () => 'Logged. That\'s $372.00 of labor on Maple St. Deck today.',
    apply: (j) => ({ ...j, labor: j.labor + 372 }),
  },
  {
    id: 'receipt',
    said: 'Add a receipt to Maple St., four hundred twelve dollars from Home Depot',
    thinking: 'Reading that back…',
    card: {
      title: '1 thing',
      lines: ['Add a $412.00 materials receipt from Home Depot to Maple St. Deck'],
    },
    // Computed from the job AFTER the change, never hardcoded — a demo that
    // states a total the screen next to it disagrees with is worse than no
    // demo, and hardcoding it guarantees that happens the moment the sample
    // numbers are ever retuned. (They were, an hour after this was written.)
    done: (j) =>
      `Saved. Maple St. Deck is now ${money2(j.materials)} into a ${money0(j.materialsBudget)} materials budget` +
      (j.materials > j.materialsBudget ? " — that's over. Worth a look before the next supply run." : '.'),
    apply: (j) => ({ ...j, materials: j.materials + 412 }),
  },
  {
    id: 'ask',
    said: 'Am I actually making money on Maple St.?',
    thinking: 'Adding up hours and receipts…',
    reply: true,
    apply: (j) => j,
  },
]

function Bar({ spent: s, budget, tone }) {
  const pct = budget > 0 ? Math.min(100, (s / budget) * 100) : 0
  const over = s > budget
  return (
    <div className="dm-bar">
      <div
        className={'dm-bar-fill' + (over ? ' dm-bar-over' : '')}
        style={{ width: `${Math.max(2, pct)}%`, background: over ? undefined : tone }}
      />
    </div>
  )
}

export default function Demo() {
  const [jobs, setJobs] = useState(START_JOBS)
  const [scene, setScene] = useState('home')
  const [openJob, setOpenJob] = useState('maple')
  // Assistant transcript: {who:'you'|'app', text, card?, state?}
  const [thread, setThread] = useState([])
  const [pending, setPending] = useState(null)
  const [used, setUsed] = useState([])
  const threadRef = useRef(null)

  useEffect(() => { trackOnce(EV.LANDING_CTA, { where: 'demo-open' }) }, [])
  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight
  }, [thread, pending])

  const job = jobs.find((j) => j.id === openJob) || jobs[0]
  const owed = jobs.reduce((s, j) => s + (j.invoiced - j.paid), 0)
  const projected = jobs.reduce((s, j) => s + profit(j), 0)

  const go = (s) => { setScene(s); track(EV.LANDING_CTA, { where: 'demo-tab-' + s }) }

  // Say one of the canned phrases. Deliberately staged with real delays — an
  // instant answer reads as a hardcoded string, and the pause is also honest
  // about what using it actually feels like.
  const say = (p) => {
    if (pending) return
    setUsed((u) => [...u, p.id])
    setThread((t) => [...t, { who: 'you', text: p.said }])
    setPending('thinking')
    setTimeout(() => {
      if (p.reply) {
        const m = jobs.find((j) => j.id === 'maple')
        setThread((t) => [...t, {
          who: 'app',
          text:
            `Maple St. Deck is a ${money0(m.contract)} job. You've spent ${money2(m.materials)} on materials ` +
            `and ${money2(m.labor)} on labor, so you're up ${money2(profit(m))} — about a ${margin(m)}% margin. ` +
            `You've invoiced ${money0(m.invoiced)} of it and none of that has come in yet.`,
        }])
        setPending(null)
      } else {
        setThread((t) => [...t, { who: 'app', card: p.card, state: 'confirm', phrase: p }])
        setPending(null)
      }
    }, 900)
  }

  const confirm = (p) => {
    setThread((t) => t.map((m) => (m.phrase === p ? { ...m, state: 'saved' } : m)))
    // Apply first, then report the result off the UPDATED job, so the sentence
    // the assistant says always matches the number now on the Job tab.
    const after = p.apply(jobs.find((j) => j.id === 'maple'))
    setJobs((js) => js.map((j) => (j.id === 'maple' ? after : j)))
    setTimeout(() => setThread((t) => [...t, { who: 'app', text: p.done(after) }]), 300)
  }

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
        <p className="dm-kicker">Live demo · nothing to sign up for</p>
        <h1>Have a poke around. It's the real thing.</h1>
        <p className="dm-lede">
          This is a sample contractor's account with three jobs running. Tap anything.
          Nothing you do here is saved anywhere, and you can't break it.
        </p>
      </div>

      <div className="dm-stage">
        <div className="dm-phone">
          <div className="dm-screen">
            <div className="dm-appbar">
              <span className="dm-appbar-name">Reynolds Contracting</span>
              <span className="dm-appbar-tag">SAMPLE</span>
            </div>

            {scene === 'home' && (
              <div className="dm-body">
                <div className="dm-owed">
                  <div className="dm-owed-label">Owed to you</div>
                  <div className="dm-owed-value">{money0(owed)}</div>
                  <div className="dm-owed-sub">across {jobs.filter(j => j.invoiced > j.paid).length} unpaid invoices</div>
                </div>
                <div className="dm-stats">
                  <div><b>{jobs.length}</b><span>Active jobs</span></div>
                  <div><b>{money0(projected)}</b><span>Projected profit</span></div>
                </div>
                <div className="dm-section-label">Your jobs</div>
                {jobs.map((j) => (
                  <button
                    key={j.id}
                    className="dm-jobcard"
                    onClick={() => { setOpenJob(j.id); go('job') }}
                  >
                    <div className="dm-jobcard-top">
                      <span className="dm-jobcard-name">{j.name}</span>
                      <span className={'dm-jobcard-profit' + (profit(j) < 0 ? ' dm-neg' : '')}>{money0(profit(j))}</span>
                    </div>
                    <div className="dm-jobcard-sub">
                      <span>{j.client}</span>
                      <span>{margin(j)}% so far</span>
                    </div>
                  </button>
                ))}
                <p className="dm-hint">Tap a job to see where its money went →</p>
              </div>
            )}

            {scene === 'job' && (
              <div className="dm-body">
                <button className="dm-back" onClick={() => go('home')}>‹ All jobs</button>
                <div className="dm-jobhead">
                  <h3>{job.name}</h3>
                  <p>{job.client}</p>
                </div>
                <div className="dm-profit">
                  <div className="dm-profit-label">Profit so far</div>
                  <div className={'dm-profit-value' + (profit(job) < 0 ? ' dm-neg' : '')}>{money2(profit(job))}</div>
                  <div className="dm-profit-sub">{margin(job)}% of a {money0(job.contract)} contract</div>
                </div>
                <div className="dm-line">
                  <div className="dm-line-top"><span>Materials</span><span>{money2(job.materials)} <i>/ {money0(job.materialsBudget)}</i></span></div>
                  <Bar spent={job.materials} budget={job.materialsBudget} tone="#E07B2A" />
                </div>
                <div className="dm-line">
                  <div className="dm-line-top"><span>Labor</span><span>{money2(job.labor)} <i>/ {money0(job.laborBudget)}</i></span></div>
                  <Bar spent={job.labor} budget={job.laborBudget} tone="#2F73B8" />
                </div>
                {job.materials > job.materialsBudget && (
                  <div className="dm-flag">Materials are over budget by {money2(job.materials - job.materialsBudget)}. You'd have known the week it happened.</div>
                )}
                <div className="dm-line dm-line-plain">
                  <div className="dm-line-top"><span>Invoiced</span><span>{money0(job.invoiced)}</span></div>
                  <div className="dm-line-top"><span>Paid</span><span>{money0(job.paid)}</span></div>
                </div>
                <p className="dm-hint">Now try the Ask tab — say something and watch these change.</p>
              </div>
            )}

            {scene === 'ask' && (
              <div className="dm-body dm-body-ask">
                <div className="dm-thread" ref={threadRef}>
                  {thread.length === 0 && (
                    <div className="dm-empty">
                      <div className="dm-empty-mic">🎤</div>
                      <p>In the real app you hold this and talk. Here, tap one below.</p>
                    </div>
                  )}
                  {thread.map((m, i) => {
                    if (m.who === 'you') return <div className="dm-msg dm-msg-you" key={i}>{m.text}</div>
                    if (m.card) {
                      return (
                        <div className="dm-confirm" key={i}>
                          <div className="dm-confirm-h">About to save — {m.card.title}</div>
                          <ul>{m.card.lines.map((l) => <li key={l}>{l}</li>)}</ul>
                          {m.state === 'confirm' ? (
                            <div className="dm-confirm-btns">
                              <button className="dm-btn-ghost" onClick={() => setThread((t) => t.map((x) => (x === m ? { ...x, state: 'nope' } : x)))}>No</button>
                              <button className="dm-btn" onClick={() => confirm(m.phrase)}>Confirm</button>
                            </div>
                          ) : (
                            <div className={'dm-confirm-state' + (m.state === 'nope' ? ' dm-neg' : '')}>
                              {m.state === 'saved' ? '✓ Saved' : 'Cancelled — nothing was saved'}
                            </div>
                          )}
                        </div>
                      )
                    }
                    return <div className="dm-msg dm-msg-app" key={i}>{m.text}</div>
                  })}
                  {pending && <div className="dm-msg dm-msg-app dm-thinking">Thinking…</div>}
                </div>
                <div className="dm-suggest">
                  {PHRASES.map((p) => (
                    <button
                      key={p.id}
                      className={'dm-chip' + (used.includes(p.id) ? ' dm-chip-used' : '')}
                      onClick={() => say(p)}
                      disabled={!!pending}
                    >
                      🎤 {p.said}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="dm-tabs">
              {[['home', 'Home'], ['job', 'Job'], ['ask', 'Ask']].map(([k, label]) => (
                <button key={k} className={'dm-tab' + (scene === k ? ' dm-tab-on' : '')} onClick={() => go(k)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="dm-side">
          <h2>What you're looking at</h2>
          <ol className="dm-steps">
            <li><b>Home</b> — the first thing you see every morning is what people owe you, not a menu.</li>
            <li><b>Job</b> — every job shows what's gone out and what's left, live. Not at tax time.</li>
            <li><b>Ask</b> — say it instead of tapping it. It shows you what it's about to save, then saves it. <b>Watch the Job numbers move after you confirm.</b></li>
          </ol>
          <a className="dm-cta" href="/login?signup=1" onClick={() => track(EV.LANDING_CTA, { where: 'demo-side' })}>
            Start your 30-day free trial
          </a>
          <p className="dm-fine">$0 charged today. Then $150/mo, everything included, unlimited crew.</p>
          <p className="dm-fine">
            Rather see a person walk you through it? <a href="/#video">Watch the 2-minute introduction</a>.
          </p>
        </div>
      </div>

      <div className="dm-foot">
        <a href="/">← Back to the home page</a>
      </div>
    </div>
  )
}
