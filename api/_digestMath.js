// Pure math for the weekly digest email. No I/O, no Supabase, no Resend —
// everything here is a function of rows in and an object out, so it can be
// unit-tested. Tests live in src/utils/weeklyDigest.test.js (that's where jest
// looks); the module lives in api/ because that's where it runs.
//
// WHY THIS IS SPLIT OUT AT ALL: this email states dollar figures to a paying
// customer once a week, unprompted. A wrong number here is worse than no email
// — it's the exact thing the product claims to fix, getting it wrong, in
// writing, in their inbox. So the arithmetic is isolated and pinned by tests.
//
// ⚠️ MUST STAY IN LOCKSTEP WITH src/utils/money.js AND the live aggregation in
// OwnerDashboard.js (~line 644). A Vercel function can't import out of the
// React bundle, so these three tiny functions are a deliberate port, matching
// the precedent set by api/_receiptParse.js. If the dashboard's definition of
// profit changes, change it here in the same commit or the email will
// contradict the screen.

// Round to whole cents. Totals are summed from rounded values, never from raw
// floats, so the printed rows add up to the printed total.
export const roundCents = (x) => Math.round(((x || 0) + Number.EPSILON) * 100) / 100

export const computeProfit = (contract, spend = {}) =>
  (contract || 0) - (spend.materials || 0) - (spend.labor || 0) - (spend.other || 0)

export const computeMargin = (profit, contract) =>
  contract > 0 ? Math.round((profit / contract) * 100) : 0

// A job is "in trouble" below this. 10% is where JobTally's own ROI calculator
// (src/utils/jobCalc.js profitVerdict) says one surprise turns the job red, so
// the email and the calculator agree on what "thin" means.
export const THIN_MARGIN = 10

const inWeek = (dateLike, startISO, endISO) => {
  if (!dateLike) return false
  const t = new Date(dateLike).getTime()
  if (Number.isNaN(t)) return false
  return t >= new Date(startISO).getTime() && t < new Date(endISO).getTime()
}

/**
 * Build one owner's weekly digest.
 *
 * @param {object[]} projects      { id, name, budget, stage, is_sample }
 * @param {object[]} receipts      { project_id, amount, tax_amount, category, purchase_date, created_at }
 * @param {object[]} timeEntries   { project_id, labor_cost, total_minutes, clocked_out_at }
 * @param {object[]} changeOrders  { project_id, amount, status }
 * @param {object[]} invoices      { project_id, amount, status }
 * @param {string}   weekStartISO  inclusive
 * @param {string}   weekEndISO    exclusive
 */
export function buildDigest({
  projects = [], receipts = [], timeEntries = [], changeOrders = [], invoices = [],
  weekStartISO, weekEndISO,
}) {
  // The seeded demo job is a tutorial, not their money. Excluded from every
  // number here exactly as the dashboard excludes it.
  const real = projects.filter((p) => p && !p.is_sample)
  const active = real.filter((p) => (p.stage || 'start') !== 'end')

  // Approved change orders only — pending ones don't change what the client owes.
  const coByProject = {}
  changeOrders.forEach((c) => {
    if (!c || c.status !== 'approved') return
    coByProject[c.project_id] = roundCents((coByProject[c.project_id] || 0) + (c.amount || 0))
  })

  // Lifetime spend per job (what the job screen shows), and separately what
  // moved THIS WEEK (what the email is reporting on).
  const spend = {}
  const weekSpend = { materials: 0, labor: 0, other: 0 }
  let weekHours = 0
  active.forEach((p) => { spend[p.id] = { materials: 0, labor: 0, other: 0 } })

  receipts.forEach((r) => {
    if (!r || !spend[r.project_id]) return
    // tax_amount is part of what the receipt actually cost the owner.
    const cost = roundCents((r.amount || 0) + (r.tax_amount || 0))
    const bucket = r.category === 'materials' ? 'materials' : 'other'
    spend[r.project_id][bucket] = roundCents(spend[r.project_id][bucket] + cost)
    // purchase_date is the real date on the paper; created_at is when it was
    // typed in. The week follows the paper, falling back to entry time for
    // older rows written before the purchase_date column (FIX-DATABASE-25).
    if (inWeek(r.purchase_date || r.created_at, weekStartISO, weekEndISO)) {
      weekSpend[bucket] = roundCents(weekSpend[bucket] + cost)
    }
  })

  timeEntries.forEach((t) => {
    // Only clocked-OUT shifts have a final cost. An open shift has no
    // labor_cost yet and must never be counted as spend.
    if (!t || !t.clocked_out_at || !spend[t.project_id]) return
    const cost = roundCents(t.labor_cost || 0)
    spend[t.project_id].labor = roundCents(spend[t.project_id].labor + cost)
    if (inWeek(t.clocked_out_at, weekStartISO, weekEndISO)) {
      weekSpend.labor = roundCents(weekSpend.labor + cost)
      weekHours += (t.total_minutes || 0) / 60
    }
  })

  const jobs = active.map((p) => {
    const contract = roundCents((p.budget || 0) + (coByProject[p.id] || 0))
    const s = spend[p.id]
    const profit = roundCents(computeProfit(contract, s))
    return {
      id: p.id,
      name: p.name || 'Untitled job',
      contract,
      materials: s.materials,
      labor: s.labor,
      other: s.other,
      spent: roundCents(s.materials + s.labor + s.other),
      profit,
      margin: computeMargin(profit, contract),
    }
  }).sort((a, b) => a.margin - b.margin) // worst first — that's the one to act on

  // Unpaid = invoiced and not marked paid, across ALL real jobs (money owed on
  // a finished job is still owed).
  const owed = roundCents(
    invoices
      .filter((i) => i && i.status !== 'paid' && real.some((p) => p.id === i.project_id))
      .reduce((sum, i) => roundCents(sum + (i.amount || 0)), 0)
  )

  const attention = jobs
    .filter((j) => j.contract > 0 && j.margin < THIN_MARGIN)
    .map((j) => ({
      name: j.name,
      margin: j.margin,
      reason: j.profit < 0
        ? `is losing money — ${fmtMoney(Math.abs(j.profit))} under`
        : `is down to ${j.margin}% margin`,
    }))

  const weekTotal = roundCents(weekSpend.materials + weekSpend.labor + weekSpend.other)

  return {
    weekStartISO,
    weekEndISO,
    week: {
      materials: weekSpend.materials,
      labor: weekSpend.labor,
      other: weekSpend.other,
      total: weekTotal,
      hours: Math.round(weekHours * 10) / 10,
    },
    jobs,
    totalProfit: roundCents(jobs.reduce((s, j) => roundCents(s + j.profit), 0)),
    owed,
    attention,
    // Nothing happened this week and nothing is outstanding. The caller SKIPS
    // the send — a weekly email that says "you did nothing" every week for a
    // month is how a digest gets filtered to spam, and it can never be unread.
    hasSomethingToSay: weekTotal > 0 || weekHours > 0 || owed > 0 || attention.length > 0,
  }
}

export const fmtMoney = (n) =>
  (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US')
