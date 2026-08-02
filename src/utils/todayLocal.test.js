import { todayLocal } from './todayLocal'

describe('todayLocal', () => {
  test('returns the LOCAL calendar day, not the UTC one', () => {
    // 8:30pm on Aug 2 in Eastern time. toISOString() would say 2026-08-03.
    const evening = new Date(2026, 7, 2, 20, 30, 0)
    expect(todayLocal(evening)).toBe('2026-08-02')
  })

  test('zero-pads month and day', () => {
    expect(todayLocal(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  test("does not roll into next year on New Year's Eve", () => {
    // The bug that would have dated a receipt into the wrong tax year.
    expect(todayLocal(new Date(2026, 11, 31, 22, 0, 0))).toBe('2026-12-31')
  })

  test('defaults to now and returns a well-formed date', () => {
    expect(todayLocal()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
