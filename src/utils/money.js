// Pure money math for Run-Site, extracted so it can be unit-tested in
// isolation (the whole app exists to get these numbers right).
//
// The owner dashboard live-computes each job's spend from the source records
// — receipts grouped by category + clocked-out time entries — then:
//   profit = contract price (budget) − materials − labor − other
//   margin = profit ÷ contract price, as a whole-number percent

export const computeProfit = (budget, spend = {}) =>
  (budget || 0) - (spend.materials || 0) - (spend.labor || 0) - (spend.other || 0)

export const computeMargin = (profit, budget) =>
  budget > 0 ? Math.round((profit / budget) * 100) : 0

// Contract price = what the owner charges the client = the three budget
// buckets added together (materials + labor + desired profit). Tolerates
// empty-string / undefined form inputs.
export const computeContractPrice = (materials, labor, profitTarget) =>
  (parseFloat(materials) || 0) + (parseFloat(labor) || 0) + (parseFloat(profitTarget) || 0)
