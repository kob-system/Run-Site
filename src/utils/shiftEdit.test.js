import {
  toLocalInputs, fromLocalInputs, shiftProblem, shiftMinutes, shiftPay,
  clockTime, shiftDay, sinceLabel, MAX_SHIFT_MINUTES,
} from './shiftEdit'

// Every Date here is built from LOCAL parts (new Date(y, m, d, h, min)), so the
// suite passes in any timezone the machine happens to be in.
const at = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min)

describe('toLocalInputs / fromLocalInputs (owner local time)', () => {
  test('a timestamp becomes the local date and time the inputs expect', () => {
    expect(toLocalInputs(at(2026, 9, 8, 7, 2))).toEqual({ date: '2026-09-08', time: '07:02' })
    expect(toLocalInputs(at(2026, 9, 8, 7, 2).toISOString())).toEqual({ date: '2026-09-08', time: '07:02' })
  })
  test('round trip lands on the same local minute', () => {
    const d = at(2026, 12, 31, 23, 45)
    const { date, time } = toLocalInputs(d)
    expect(fromLocalInputs(date, time).getTime()).toBe(d.getTime())
  })
  test('late evening stays on the same day (the UTC trap)', () => {
    expect(toLocalInputs(at(2026, 9, 8, 22, 30)).date).toBe('2026-09-08')
  })
  test('blank or junk gives nothing to save', () => {
    expect(toLocalInputs(null)).toEqual({ date: '', time: '' })
    expect(toLocalInputs('not a date')).toEqual({ date: '', time: '' })
    expect(fromLocalInputs('', '07:00')).toBeNull()
    expect(fromLocalInputs('2026-09-08', '')).toBeNull()
    expect(fromLocalInputs('9/8/2026', '07:00')).toBeNull()
  })
})

describe('shiftProblem', () => {
  const now = at(2026, 9, 8, 18, 0)
  test('a normal day is fine', () => {
    expect(shiftProblem(at(2026, 9, 8, 7, 2), at(2026, 9, 8, 15, 30), now)).toBe('')
  })
  test('refuses clock-out before clock-in', () => {
    expect(shiftProblem(at(2026, 9, 8, 15), at(2026, 9, 8, 7), now)).toBe('Clock-out has to be after clock-in.')
  })
  test('refuses clock-out equal to clock-in', () => {
    expect(shiftProblem(at(2026, 9, 8, 7), at(2026, 9, 8, 7), now)).toBe('Clock-out has to be after clock-in.')
  })
  test('refuses a shift over 24 hours', () => {
    expect(shiftProblem(at(2026, 9, 6, 7), at(2026, 9, 7, 7, 1), now)).toMatch(/more than 24 hours/)
  })
  test('exactly 24 hours is allowed', () => {
    expect(shiftProblem(at(2026, 9, 6, 7), at(2026, 9, 7, 7), now)).toBe('')
    expect(MAX_SHIFT_MINUTES).toBe(1440)
  })
  test('an overnight shift across midnight is fine', () => {
    expect(shiftProblem(at(2026, 9, 7, 22), at(2026, 9, 8, 6), now)).toBe('')
  })
  test('refuses a clock-out in the future', () => {
    expect(shiftProblem(at(2026, 9, 8, 7), at(2026, 9, 8, 19), now)).toMatch(/later than right now/)
  })
  test('asks for the missing half', () => {
    expect(shiftProblem(null, at(2026, 9, 8, 15), now)).toMatch(/clocked in/)
    expect(shiftProblem(at(2026, 9, 8, 7), null, now)).toMatch(/clocked out/)
  })
})

describe('shiftMinutes / shiftPay mirror the payroll trigger', () => {
  test('whole minutes, floored', () => {
    expect(shiftMinutes(at(2026, 9, 8, 7, 2), at(2026, 9, 8, 15, 30))).toBe(508)
    expect(shiftMinutes(new Date(0), new Date(119999))).toBe(1)
  })
  test('never negative', () => {
    expect(shiftMinutes(at(2026, 9, 8, 15), at(2026, 9, 8, 7))).toBe(0)
  })
  test('pay is minutes over 60 times the rate, to the cent', () => {
    expect(shiftPay(508, 20)).toBe(169.33)
    expect(shiftPay(480, 25)).toBe(200)
    expect(shiftPay(480, null)).toBe(0)
  })
})

describe('labels', () => {
  test('clockTime', () => {
    expect(clockTime(at(2026, 9, 8, 7, 2))).toBe('7:02 AM')
    expect(clockTime(at(2026, 9, 8, 0, 5))).toBe('12:05 AM')
    expect(clockTime(at(2026, 9, 8, 12, 0))).toBe('12:00 PM')
    expect(clockTime(at(2026, 9, 8, 15, 30))).toBe('3:30 PM')
    expect(clockTime(null)).toBe('')
  })
  test('shiftDay', () => {
    expect(shiftDay(at(2026, 9, 8, 7))).toBe('Tue, Sep 8')
  })
  test('sinceLabel: today is just the time', () => {
    expect(sinceLabel(at(2026, 9, 8, 7, 2), at(2026, 9, 8, 16))).toBe('7:02 AM')
  })
  test('sinceLabel: an older open shift names the day, so a forgotten clock-out shows', () => {
    expect(sinceLabel(at(2026, 9, 7, 7, 2), at(2026, 9, 8, 16))).toBe('Mon, Sep 7, 7:02 AM')
  })
})
