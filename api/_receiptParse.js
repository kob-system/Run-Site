// Turning what a vision model saw on a receipt into the two numbers this app
// actually stores. Pure functions, no network — so they can be unit-tested
// (src/utils/receiptParse.test.js) instead of only being exercised by paying
// Anthropic for a photo of a Home Depot receipt.
//
// THE MONEY CONVENTION, because getting it backwards costs real money:
//   receipts.amount     = the PRE-TAX subtotal
//   receipts.tax_amount = the sales tax
//   what the job cost   = amount + tax_amount   (OwnerDashboard fetchSpend)
//
// So a scanner that returns the receipt's GRAND TOTAL as `amount` while also
// returning the tax makes every scanned receipt cost the job its sales tax
// twice. That is exactly what this app used to do. Everything below exists to
// make sure the pair we hand back always satisfies amount + tax = total.

const round2 = (n) => Math.round(n * 100) / 100

// A positive, finite dollar figure or null. Strings are accepted because a
// model asked for a number will sometimes hand back "1,204.55" anyway.
const money = (v) => {
  if (v === null || v === undefined) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[$,\s]/g, ''))
  if (!Number.isFinite(n) || n <= 0) return null
  return round2(n)
}

// No US sales tax rate is anywhere near this. A "tax" above it is the model
// having grabbed some other line off the receipt — a deposit, a second
// subtotal, the change due. Dropping it loses a little detail; trusting it
// silently inflates what the job cost.
const MAX_PLAUSIBLE_TAX_SHARE = 0.25

/**
 * Reconcile whatever the model read into a consistent {amount, tax, total}.
 * Never returns a set where amount + tax !== total.
 *
 * @param {{subtotal?:*, sales_tax?:*, total?:*}} raw
 * @returns {{amount:number|null, tax:number|null, total:number|null}}
 */
export function reconcileMoney(raw) {
  const r = raw || {}
  let sub = money(r.subtotal)
  let tax = money(r.sales_tax)
  let tot = money(r.total)

  // Nothing usable at all.
  if (sub === null && tot === null) return { amount: null, tax: null, total: null }

  // Fill in whichever of the pair is missing.
  if (tot === null) tot = round2(sub + (tax || 0))
  if (sub === null) sub = tax !== null && tax < tot ? round2(tot - tax) : tot

  // Implausible tax: at or above the total, or a rate no state charges. Treat
  // the receipt as tax-unknown and book the whole total as the cost. The owner
  // still sees the number and can type the tax in by hand.
  if (tax !== null && (tax >= tot || tax / tot > MAX_PLAUSIBLE_TAX_SHARE)) {
    return { amount: tot, tax: null, total: tot }
  }

  // The three numbers disagree (misread digit, or a subtotal that was really a
  // pre-discount figure). The grand total is the number the card was charged,
  // so it wins; derive the subtotal from it.
  if (tax !== null && Math.abs(round2(sub + tax) - tot) > 0.02) {
    sub = round2(tot - tax)
  }

  // A subtotal with no tax line is just the total.
  if (tax === null) sub = tot

  return { amount: sub, tax, total: tot }
}

const pad = (n) => String(n).padStart(2, '0')
const isRealDate = (y, m, d) => {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

/**
 * Normalize a printed receipt date to YYYY-MM-DD, or null.
 *
 * The model is asked for YYYY-MM-DD, but receipts print 03/14/25, 3-14-2025,
 * and everything in between, and a model reading one of those sometimes just
 * echoes it. US order (month first) is assumed — this is a US contractor app.
 *
 * @param {*} raw
 * @param {string} [todayKey] today's YYYY-MM-DD, for the future-date guard
 */
export function normalizeDate(raw, todayKey) {
  if (!raw) return null
  const s = String(raw).trim()
  if (/^none$/i.test(s)) return null

  let y, m, d
  let mt = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (mt) {
    y = +mt[1]; m = +mt[2]; d = +mt[3]
  } else {
    mt = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/)
    if (!mt) return null
    m = +mt[1]; d = +mt[2]; y = +mt[3]
    // Two-digit years on a receipt are this century. 25 -> 2025.
    if (y < 100) y += 2000
  }

  if (!isRealDate(y, m, d)) return null
  const key = `${y}-${pad(m)}-${pad(d)}`

  // A receipt from 1998 or from next year is a misread, and a wrong year files
  // the expense in the wrong tax year. Reject rather than guess.
  if (y < 2015) return null
  if (todayKey && /^\d{4}-\d{2}-\d{2}$/.test(todayKey)) {
    const tomorrow = new Date(Date.UTC(+todayKey.slice(0, 4), +todayKey.slice(5, 7) - 1, +todayKey.slice(8, 10) + 1))
    const tomorrowKey = `${tomorrow.getUTCFullYear()}-${pad(tomorrow.getUTCMonth() + 1)}-${pad(tomorrow.getUTCDate())}`
    if (key > tomorrowKey) return null
  }
  return key
}

/**
 * The full response body the scan endpoint hands its callers.
 * Money comes back as fixed-2 STRINGS (or '' / null) because both callers drop
 * these straight into controlled text inputs.
 */
export function buildScanResponse(extracted, todayKey) {
  const e = extracted || {}
  const { amount, tax, total } = reconcileMoney(e)
  const store = typeof e.store === 'string' ? e.store.replace(/\s+/g, ' ').trim().slice(0, 80) : ''
  return {
    store: /^none$/i.test(store) ? '' : store,
    // Pre-tax subtotal — see the money convention at the top of this file.
    amount: amount === null ? '' : amount.toFixed(2),
    tax: tax === null ? null : tax.toFixed(2),
    // The grand total, for display only. Nothing saves this; it exists so the
    // owner can check the scan against the piece of paper in their hand.
    total: total === null ? null : total.toFixed(2),
    date: normalizeDate(e.purchase_date, todayKey),
  }
}
