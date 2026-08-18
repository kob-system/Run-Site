import React, { useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { getAttribution } from '../utils/attribution'
import { computeJobProfit, profitVerdict, formatMoney } from '../utils/jobCalc'

// The free Job Profit Calculator, lifted out of Remodelers.js so /remodelers
// and the standalone /calculator page run the SAME arithmetic and the same
// lead capture. Two copies of a money calculator is how the flyer page and the
// SEO page end up quoting a contractor two different profit numbers.
//
// Styling deliberately keeps the rl- class names and lives in Remodelers.css —
// whichever page renders this imports that stylesheet and wraps it in `.rl`.
// Duplicating the CSS under a second prefix would drift the same way the math
// would.
//
// `source` is the lead's origin string written to leads.source and to the alert
// email. /remodelers MUST keep sending 'remodelers-calculator' — changing it
// would silently split the flyer funnel's history in two.
export default function ProfitCalculator({ source = 'remodelers-calculator', heading = 'Free Job Profit Calculator', kicker = 'Grab your last finished job and put the real numbers in. Takes 30 seconds. No signup.' }) {
  const [inputs, setInputs] = useState({ contract: '', hours: '', rate: '', materials: '', overheadPct: '10' })
  const set = (k) => (e) => setInputs((s) => ({ ...s, [k]: e.target.value }))
  const results = useMemo(() => computeJobProfit(inputs), [inputs])
  const verdict = useMemo(() => profitVerdict(results), [results])
  const hasNumbers = results.contract > 0

  // ── Email-me-my-numbers gate (optional — calculator works without it) ──
  const [email, setEmail] = useState('')
  const [gate, setGate] = useState('idle') // idle | sending | done | error
  const [gateErr, setGateErr] = useState('')

  const sendNumbers = async (e) => {
    e.preventDefault()
    setGateErr('')
    const addr = email.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) {
      setGateErr('Enter a real email and we’ll send your numbers there.')
      return
    }
    setGate('sending')
    const attrib = getAttribution() || {}
    const payload = { inputs, results }
    // 1) Store the lead (anon INSERT allowed by RLS; nothing readable back).
    const { error } = await supabase.from('leads').insert({
      email: addr,
      source,
      utm_source: attrib.utm_source || null,
      utm_medium: attrib.utm_medium || null,
      utm_campaign: attrib.utm_campaign || null,
      payload,
    })
    if (error) {
      console.error('Lead save failed:', error)
      setGate('error')
      setGateErr('That didn’t go through. Give it another try in a second.')
      return
    }
    // 2) Email them their numbers — best-effort. The lead is already saved,
    //    so a mail hiccup never turns into a user-facing failure.
    fetch('/api/send-lead-numbers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      //    Attribution rides along so the owner alert says where the lead came
      //    from (which flyer, which QR) without a second round-trip to `leads`.
      body: JSON.stringify({
        email: addr,
        results,
        source,
        // `ref` is the referrer code off the flyer QR (?ref=josh). It isn't part
        // of getAttribution(), and it's the single most useful thing on the
        // alert — it says WHICH piece of paper produced this lead.
        attrib: { ...attrib, ref: (typeof localStorage !== 'undefined' && localStorage.getItem('jobtally_ref')) || null },
      }),
    }).catch(() => {})
    setGate('done')
  }

  return (
    <section className="rl-calc" id="calculator">
      <div className="rl-inner">
        <h2>{heading}</h2>
        <p className="rl-kicker">{kicker}</p>
        <div className="rl-calc-box">
          <div className="rl-calc-inputs">
            <label htmlFor="rl-contract">Contract price ($)</label>
            <input id="rl-contract" type="number" inputMode="decimal" min="0" placeholder="24000"
              value={inputs.contract} onChange={set('contract')} />
            <div className="rl-two">
              <div>
                <label htmlFor="rl-hours">Total labor hours</label>
                <input id="rl-hours" type="number" inputMode="decimal" min="0" placeholder="120"
                  value={inputs.hours} onChange={set('hours')} />
              </div>
              <div>
                <label htmlFor="rl-rate">Avg hourly rate ($)</label>
                <input id="rl-rate" type="number" inputMode="decimal" min="0" placeholder="35"
                  value={inputs.rate} onChange={set('rate')} />
              </div>
            </div>
            <label htmlFor="rl-materials">Materials + receipts ($)</label>
            <input id="rl-materials" type="number" inputMode="decimal" min="0" placeholder="9000"
              value={inputs.materials} onChange={set('materials')} />
            <label htmlFor="rl-overhead">Overhead (% of contract — truck, insurance, fuel, phone)</label>
            <input id="rl-overhead" type="number" inputMode="decimal" min="0" max="100" placeholder="10"
              value={inputs.overheadPct} onChange={set('overheadPct')} />
          </div>

          <div className="rl-calc-results" aria-live="polite">
            <div className="rl-line"><span>Labor</span><span>{formatMoney(results.labor)}</span></div>
            <div className="rl-line"><span>Materials</span><span>{formatMoney(results.materials)}</span></div>
            <div className="rl-line"><span>Overhead</span><span>{formatMoney(results.overhead)}</span></div>
            <div className="rl-line"><span>Total cost</span><span>{formatMoney(results.cost)}</span></div>
            <div className="rl-profit">
              <div className={'rl-profit-num ' + (results.profit >= 0 ? 'good' : 'bad')}>
                {formatMoney(results.profit)}
              </div>
              <div className="rl-profit-label">
                true profit{hasNumbers ? ` · ${results.margin}% margin` : ''}
              </div>
            </div>
            <div className="rl-verdict">{verdict}</div>

            <div className="rl-email-gate">
              {gate === 'done' ? (
                <div className="rl-email-ok">
                  Got it — your numbers are on the way to {email.trim()}. Check spam if it hides.
                </div>
              ) : (
                <>
                  <p>Want these numbers in your inbox to chew on later?</p>
                  <form className="rl-email-row" onSubmit={sendNumbers}>
                    <input
                      type="email" inputMode="email" autoComplete="email" placeholder="you@email.com"
                      aria-label="Your email" value={email} onChange={(e) => setEmail(e.target.value)}
                    />
                    <button type="submit" disabled={gate === 'sending'}>
                      {gate === 'sending' ? 'Sending…' : 'Email me my numbers'}
                    </button>
                  </form>
                  {gateErr && <div className="rl-email-err">{gateErr}</div>}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
