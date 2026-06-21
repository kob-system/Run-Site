import { computeProfit, computeProjectedProfit, computeMargin, computeContractPrice, roundCents } from './money'

describe('roundCents (tax-report footing)', () => {
  test('rounds to whole cents', () => {
    expect(roundCents(10.416666)).toBe(10.42)
    expect(roundCents(31.255)).toBe(31.26)
    expect(roundCents(0)).toBe(0)
    expect(roundCents(null)).toBe(0)
  })
  test('the bug it fixes: TOTALS must equal the sum of the printed rows', () => {
    // Three jobs each with labor (25/60)*25 = 10.41666… → each row prints $10.42.
    const raw = (25 / 60) * 25
    const cell = roundCents(raw)
    expect(cell).toBe(10.42)
    // Total summed from rounded cells == what an accountant gets adding the rows.
    const total = roundCents(cell + cell + cell)
    expect(total).toBe(31.26)
    // (Summing the raw floats first would give 31.25 — the off-by-a-cent defect.)
  })
})

describe('computeProfit', () => {
  test('subtracts every spend bucket from the budget', () => {
    expect(computeProfit(2000, { materials: 300, labor: 100, other: 0 })).toBe(1600)
  })
  test('handoff scenario: $2,000 contract, nothing spent yet → $2,000', () => {
    expect(computeProfit(2000, { materials: 0, labor: 0, other: 0 })).toBe(2000)
  })
  test('goes negative when the job runs over budget', () => {
    expect(computeProfit(1000, { materials: 800, labor: 400, other: 0 })).toBe(-200)
  })
  test('counts "other" costs against profit', () => {
    expect(computeProfit(2000, { materials: 300, labor: 100, other: 100 })).toBe(1500)
  })
  test('tolerates missing spend fields and undefined budget', () => {
    expect(computeProfit(500)).toBe(500)
    expect(computeProfit(500, {})).toBe(500)
    expect(computeProfit(undefined, {})).toBe(0)
  })
})

describe('computeProjectedProfit (forecasts the finished job)', () => {
  const budgets = { materials: 4800, labor: 5200 } // Deck Build; contract 12,500, target 2,500
  test('the bug it fixes: a fresh job shows the profit TARGET, not the whole contract', () => {
    // Old computeProfit(12500, {0,0,0}) returned 12500 at "100% margin". Wrong.
    expect(computeProjectedProfit(12500, budgets, { materials: 0, labor: 0, other: 0 })).toBe(2500)
    expect(computeMargin(2500, 12500)).toBe(20) // 20% margin, not 100%
  })
  test('costs under budget mid-job still forecast to the budget (active job)', () => {
    // Spent 1,000 materials so far — projection still assumes the full 4,800 budget.
    expect(computeProjectedProfit(12500, budgets, { materials: 1000, labor: 0, other: 0 })).toBe(2500)
  })
  test('actuals over budget pull projected profit down', () => {
    // Materials blew past budget to 6,000 → profit = 12500 - 6000 - 5200 = 1300.
    expect(computeProjectedProfit(12500, budgets, { materials: 6000, labor: 5200, other: 0 })).toBe(1300)
  })
  test('"other" costs (no budget bucket) always reduce profit', () => {
    expect(computeProjectedProfit(12500, budgets, { materials: 0, labor: 0, other: 500 })).toBe(2000)
  })
  test('a completed job uses real actuals — under-budget shows the real, higher profit', () => {
    // Finished spending only 4,000 materials + 5,000 labor → actual profit 3,500 > target.
    expect(computeProjectedProfit(12500, budgets, { materials: 4000, labor: 5000, other: 0 }, true)).toBe(3500)
  })
})

describe('computeMargin', () => {
  test('profit as a whole-number percent of the contract price', () => {
    expect(computeMargin(500, 2000)).toBe(25)
  })
  test('rounds to the nearest percent', () => {
    expect(computeMargin(1, 3)).toBe(33)
  })
  test('guards divide-by-zero', () => {
    expect(computeMargin(100, 0)).toBe(0)
    expect(computeMargin(100, undefined)).toBe(0)
  })
})

describe('computeContractPrice', () => {
  test('adds the three budget buckets', () => {
    expect(computeContractPrice(1000, 500, 500)).toBe(2000)
  })
  test('tolerates empty-string and string-number form inputs', () => {
    expect(computeContractPrice('', '', '')).toBe(0)
    expect(computeContractPrice('3000', '1000', '1000')).toBe(5000)
  })
})
