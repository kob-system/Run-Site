// Pure math for the free Job Profit Calculator on /remodelers. Kept out of
// the page component so it's unit-testable, same pattern as money.js (the
// whole pitch is "know your real number," so the number must be right).
import { roundCents } from './money'

const num = (v) => {
  const n = parseFloat(v)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

// Inputs are raw form strings; tolerate '', undefined, junk.
//   contract    — what the customer is paying for the job
//   hours       — total labor hours (all crew)
//   rate        — average loaded hourly rate
//   materials   — materials + receipts total
//   overheadPct — % of the contract that goes to overhead (truck, insurance,
//                 fuel, phone…). Applied to the contract price because that's
//                 how most small GCs think about it ("10% of every job").
export function computeJobProfit({ contract, hours, rate, materials, overheadPct }) {
  const c = num(contract)
  const labor = roundCents(num(hours) * num(rate))
  const mats = roundCents(num(materials))
  const overhead = roundCents(c * (num(overheadPct) / 100))
  const cost = roundCents(labor + mats + overhead)
  const profit = roundCents(c - cost)
  const margin = c > 0 ? Math.round((profit / c) * 100) : 0
  return { contract: c, labor, materials: mats, overhead, cost, profit, margin }
}

// One blunt line a foreman would actually say about the result.
export function profitVerdict({ contract, profit, margin }) {
  if (contract <= 0) return 'Put your numbers in and see where the job really lands.'
  if (profit < 0) return `You'd be PAYING to do this job. That's ${formatMoney(-profit)} out of your own pocket.`
  if (margin < 10) return `Under 10% margin. One surprise — a busted water heater, a re-do — and this job goes red.`
  if (margin < 20) return `Livable, but thin. Most healthy remodelers hold 20%+ after overhead.`
  if (margin < 35) return `Solid job. This is the margin range that keeps the lights on and the truck paid.`
  return `Strong margin. Price with confidence — and make sure the invoice actually goes out.`
}

export function formatMoney(n) {
  const v = roundCents(n)
  return v.toLocaleString('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0,
  })
}
