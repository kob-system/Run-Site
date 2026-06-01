import { toCsv } from './csv'

describe('toCsv (RFC-4180-ish quoting)', () => {
  test('joins rows with newlines and cells with commas', () => {
    expect(toCsv([['a', 'b'], ['c', 'd']])).toBe('a,b\nc,d')
  })
  test('quotes a cell that contains a comma', () => {
    expect(toCsv([['Smith, Bob', 'x']])).toBe('"Smith, Bob",x')
  })
  test('escapes embedded double-quotes by doubling them', () => {
    expect(toCsv([['he said "hi"']])).toBe('"he said ""hi"""')
  })
  test('quotes a cell that contains a newline', () => {
    expect(toCsv([['line1\nline2']])).toBe('"line1\nline2"')
  })
  test('renders null and undefined as empty cells', () => {
    expect(toCsv([[null, undefined, 'x']])).toBe(',,x')
  })
  test('stringifies numbers, including 0', () => {
    expect(toCsv([[0, 12.5, -3]])).toBe('0,12.5,-3')
  })
  test('leaves a plain cell unquoted', () => {
    expect(toCsv([['plain']])).toBe('plain')
  })
})
