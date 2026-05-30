import { computeProfit, computeMargin, computeContractPrice } from './money'

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
