#!/usr/bin/env node
/**
 * Generates the /compare/<competitor>/ static pages in public/.
 *
 * These pages exist for GEO (AI answer-engine visibility), not just SEO.
 * When someone asks ChatGPT/Claude/Perplexity "best job tracking app for small
 * contractors", the model answers from third-party listicles that name
 * ClockShark, Workyard, Connecteam, OnTheClock and Buildertrend. We only had
 * pages for Jobber / Housecall Pro / QuickBooks, so we weren't in that
 * conversation at all.
 *
 * Rules for the copy in here (see the camera-safe truth list):
 *   - GPS is a stamp at clock-in/out. We do NOT do geofencing, continuous
 *     tracking or breadcrumb trails. Say so plainly — several of these
 *     competitors genuinely beat us on that.
 *   - No e-signature.
 *   - Trial is 30 days WITH a card on file, $0 charged.
 *   - Never claim to be the cheapest. On a small crew several of these ARE
 *     cheaper. The honest claim is flat price + job costing in the base.
 *
 * Competitor pricing was verified 2026-08-02 from public sources. Every page
 * tells the reader to re-verify, and carries the check date.
 */

const fs = require('fs');
const path = require('path');

const VERIFIED = 'August 2026';
const OUT_ROOT = path.join(__dirname, '..', 'public', 'compare');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Table cells are written as prose with bare "&" in them. Escape those without
// mangling entities that are already correct.
const amp = (s) => s.replace(/&(?!(?:[a-zA-Z][a-zA-Z0-9]*|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;');

const COMPETITORS = [
  {
    slug: 'clockshark',
    name: 'ClockShark',
    site: 'clockshark.com',
    tagline: 'a GPS time clock and scheduler for trades crews',
    metaDesc:
      'JobTally vs ClockShark for small contractors: ClockShark is a per-user GPS time clock with scheduling; JobTally is flat-priced job costing with live per-job profit. Honest side-by-side with the crew size where the price flips.',
    ogDesc: 'A per-user GPS time clock vs a flat-priced per-job profit tool. Honest side-by-side.',
    theirPricing: 'Standard $40/mo + $8/user; Pro $60/mo + $10/user',
    crossover:
      'ClockShark Standard costs less than JobTally until roughly a 14-person crew; ClockShark Pro until roughly a 9-person crew. Below that, ClockShark is the cheaper line item — the question is whether a time clock alone answers what you actually want to know.',
    verdict:
      '<strong>ClockShark</strong> is a well-built GPS time clock and scheduler for trades, priced per user. <strong>JobTally</strong> is a job-costing tool: it takes those hours, adds scanned receipts, and shows the live profit on each job — flat $150/month, unlimited crew. If you need geofencing and heavy scheduling, ClockShark is stronger. If the question keeping you up is "did that job actually make money?", that is what JobTally is built to answer.',
    theyWin: [
      'Geofencing and continuous GPS location on the crew — JobTally only stamps the location at clock-in and clock-out, not throughout the day.',
      'Deeper drag-and-drop scheduling and shift management.',
      'A longer list of payroll and accounting integrations.',
      'On a small crew it is simply cheaper — a 4-person crew on Standard is well under JobTally.',
    ],
    weWin: [
      'Live per-job profit is the base product, not a report you assemble later.',
      'Receipt scanning books materials straight to the job, so cost is labor <em>and</em> materials — not hours only.',
      'Flat $150/month with unlimited crew. Adding a guy in July does not change the bill.',
      'Estimates and invoices are included, so the budget you quoted is the budget you are tracking against.',
    ],
    rows: [
      ['Built for', 'yes', 'Small contractors who want per-job profit', 'Trades crews that need a GPS time clock'],
      ['Pricing model', 'yes', 'Flat $150/mo, unlimited crew', 'Per user, plus a monthly base fee'],
      ['Live per-job profit', 'yes', 'Included in the base price', 'Job costing reporting; profit not the core view'],
      ['Receipt scanning to job cost', 'yes', 'Yes — auto-reads store and total', 'Verify current capability'],
      ['GPS on clock-in', 'both', 'Location stamped at clock-in/out', 'Yes'],
      ['Geofencing / continuous tracking', 'them', 'No — clock-in/out stamp only', 'Yes'],
      ['Scheduling', 'them', 'Crew schedule & time off', 'Full scheduling & shift management'],
      ['Estimates & invoices', 'yes', 'Included', 'Varies — verify current features'],
    ],
    faqs: [
      {
        q: "What's the difference between JobTally and ClockShark?",
        a: 'ClockShark is a GPS time clock and scheduling app for trades businesses, priced per user on top of a monthly base fee. JobTally is a job-costing app: it uses crew hours and scanned receipts to show the live profit on each job, at a flat $150/month with unlimited crew. ClockShark is stronger on geofencing and scheduling; JobTally is built around per-job profit and includes estimates and invoices in the base price.',
      },
      {
        q: 'Is JobTally cheaper than ClockShark?',
        a: 'Not on a small crew. ClockShark Standard is about $40/month plus $8 per user, so it stays cheaper than JobTally until roughly a 14-person crew, and ClockShark Pro until roughly a 9-person crew. JobTally is a flat $150/month with unlimited crew, so it wins on price as the crew grows and wins on scope at any size because job costing, estimates and invoices are all in the base price. Verify current ClockShark pricing on clockshark.com.',
      },
      {
        q: 'Does JobTally have geofencing like ClockShark?',
        a: 'No. JobTally stamps the GPS location when a worker clocks in and clocks out, but it does not geofence a jobsite or track location continuously through the day. If geofencing is a requirement for you, ClockShark is the better fit.',
      },
    ],
    pickThem: [
      'You need geofencing or continuous location on the crew.',
      'Scheduling and shift management are the daily job, not job costing.',
      'You have a small crew and the lowest monthly line item is the priority.',
    ],
  },

  {
    slug: 'workyard',
    name: 'Workyard',
    site: 'workyard.com',
    tagline: 'GPS-first time tracking with job costing built in',
    metaDesc:
      'JobTally vs Workyard for small contractors: Workyard is per-user GPS time tracking with job costing add-ons; JobTally is flat $150/mo with per-job profit, receipts and invoices included. Side-by-side, including where the price flips.',
    ogDesc: 'Per-user GPS job costing vs a flat-priced per-job profit tool. Honest side-by-side.',
    theirPricing: 'Time Tracking $50/mo + $8/user; Workforce Management $50/mo + $16/user',
    crossover:
      "Workyard's Time Tracking plan stays cheaper than JobTally until roughly a 12-person crew. But the Workforce Management plan — the one that adds scheduling and job management — passes JobTally at about a 7-person crew, and keeps climbing with every hire.",
    verdict:
      '<strong>Workyard</strong> is the strongest GPS-accuracy product in this group and has real job costing, priced per user. <strong>JobTally</strong> covers the same core question — what did this job make — at a flat $150/month with unlimited crew, and folds in receipt scanning, estimates and invoices. Workyard is the pick if precise field location data is the point. JobTally is the pick if you want profit-per-job without the bill moving every time you hire.',
    theyWin: [
      'Best-in-class GPS accuracy and continuous location tracking on the crew.',
      'Geofencing around jobsites.',
      'A more mature scheduling and workforce-management layer on the higher plan.',
    ],
    weWin: [
      'Flat $150/month, unlimited crew — no per-seat math and nothing gated behind a higher tier.',
      'Receipt scanning that books materials to the job automatically.',
      'Estimates and invoices in the base product, so quoted budget and actual cost live in one place.',
      'Cheaper than Workyard Workforce Management from about a 7-person crew up.',
    ],
    rows: [
      ['Built for', 'yes', 'Small contractors who want per-job profit', 'Field crews needing precise GPS + job costing'],
      ['Pricing model', 'yes', 'Flat $150/mo, unlimited crew', 'Base fee plus per user, by plan'],
      ['Live per-job profit', 'yes', 'Included in the base price', 'Job costing included; verify plan'],
      ['Receipt scanning to job cost', 'yes', 'Yes — auto-reads store and total', 'Verify current capability'],
      ['GPS on clock-in', 'both', 'Location stamped at clock-in/out', 'Yes'],
      ['Geofencing / continuous tracking', 'them', 'No — clock-in/out stamp only', 'Yes, high accuracy'],
      ['Scheduling', 'them', 'Crew schedule & time off', 'Fuller scheduling on the higher plan'],
      ['Estimates & invoices', 'yes', 'Included', 'Not the focus — verify'],
    ],
    faqs: [
      {
        q: "What's the difference between JobTally and Workyard?",
        a: 'Workyard is a GPS-first time tracking and job costing platform for field crews, priced with a monthly base fee plus a per-user charge. JobTally is a job-costing app for small contractors at a flat $150/month with unlimited crew, which adds receipt scanning, estimates and invoices to the labor side so per-job profit updates live. Workyard has stronger location tracking and geofencing; JobTally has flat pricing and a wider base feature set.',
      },
      {
        q: 'Is JobTally cheaper than Workyard?',
        a: "It depends on crew size and plan. Workyard's Time Tracking plan is about $50/month plus $8 per user, which stays under JobTally's flat $150/month until roughly a 12-person crew. Workyard's Workforce Management plan is about $50/month plus $16 per user, which passes JobTally at about a 7-person crew. JobTally does not change price as you add crew. Verify current Workyard pricing on workyard.com.",
      },
      {
        q: 'Does JobTally track GPS as accurately as Workyard?',
        a: 'No. Workyard is built around high-accuracy, continuous GPS and geofencing. JobTally records a GPS stamp at clock-in and clock-out only. If proving exactly where a crew was all day is the requirement, Workyard is the better tool.',
      },
    ],
    pickThem: [
      'You need high-accuracy, all-day GPS or geofencing to settle hour disputes.',
      'Location proof matters more to you than seeing profit per job.',
      'You have a small crew on the entry plan and want the lowest monthly cost.',
    ],
  },

  {
    slug: 'connecteam',
    name: 'Connecteam',
    site: 'connecteam.com',
    tagline: 'an all-in-one team app with a genuinely free tier',
    metaDesc:
      'JobTally vs Connecteam for small contractors: Connecteam is free for up to 10 users and great for team ops; JobTally is a $150/mo job-costing tool that shows live per-job profit. An honest comparison — including when Connecteam is the right call.',
    ogDesc: 'A free team-ops app vs a paid per-job profit tool. Honest comparison, including when to pick them.',
    theirPricing: 'Free plan for up to 10 users; paid tiers above that',
    crossover:
      "There is no crossover to argue here: on a crew of 10 or fewer, Connecteam's free plan costs nothing and JobTally costs $150/month. If your only requirement is a time clock, Connecteam wins on price outright. The comparison is only worth making if you want to know your profit per job, which is a different product.",
    verdict:
      '<strong>Connecteam</strong> is genuinely free for up to 10 users and covers time clock, scheduling, geofencing and crew communication. If a free time clock is what you need, take it — we will not pretend otherwise. <strong>JobTally</strong> is not a time clock with extras; it is a job-costing tool that happens to include one. It costs $150/month and it answers a question Connecteam does not: what is the live profit on this job, after labor and materials.',
    theyWin: [
      'Free for up to 10 users. That is a real, hard-to-beat number.',
      'Geofencing and continuous GPS, which JobTally does not do.',
      'Crew chat, checklists, forms and training modules — a broad team-operations toolkit.',
      'Much wider than construction: it fits any hourly workforce.',
    ],
    weWin: [
      'Live per-job profit — labor plus scanned material receipts against the budget you quoted.',
      'Estimates and invoices in the same app, so the quote and the actual cost never drift apart.',
      'Purpose-built for contractor job costing rather than general workforce management.',
      'Flat price with unlimited crew, so it does not re-tier as you pass 10 people.',
    ],
    rows: [
      ['Built for', 'yes', 'Small contractors who want per-job profit', 'Any hourly workforce — broad team ops'],
      ['Pricing model', 'them', 'Flat $150/mo, unlimited crew', 'Free up to 10 users, then tiered'],
      ['Live per-job profit', 'yes', 'Included in the base price', 'Not a job-costing product'],
      ['Receipt scanning to job cost', 'yes', 'Yes — auto-reads store and total', 'No'],
      ['GPS on clock-in', 'both', 'Location stamped at clock-in/out', 'Yes'],
      ['Geofencing / continuous tracking', 'them', 'No — clock-in/out stamp only', 'Yes'],
      ['Estimates & invoices', 'yes', 'Included', 'No'],
      ['Crew chat / forms / training', 'them', 'No', 'Yes'],
    ],
    faqs: [
      {
        q: 'Is Connecteam cheaper than JobTally?',
        a: 'Yes, and by a lot on a small crew — Connecteam has a free plan for up to 10 users that includes a time clock, scheduling, GPS and geofencing. JobTally is $150/month. If you only need a time clock, Connecteam is the cheaper answer and we would say so. JobTally is worth paying for only if you want live per-job profit, receipt-to-job cost capture, and estimates and invoices in the same place.',
      },
      {
        q: 'Can Connecteam do job costing?',
        a: 'Connecteam is a workforce-management and team-operations app rather than a job-costing product. It tracks hours very well, but it is not built to combine labor hours and material receipts against a job budget and show live profit per job. That is the specific gap JobTally fills.',
      },
      {
        q: 'Should a small contractor use Connecteam or JobTally?',
        a: 'If your problem is "I need my guys to clock in and I do not want to pay for it", use Connecteam. If your problem is "I finish jobs and I still do not know which ones made money", that is JobTally. Some contractors run a free time clock for a while and move to JobTally when the profit question starts costing them real money.',
      },
    ],
    pickThem: [
      'You want a free time clock for a crew of 10 or fewer.',
      'You need geofencing, crew chat, forms or training modules.',
      'Job-by-job profit is not the thing you are trying to solve right now.',
    ],
  },

  {
    slug: 'ontheclock',
    name: 'OnTheClock',
    site: 'ontheclock.com',
    tagline: 'a simple, cheap employee time clock',
    metaDesc:
      'JobTally vs OnTheClock for small contractors: OnTheClock is a low-cost per-employee time clock; JobTally is a $150/mo job-costing app showing live per-job profit. Honest side-by-side on price and what each actually answers.',
    ogDesc: 'A low-cost time clock vs a per-job profit tool. Honest side-by-side.',
    theirPricing: 'About $5/mo base + $4 per employee; free under 3 employees',
    crossover:
      'OnTheClock is dramatically cheaper as a time clock — roughly $5/month plus $4 per employee means a 5-person crew lands near $25/month against JobTally\'s $150. It would take something like a 36-person crew for the prices to meet. If hours are all you need tracked, OnTheClock is the better buy.',
    verdict:
      '<strong>OnTheClock</strong> is an inexpensive, no-nonsense employee time clock with job codes, and on price it beats JobTally comfortably for any small crew. <strong>JobTally</strong> is a different category: it costs $150/month flat and turns hours plus scanned receipts into live per-job profit, with estimates and invoices included. Buy OnTheClock if you need hours. Buy JobTally if you need to know which jobs make money.',
    theyWin: [
      'Far cheaper for pure time tracking — a small crew runs at a fraction of JobTally.',
      'Free under three employees.',
      'Simple and quick to roll out if hours are the only requirement.',
      'Payroll add-on available.',
    ],
    weWin: [
      'Live per-job profit rather than job codes you reconcile later in a spreadsheet.',
      'Receipt scanning that books materials to the job — hours are only half of a job cost.',
      'Estimates and invoices included, so the quoted budget is what actuals run against.',
      'Flat price with unlimited crew instead of a per-employee charge.',
    ],
    rows: [
      ['Built for', 'yes', 'Small contractors who want per-job profit', 'Any small business needing a time clock'],
      ['Pricing model', 'them', 'Flat $150/mo, unlimited crew', 'Small base fee plus per employee'],
      ['Live per-job profit', 'yes', 'Included in the base price', 'Job codes; profit not calculated for you'],
      ['Material costs / receipts', 'yes', 'Scanned receipts booked to the job', 'No'],
      ['GPS on clock-in', 'both', 'Location stamped at clock-in/out', 'Yes'],
      ['Estimates & invoices', 'yes', 'Included', 'No'],
      ['Payroll', 'them', 'Exports for your payroll provider', 'Payroll add-on available'],
      ['Cost on a 5-person crew', 'them', '$150/mo', 'Roughly $25/mo — verify current pricing'],
    ],
    faqs: [
      {
        q: 'Is JobTally cheaper than OnTheClock?',
        a: 'No. OnTheClock is roughly $5/month plus about $4 per employee, so a five-person crew is around $25/month against JobTally\'s flat $150/month, and it is free under three employees. As a time clock, OnTheClock is the cheaper product and we would not argue otherwise. JobTally costs more because it is doing job costing — combining labor and scanned material receipts against a job budget to show live profit — not just recording hours. Verify current OnTheClock pricing on ontheclock.com.',
      },
      {
        q: 'Does OnTheClock do job costing?',
        a: 'OnTheClock supports job codes so hours can be attributed to a job, which is the labor half of job costing. It does not capture material receipts or show live profit against a job budget, so you would still be assembling the actual number yourself. JobTally does that part automatically.',
      },
      {
        q: 'Which should a small contractor pick?',
        a: 'If you need your crew clocking in and out and nothing more, OnTheClock is cheaper and perfectly good. If you keep finishing jobs without knowing what they made — because materials, hours and the original estimate all live in different places — that is the problem JobTally is built for, and it is why it costs more.',
      },
    ],
    pickThem: [
      'You only need hours tracked and want the cheapest reliable way to do it.',
      'You have fewer than three employees and want a free option.',
      'You already have a system you trust for material costs and profit.',
    ],
  },

  {
    slug: 'buildertrend',
    name: 'Buildertrend',
    site: 'buildertrend.com',
    tagline: 'a full construction-management platform for builders',
    metaDesc:
      'JobTally vs Buildertrend for small contractors: Buildertrend is a full construction-management platform priced in the hundreds per month; JobTally is flat $150/mo job costing with live per-job profit. Where each one fits.',
    ogDesc: 'A full construction-management platform vs a focused per-job profit tool.',
    theirPricing: 'Custom quotes tied to annual construction volume; historically $339–$1,099/mo by tier',
    crossover:
      'There is no crossover here — Buildertrend starts in the hundreds of dollars a month and, as of 2026, is quoted against your annual construction volume rather than published as a list price. JobTally is $150/month flat. The real question is not price, it is whether you need a whole construction-management platform or the profit number.',
    verdict:
      '<strong>Buildertrend</strong> is a complete construction-management platform — client portals, selections, change orders, scheduling, document control, warranty — aimed at custom builders and larger remodelers. <strong>JobTally</strong> is deliberately much smaller: it tells an owner-operator with a 2–10 person crew what each job is really making, for a flat $150/month. If you are running builds with client selections and change-order workflows, Buildertrend. If you are running a crew and want the profit number, JobTally.',
    theyWin: [
      'Client-facing portal, selections and change-order workflows.',
      'Document management, warranty tracking and full project scheduling with dependencies.',
      'Built for custom-home builders and larger remodel operations.',
      'Deep integrations and an established ecosystem.',
    ],
    weWin: [
      'A fraction of the cost — flat $150/month against several hundred, with no volume-based quote.',
      'Set up in about five minutes rather than an onboarding project.',
      'Live per-job profit is the front page, not a module you configure.',
      'Unlimited crew included; no seat or volume tiering.',
    ],
    rows: [
      ['Built for', 'yes', 'Owner-operators with a 2–10 person crew', 'Custom builders & larger remodelers'],
      ['Pricing model', 'yes', 'Flat $150/mo, published, unlimited crew', 'Custom quote by annual construction volume'],
      ['Typical monthly cost', 'yes', '$150', 'Historically several hundred — get a quote'],
      ['Live per-job profit', 'yes', 'The core view', 'Available inside a much larger platform'],
      ['Receipt scanning to job cost', 'yes', 'Yes — auto-reads store and total', 'Verify current capability'],
      ['Client portal & selections', 'them', 'No', 'Yes'],
      ['Change orders & document control', 'them', 'Basic', 'Yes, full workflows'],
      ['Time to get running', 'yes', 'About five minutes', 'Onboarding and setup period'],
    ],
    faqs: [
      {
        q: "What's the difference between JobTally and Buildertrend?",
        a: 'Buildertrend is a full construction-management platform for custom builders and larger remodelers — client portals, selections, change orders, document control, scheduling and warranty. JobTally is a focused job-costing app for an owner-operator with a 2–10 person crew: GPS clock-in, receipt scanning, estimates and invoices, and live per-job profit, at a flat $150/month. Buildertrend does far more; JobTally does one thing at a price a small crew can carry.',
      },
      {
        q: 'Is JobTally cheaper than Buildertrend?',
        a: 'Yes, substantially. JobTally is a published flat $150/month with unlimited crew. As of 2026 Buildertrend no longer publishes list pricing and instead quotes against your annual construction volume; third-party sources have historically put its tiers in the several-hundred-dollars-per-month range. Get a current quote from Buildertrend before comparing.',
      },
      {
        q: 'When is Buildertrend the better choice?',
        a: 'When you are running builds that need a client-facing portal, selections, formal change orders and document control — typically custom-home builders and larger remodeling companies. JobTally does not do those things and is not trying to. If your business needs that workflow, Buildertrend earns its price.',
      },
    ],
    pickThem: [
      'You run custom builds needing client portals, selections and change orders.',
      'You need document control, warranty tracking and dependency-based scheduling.',
      'Your operation is large enough that a several-hundred-dollar platform pays for itself.',
    ],
  },
];

function cellClass(winner, col) {
  // col: 'us' | 'them'
  if (winner === 'yes' && col === 'us') return ' class="yes"';
  if (winner === 'them' && col === 'them') return ' class="yes"';
  return '';
}

function render(c) {
  const faqLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: c.faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };

  const rows = c.rows
    .map(
      ([label, winner, us, them]) =>
        `<tr><td>${amp(label)}</td><td${cellClass(winner, 'us')}>${amp(us)}</td><td${cellClass(winner, 'them')}>${amp(them)}</td></tr>`
    )
    .join('\n');

  const faqHtml = c.faqs
    .map((f) => `<h3>${esc(f.q)}</h3>\n<p>${esc(f.a)}</p>`)
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="theme-color" content="#1C2B3A"/>
<title>JobTally vs ${c.name} — Job Costing for Small Contractors | JobTally</title>
<meta name="description" content="${esc(c.metaDesc)}"/>
<link rel="canonical" href="https://www.getjobtally.com/compare/${c.slug}/"/>
<link rel="stylesheet" href="/m.css"/>
<meta property="og:title" content="JobTally vs ${c.name}"/>
<meta property="og:description" content="${esc(c.ogDesc)}"/>
<meta property="og:image" content="https://www.getjobtally.com/og-card.png"/>
<meta property="og:url" content="https://www.getjobtally.com/compare/${c.slug}/"/>
<meta property="og:type" content="website"/>
<script type="application/ld+json">
${JSON.stringify(faqLd)}
</script>
</head>
<body>
<div class="m-nav"><div class="m-nav-in">
  <a class="m-logo" href="/">JobTally</a>
  <nav><a href="/features/">Features</a><a href="/pricing/">Pricing</a><a href="/best-job-costing-app-for-small-contractors/">Compare</a><a class="m-cta" href="/login?signup=1">Start free</a></nav>
</div></div>

<div class="m-hero">
  <div class="m-eyebrow">Comparison</div>
  <h1>JobTally vs ${c.name}</h1>
  <p class="m-lead">${c.name} is ${amp(c.tagline)}. JobTally is a job-costing tool that shows the live profit on each job. Here's a fair read on where each one wins — including the places ${c.name} beats us.</p>
</div>

<div class="m-verdict">
  <p><strong>Short answer:</strong> ${c.verdict}</p>
</div>

<section><div class="m-wrap">
<h2>Side by side</h2>
<div class="m-table-wrap">
<table>
<thead><tr><th></th><th>JobTally</th><th>${c.name}</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</div>
<p class="m-updated">${c.name} pricing checked ${VERIFIED}: ${esc(c.theirPricing)}. Plans change often — confirm on ${c.site} before you decide.</p>
</div></section>

<section><div class="m-wrap">
<h2>What the price actually works out to</h2>
<p>${esc(c.crossover)}</p>
<p>JobTally is a flat <strong>$150/month</strong> (or $1,200/year) with unlimited crew and every feature in the base price — job costing is not on a higher tier, and adding a worker never changes the bill.</p>
</div></section>

<section><div class="m-wrap">
<h2>Where ${c.name} is genuinely better</h2>
<ul>
${c.theyWin.map((x) => `  <li>${x}</li>`).join('\n')}
</ul>
<h2>Where JobTally is better</h2>
<ul>
${c.weWin.map((x) => `  <li>${x}</li>`).join('\n')}
</ul>
</div></section>

<section><div class="m-wrap">
<h2>Pick ${c.name} if…</h2>
<ul>
${c.pickThem.map((x) => `  <li>${x}</li>`).join('\n')}
</ul>
<h2>Pick JobTally if…</h2>
<ul>
  <li>You finish jobs and still can't say which ones made money.</li>
  <li>You want labor <em>and</em> materials landing on the job automatically, not typed in later.</li>
  <li>You want the price to stay the same as the crew grows.</li>
  <li>You want the estimate, the actual cost and the invoice in one place.</li>
</ul>
</div></section>

<div class="m-final">
  <h2>Want the focused profit tool? Try JobTally free.</h2>
  <p>30 days free — $0 charged today. See per-job profit on your first job today.</p>
  <p><a class="m-cta-lg" href="/login?signup=1">Start your 30-day free trial</a></p>
  <p class="m-cta-note">Card required at signup, $0 charged for 30 days. Then $150/mo or $1,200/yr. Unlimited crew, everything included.</p>
</div>

<section class="m-faq"><div class="m-wrap">
<h2>JobTally vs ${c.name} — FAQ</h2>
${faqHtml}
</div></section>

<div class="m-footer"><div class="m-footer-in">
  <a href="/">Home</a><a href="/features/">Features</a><a href="/pricing/">Pricing</a><a href="/best-job-costing-app-for-small-contractors/">All comparisons</a><a href="/compare/jobber/">vs Jobber</a><a href="/compare/clockshark/">vs ClockShark</a><a href="/compare/workyard/">vs Workyard</a>
  <div class="m-fine">JobTally · getjobtally.com · "${c.name}" is a trademark of its owner; this is an independent comparison for general information, pricing checked ${VERIFIED}. Verify competitor pricing on their own site. <a href="/privacy.html">Privacy</a> · <a href="/terms.html">Terms</a></div>
</div></div>
</body>
</html>
`;
}

let written = 0;
for (const c of COMPETITORS) {
  const dir = path.join(OUT_ROOT, c.slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), render(c), 'utf8');
  console.log(`wrote public/compare/${c.slug}/index.html`);
  written++;
}
console.log(`\n${written} comparison pages generated.`);
