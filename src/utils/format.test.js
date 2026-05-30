import { formatCurrency } from './formatCurrency'
import { formatTime } from './formatTime'

test('formatCurrency formats whole-dollar amounts', () => {
  expect(formatCurrency(1500)).toBe('$1,500')
  expect(formatCurrency(0)).toBe('$0')
  expect(formatCurrency(null)).toBe('$0')
})

test('formatTime converts minutes into hours and minutes', () => {
  expect(formatTime(90)).toBe('1h 30m')
  expect(formatTime(0)).toBe('0h 0m')
  expect(formatTime(125)).toBe('2h 5m')
})
