import { computeProfit, computeMargin, computeContractPrice, roundCents } from './money'

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
