// Pure money math for Run-Site, extracted so it can be unit-tested in
// isolation (the whole app exists to get these numbers right).
//
// The owner dashboard live-computes each job's spend from the source records
// — receipts grouped by category + clocked-out time entries — then:
//   profit = contract price (budget) − materials − labor − other
//   margin = profit ÷ contract price, as a whole-number percent

// Round a money value to whole cents. Totals must be summed from these rounded
// values (not from raw floats) so a report's TOTALS row equals the sum of its
// printed rows — no off-by-a-cent on a tax document.
export const roundCents = (x) => Math.round(((x || 0) + Number.EPSILON) * 100) / 100

export const computeProfit = (budget, spend = {}) =>
  (budget || 0) - (spend.materials || 0) - (spend.labor || 0) - (spend.other || 0)

// Projected profit forecasts the FINISHED job, not just cash out the door so far.
// The bug this fixes: computeProfit(contract, spend) on a brand-new job (spend ≈ 0)
// returns the ENTIRE contract as "profit" at 100% margin — nonsense to a contractor.
// Forecast instead: assume each cost bucket will hit at least its budget; if actual
// spend has already passed budget, use the higher actual. "Other" costs (no budget
// bucket) always count at actual. A COMPLETED job uses pure actuals, so a job that
// came in under budget shows its real (higher) final profit.
export const computeProjectedProfit = (contractPrice, budgets = {}, spend = {}, isComplete = false) => {
  if (isComplete) return computeProfit(contractPrice, spend)
  const materials = Math.max(budgets.materials || 0, spend.materials || 0)
  const labor = Math.max(budgets.labor || 0, spend.labor || 0)
  const other = spend.other || 0
  return (contractPrice || 0) - materials - labor - other
}

export const computeMargin = (profit, budget) =>
  budget > 0 ? Math.round((profit / budget) * 100) : 0

// Contract price = what the owner charges the client = the three budget
// buckets added together (materials + labor + desired profit). Tolerates
// empty-string / undefined form inputs.
export const computeContractPrice = (materials, labor, profitTarget) =>
  (parseFloat(materials) || 0) + (parseFloat(labor) || 0) + (parseFloat(profitTarget) || 0)
