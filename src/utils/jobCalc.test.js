import { computeJobProfit, profitVerdict, formatMoney } from './jobCalc'

describe('computeJobProfit', () => {
  test('typical remodel job: 24k contract, 120h @ $35, 9k materials, 10% overhead', () => {
    const r = computeJobProfit({ contract: '24000', hours: '120', rate: '35', materials: '9000', overheadPct: '10' })
    expect(r.labor).toBe(4200)
    expect(r.materials).toBe(9000)
    expect(r.overhead).toBe(2400)
    expect(r.cost).toBe(15600)
    expect(r.profit).toBe(8400)
    expect(r.margin).toBe(35)
  })

  test('losing job goes negative', () => {
    const r = computeJobProfit({ contract: 5000, hours: 100, rate: 40, materials: 2000, overheadPct: 10 })
    expect(r.profit).toBe(-1500) // 5000 - 4000 - 2000 - 500
    expect(r.margin).toBe(-30)
  })

  test('empty / junk inputs are treated as zero, never NaN', () => {
    const r = computeJobProfit({ contract: '', hours: 'abc', rate: undefined, materials: null, overheadPct: '-5' })
    expect(r.contract).toBe(0)
    expect(r.labor).toBe(0)
    expect(r.overhead).toBe(0) // negative overhead % is clamped to 0
    expect(r.profit).toBe(0)
    expect(r.margin).toBe(0)
  })

  test('cents round cleanly (no floating-point drift)', () => {
    const r = computeJobProfit({ contract: 1000.1, hours: 3, rate: 33.33, materials: 0.1, overheadPct: 0 })
    expect(r.labor).toBe(99.99)
    expect(r.profit).toBe(900.01)
  })

  test('zero contract yields 0% margin, not division blowup', () => {
    const r = computeJobProfit({ contract: 0, hours: 10, rate: 20, materials: 0, overheadPct: 10 })
    expect(r.margin).toBe(0)
    expect(r.profit).toBe(-200)
  })
})

describe('profitVerdict', () => {
  const v = (contract, profit, margin) => profitVerdict({ contract, profit, margin })
  test('no contract → prompt to enter numbers', () => {
    expect(v(0, 0, 0)).toMatch(/put your numbers in/i)
  })
  test('negative profit → paying to work', () => {
    expect(v(5000, -1500, -30)).toMatch(/paying/i)
    expect(v(5000, -1500, -30)).toContain('$1,500')
  })
  test('margin bands', () => {
    expect(v(10000, 500, 5)).toMatch(/under 10%/i)
    expect(v(10000, 1500, 15)).toMatch(/thin/i)
    expect(v(10000, 2500, 25)).toMatch(/solid/i)
    expect(v(10000, 4000, 40)).toMatch(/strong/i)
  })
})

describe('formatMoney', () => {
  test('whole dollars with separators', () => {
    expect(formatMoney(8400)).toBe('$8,400')
    expect(formatMoney(0)).toBe('$0')
  })
})
