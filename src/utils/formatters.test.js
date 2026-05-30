import { formatCurrency } from './formatCurrency'
import { formatTime } from './formatTime'

describe('formatCurrency', () => {
  test('formats with a $ and exactly two decimals', () => {
    expect(formatCurrency(1000)).toBe('$1,000.00')
    expect(formatCurrency(1234.5)).toBe('$1,234.50')
  })
  test('treats null/undefined/0 as $0.00', () => {
    expect(formatCurrency(0)).toBe('$0.00')
    expect(formatCurrency(null)).toBe('$0.00')
    expect(formatCurrency(undefined)).toBe('$0.00')
  })
})

describe('formatTime', () => {
  test('formats minutes as "Xh Ym"', () => {
    expect(formatTime(90)).toBe('1h 30m')
    expect(formatTime(60)).toBe('1h 0m')
    expect(formatTime(125)).toBe('2h 5m')
  })
  test('treats null/0 as "0h 0m"', () => {
    expect(formatTime(0)).toBe('0h 0m')
    expect(formatTime(null)).toBe('0h 0m')
  })
})
