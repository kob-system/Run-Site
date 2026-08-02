import {
  itemAmount, subtotal, taxableBase, taxAmount, estimateTotal,
  normalizeTaxMode, taxModeLabel, DEFAULT_TAX_MODE, TAX_MODES
} from './estimateMath'

// A realistic small remodel: materials, labor, and a dump fee.
const JOB = [
  { description: 'Cabinets', qty: 1, unit_price: 4000, kind: 'materials' },
  { description: 'Tile', qty: 200, unit_price: 5, kind: 'materials' },
  { description: 'Install', qty: 40, unit_price: 75, kind: 'labor' },
  { description: 'Dumpster', qty: 1, unit_price: 400, kind: 'other' }
]
// materials 5,000 · labor 3,000 · other 400 · subtotal 8,400

describe('itemAmount', () => {
  test('multiplies qty by unit price', () => {
    expect(itemAmount({ qty: 3, unit_price: 12.5 })).toBe(37.5)
  })
  test('tolerates the string values the form actually holds', () => {
    expect(itemAmount({ qty: '2', unit_price: '10.50' })).toBe(21)
  })
  test('treats blank and missing as zero instead of NaN', () => {
    expect(itemAmount({ qty: '', unit_price: '' })).toBe(0)
    expect(itemAmount({})).toBe(0)
    expect(itemAmount(null)).toBe(0)
    expect(itemAmount(undefined)).toBe(0)
  })
})

describe('subtotal', () => {
  test('sums every line regardless of kind', () => {
    expect(subtotal(JOB)).toBe(8400)
  })
  test('survives a non-array (a row that never loaded)', () => {
    expect(subtotal(null)).toBe(0)
    expect(subtotal(undefined)).toBe(0)
    expect(subtotal([])).toBe(0)
  })
})

describe('taxableBase — the actual fix', () => {
  test('materials mode taxes materials only, not labor and not other', () => {
    expect(taxableBase(JOB, 'materials')).toBe(5000)
  })
  test('repair mode taxes the whole charge, labor included (the NY repair rule)', () => {
    expect(taxableBase(JOB, 'repair')).toBe(8400)
  })
  test('capital improvement taxes nothing at all (NY Form ST-124)', () => {
    expect(taxableBase(JOB, 'capital')).toBe(0)
  })
  test('an untagged line counts as materials — it is the form default', () => {
    expect(taxableBase([{ qty: 1, unit_price: 100 }], 'materials')).toBe(100)
  })
  test('an unknown or missing mode falls back to materials, never throws', () => {
    expect(taxableBase(JOB, undefined)).toBe(5000)
    expect(taxableBase(JOB, 'nonsense')).toBe(5000)
  })
})

describe('taxAmount', () => {
  test('applies the rate to the taxable base, not the subtotal', () => {
    // 8% of 5,000 materials = 400. The old math billed 8% of 8,400 = 672.
    expect(taxAmount(JOB, 8, 'materials')).toBe(400)
  })
  test('repair mode bills tax on the whole job', () => {
    expect(taxAmount(JOB, 8, 'repair')).toBe(672)
  })
  test('capital improvement bills no tax even with a rate typed in', () => {
    expect(taxAmount(JOB, 8, 'capital')).toBe(0)
  })
  test('no rate means no tax', () => {
    expect(taxAmount(JOB, '', 'materials')).toBe(0)
    expect(taxAmount(JOB, null, 'materials')).toBe(0)
  })
  test('rounds to whole cents', () => {
    // Albany County is 8%; use a rate that produces a third-of-a-cent.
    const items = [{ qty: 1, unit_price: 33.33, kind: 'materials' }]
    expect(taxAmount(items, 8.375, 'materials')).toBe(2.79)
  })
})

describe('estimateTotal', () => {
  test('subtotal plus tax on the taxable base', () => {
    expect(estimateTotal(JOB, 8, 'materials')).toBe(8800)
  })
  test('repair mode', () => {
    expect(estimateTotal(JOB, 8, 'repair')).toBe(9072)
  })
  test('capital improvement equals the subtotal exactly', () => {
    expect(estimateTotal(JOB, 8, 'capital')).toBe(8400)
  })
  test('printed subtotal + printed tax always equals printed total', () => {
    const items = [
      { qty: 3, unit_price: 19.99, kind: 'materials' },
      { qty: 7.5, unit_price: 82.35, kind: 'labor' }
    ]
    const sub = Math.round(subtotal(items) * 100) / 100
    const tax = taxAmount(items, 8.375, 'materials')
    expect(estimateTotal(items, 8.375, 'materials')).toBe(Math.round((sub + tax) * 100) / 100)
  })
  test('an empty estimate is zero, not NaN', () => {
    expect(estimateTotal([], 8, 'materials')).toBe(0)
    expect(estimateTotal(null, 8, 'materials')).toBe(0)
  })
})

describe('mode helpers', () => {
  test('normalizeTaxMode keeps valid values and rescues everything else', () => {
    TAX_MODES.forEach(m => expect(normalizeTaxMode(m.value)).toBe(m.value))
    expect(normalizeTaxMode(null)).toBe(DEFAULT_TAX_MODE)
    expect(normalizeTaxMode('')).toBe(DEFAULT_TAX_MODE)
    expect(normalizeTaxMode('CAPITAL')).toBe(DEFAULT_TAX_MODE)
  })
  test('every mode has a plain-English label and help line', () => {
    TAX_MODES.forEach(m => {
      expect(typeof m.label).toBe('string')
      expect(m.label.length).toBeGreaterThan(0)
      expect(m.help.length).toBeGreaterThan(0)
    })
  })
  test('taxModeLabel never returns undefined', () => {
    expect(taxModeLabel('capital')).toBe('Capital improvement — no sales tax')
    expect(taxModeLabel('junk')).toBe('Materials only')
  })
})
