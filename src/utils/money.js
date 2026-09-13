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

// What the job's profit card shows. Contract minus spend is the right number
// once a job is FINISHED, and the wrong one while it is running: on a new
// $13,500 job with nothing spent it read "$13,500 profit, 100% margin", i.e.
// the whole contract as profit. Budget not yet spent is not profit, it is
// money still to be spent.
//
//   'noTarget' no split set (all three buckets blank): there is no plan to
//              measure against, so no profit number at all.
//   'target'   nothing spent yet: the owner's own profit target.
//   'onTrack'  costs logged on an open job: the contract minus each budget
//              bucket or what it has actually cost, whichever is bigger, minus
//              costs that have no bucket. So it starts at the target, drops
//              dollar for dollar as a bucket goes over, and approved extras
//              (in the contract) raise it.
//   'final'    job finished and costs logged: contract minus everything spent.
//
// `amount` is the number to print; `target` and `spent` are for the line
// under it.
export const profitPicture = ({ contract, materialsBudget, laborBudget, profitTarget, spend = {}, finished = false } = {}) => {
  const materials = spend.materials || 0
  const labor = spend.labor || 0
  const other = spend.other || 0
  const spent = materials + labor + other
  const target = profitTarget || 0
  const hasPlan = (materialsBudget || 0) > 0 || (laborBudget || 0) > 0 || target > 0
  if (!hasPlan) return { mode: 'noTarget', amount: null, target: 0, spent }
  if (spent <= 0) return { mode: 'target', amount: target, target, spent: 0 }
  if (finished) return { mode: 'final', amount: computeProfit(contract, spend), target, spent }
  const amount = (contract || 0)
    - Math.max(materials, materialsBudget || 0)
    - Math.max(labor, laborBudget || 0)
    - other
  return { mode: 'onTrack', amount, target, spent }
}

export const computeMargin = (profit, budget) =>
  budget > 0 ? Math.round((profit / budget) * 100) : 0

// Contract price = what the owner charges the client = the three budget
// buckets added together (materials + labor + desired profit). Tolerates
// empty-string / undefined form inputs.
export const computeContractPrice = (materials, labor, profitTarget) =>
  (parseFloat(materials) || 0) + (parseFloat(labor) || 0) + (parseFloat(profitTarget) || 0)
