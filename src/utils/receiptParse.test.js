// Tests for the receipt scanner's number reconciliation. The module lives in
// api/ because that's where it runs (a Vercel function can't import out of the
// React bundle), but the test lives here because this is where jest looks.
import { reconcileMoney, normalizeDate, buildScanResponse } from '../../api/_receiptParse'

describe('reconcileMoney', () => {
  // THE bug this file exists to prevent: the scanner used to return the grand
  // total as `amount` and the tax as `tax`, and the dashboard books a receipt's
  // cost as amount + tax. Every scanned receipt charged the job its sales tax
  // twice. amount + tax must always equal total.
  const invariant = (r) => {
    if (r.amount === null) return
    expect(Math.round((r.amount + (r.tax || 0)) * 100) / 100).toBe(r.total)
  }

  test('subtotal + tax + total all printed: taken as-is', () => {
    const r = reconcileMoney({ subtotal: 100, sales_tax: 8, total: 108 })
    expect(r).toEqual({ amount: 100, tax: 8, total: 108 })
    invariant(r)
  })

  test('only the total and the tax: the subtotal is derived, not the total', () => {
    const r = reconcileMoney({ sales_tax: 8, total: 108 })
    expect(r.amount).toBe(100)
    invariant(r)
  })

  test('only a subtotal and a tax: the total is derived', () => {
    const r = reconcileMoney({ subtotal: 100, sales_tax: 8 })
    expect(r).toEqual({ amount: 100, tax: 8, total: 108 })
  })

  test('a receipt with no tax line books the whole total as the cost', () => {
    const r = reconcileMoney({ total: 108 })
    expect(r).toEqual({ amount: 108, tax: null, total: 108 })
    invariant(r)
  })

  test('the model echoing the total into the subtotal is corrected, not trusted', () => {
    // A model that reads "TOTAL 108.00" twice would otherwise produce
    // amount 108 + tax 8 = a $116 cost on a $108 receipt.
    const r = reconcileMoney({ subtotal: 108, sales_tax: 8, total: 108 })
    expect(r.amount).toBe(100)
    invariant(r)
  })

  test('a tax bigger than the total is a misread and gets dropped', () => {
    const r = reconcileMoney({ total: 40, sales_tax: 400 })
    expect(r).toEqual({ amount: 40, tax: null, total: 40 })
  })

  test('a tax at an impossible rate is dropped rather than inflating spend', () => {
    // 30% "tax" on a $50 receipt is some other line off the paper.
    const r = reconcileMoney({ total: 50, sales_tax: 15 })
    expect(r).toEqual({ amount: 50, tax: null, total: 50 })
  })

  test('a real 8.375% Albany tax is kept', () => {
    const r = reconcileMoney({ subtotal: 1204.55, sales_tax: 100.88, total: 1305.43 })
    expect(r).toEqual({ amount: 1204.55, tax: 100.88, total: 1305.43 })
    invariant(r)
  })

  test('comma-formatted strings are read as money', () => {
    const r = reconcileMoney({ subtotal: '1,204.55', sales_tax: '$100.88', total: '1,305.43' })
    expect(r.amount).toBe(1204.55)
    expect(r.tax).toBe(100.88)
  })

  test('a penny of rounding drift is tolerated', () => {
    const r = reconcileMoney({ subtotal: 100, sales_tax: 8.01, total: 108 })
    expect(r.amount).toBe(100)
    expect(r.tax).toBe(8.01)
  })

  test('nothing readable returns nulls, not zeros', () => {
    expect(reconcileMoney({})).toEqual({ amount: null, tax: null, total: null })
    expect(reconcileMoney(null)).toEqual({ amount: null, tax: null, total: null })
    expect(reconcileMoney({ total: 0, sales_tax: 0 })).toEqual({ amount: null, tax: null, total: null })
  })

  test('a negative total is not money', () => {
    expect(reconcileMoney({ total: -25 }).total).toBeNull()
  })
})

describe('normalizeDate', () => {
  const TODAY = '2026-07-28'

  test('the format we asked for passes through', () => {
    expect(normalizeDate('2026-07-14', TODAY)).toBe('2026-07-14')
  })

  test('single-digit ISO parts get padded', () => {
    expect(normalizeDate('2026-7-4', TODAY)).toBe('2026-07-04')
  })

  test('US slash dates off the paper are converted', () => {
    expect(normalizeDate('07/14/2026', TODAY)).toBe('2026-07-14')
    expect(normalizeDate('7/4/26', TODAY)).toBe('2026-07-04')
    expect(normalizeDate('3-14-25', TODAY)).toBe('2025-03-14')
  })

  test('a future date is a misread and files the expense in the wrong year', () => {
    expect(normalizeDate('2027-01-05', TODAY)).toBeNull()
  })

  test('one day ahead is allowed — timezone slack, not a misread', () => {
    expect(normalizeDate('2026-07-29', TODAY)).toBe('2026-07-29')
  })

  test('an impossible calendar date is rejected', () => {
    expect(normalizeDate('2026-02-31', TODAY)).toBeNull()
    expect(normalizeDate('2026-13-01', TODAY)).toBeNull()
  })

  test('junk, NONE, and empties are null', () => {
    expect(normalizeDate('NONE', TODAY)).toBeNull()
    expect(normalizeDate('', TODAY)).toBeNull()
    expect(normalizeDate(null, TODAY)).toBeNull()
    expect(normalizeDate('last Tuesday', TODAY)).toBeNull()
  })

  test('a year before the app existed is a misread', () => {
    expect(normalizeDate('1998-04-02', TODAY)).toBeNull()
  })
})

describe('buildScanResponse', () => {
  const TODAY = '2026-07-28'

  test('the shape the two callers read', () => {
    expect(buildScanResponse({
      readable: true, store: 'Home  Depot ', subtotal: 100, sales_tax: 8, total: 108, purchase_date: '07/14/2026',
    }, TODAY)).toEqual({ store: 'Home Depot', amount: '100.00', tax: '8.00', total: '108.00', date: '2026-07-14' })
  })

  test('money comes back as fixed-2 strings for the text inputs', () => {
    const r = buildScanResponse({ total: 42.5 }, TODAY)
    expect(r.amount).toBe('42.50')
    expect(r.tax).toBeNull()
  })

  test('an unreadable photo returns blanks the caller can fall through on', () => {
    expect(buildScanResponse({ readable: false }, TODAY)).toEqual({
      store: '', amount: '', tax: null, total: null, date: null,
    })
  })

  test('a store name longer than the column is truncated, not rejected', () => {
    const r = buildScanResponse({ store: 'x'.repeat(200), total: 10 }, TODAY)
    expect(r.store).toHaveLength(80)
  })
})
