import { computeProfit, computeMargin, computeContractPrice, roundCents, profitPicture } from './money'

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

describe('profitPicture (the job profit card)', () => {
  // The job from the bug report: $13,500 contract split 6,000 / 4,800 / 2,700.
  const job = { contract: 13500, materialsBudget: 6000, laborBudget: 4800, profitTarget: 2700 }

  test('the bug: a new job with $0 spent shows the target, never the whole contract', () => {
    const p = profitPicture({ ...job, spend: { materials: 0, labor: 0, other: 0 } })
    expect(p.mode).toBe('target')
    expect(p.amount).toBe(2700)
    expect(p.amount).not.toBe(13500)
  })
  test('no spend object at all is still the target', () => {
    expect(profitPicture(job)).toMatchObject({ mode: 'target', amount: 2700, spent: 0 })
  })
  test('costs inside budget: still on track for the target, not contract minus spend', () => {
    const p = profitPicture({ ...job, spend: { materials: 500, labor: 0, other: 0 } })
    expect(p).toMatchObject({ mode: 'onTrack', amount: 2700, target: 2700, spent: 500 })
  })
  test('a bucket over budget comes straight off the profit', () => {
    const p = profitPicture({ ...job, spend: { materials: 7000, labor: 1000, other: 0 } })
    expect(p.amount).toBe(1700)
  })
  test('both buckets over and other costs: can go negative', () => {
    const p = profitPicture({ ...job, spend: { materials: 8000, labor: 6000, other: 300 } })
    expect(p.amount).toBe(13500 - 8000 - 6000 - 300)
    expect(p.amount).toBeLessThan(0)
  })
  test('other costs have no bucket, so every dollar counts', () => {
    expect(profitPicture({ ...job, spend: { other: 250 } }).amount).toBe(2450)
  })
  test('approved extras in the contract raise it', () => {
    expect(profitPicture({ ...job, contract: 14000, spend: { materials: 100 } }).amount).toBe(3200)
  })
  test('finished job with costs: the real number, contract minus spend', () => {
    const p = profitPicture({ ...job, finished: true, spend: { materials: 5500, labor: 4800, other: 0 } })
    expect(p).toMatchObject({ mode: 'final', amount: 3200 })
  })
  test('finished job with nothing logged still refuses to call the contract profit', () => {
    expect(profitPicture({ ...job, finished: true }).mode).toBe('target')
  })
  test('no split set: no profit number to show', () => {
    const p = profitPicture({ contract: 5000, spend: { materials: 100 } })
    expect(p.mode).toBe('noTarget')
    expect(p.amount).toBeNull()
    expect(p.spent).toBe(100)
  })
  test('tolerates being called with nothing', () => {
    expect(profitPicture().mode).toBe('noTarget')
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
