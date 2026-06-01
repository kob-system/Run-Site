import { buildQboInvoicesCsv, buildQboCustomersCsv } from './quickbooks'

const HDR_INV = ['InvoiceNo', 'Customer', 'InvoiceDate', 'DueDate', 'Item', 'ItemDescription', 'ItemAmount']
const HDR_CUST = ['Customer', 'Email', 'Phone', 'BillingAddress']

describe('buildQboInvoicesCsv', () => {
  test('emits the QBO header row first', () => {
    expect(buildQboInvoicesCsv([])[0]).toEqual(HDR_INV)
  })

  test('maps an invoice to a QBO row with MM/DD/YYYY dates', () => {
    const [, row] = buildQboInvoicesCsv([
      {
        label: 'Deposit',
        amount: 1000,
        issued_date: '2026-05-01',
        due_date: '2026-05-15',
        projects: { name: 'Kitchen Remodel', client_name: 'Sarah Lee' },
      },
    ])
    expect(row).toEqual([
      'RS-1001',
      'Sarah Lee',
      '05/01/2026',
      '05/15/2026',
      'Deposit',
      'Deposit - Kitchen Remodel',
      '1000.00',
    ])
  })

  test('numbers invoices sequentially from RS-1001', () => {
    const rows = buildQboInvoicesCsv([{ amount: 1 }, { amount: 2 }, { amount: 3 }])
    expect(rows.slice(1).map(r => r[0])).toEqual(['RS-1001', 'RS-1002', 'RS-1003'])
  })

  test('falls back gracefully when project, customer, label, and dates are missing', () => {
    const [, row] = buildQboInvoicesCsv([{ amount: 50 }])
    expect(row[1]).toBe('Customer') // no client_name
    expect(row[2]).toBe('') // no issued/created date
    expect(row[3]).toBe('') // no due date
    expect(row[4]).toBe('Services') // no label
    expect(row[5]).toBe('') // description empty
    expect(row[6]).toBe('50.00')
  })

  test('uses created_at when issued_date is absent', () => {
    const [, row] = buildQboInvoicesCsv([{ amount: 10, created_at: '2026-01-09' }])
    expect(row[2]).toBe('01/09/2026')
  })

  test('formats amounts to two decimals and tolerates non-numeric', () => {
    expect(buildQboInvoicesCsv([{ amount: '1234.5' }])[1][6]).toBe('1234.50')
    expect(buildQboInvoicesCsv([{ amount: null }])[1][6]).toBe('0.00')
  })

  test('tolerates null/undefined input → header only', () => {
    expect(buildQboInvoicesCsv(null)).toEqual([HDR_INV])
    expect(buildQboInvoicesCsv(undefined)).toEqual([HDR_INV])
  })
})

describe('buildQboCustomersCsv', () => {
  test('emits the QBO customer header first', () => {
    expect(buildQboCustomersCsv([])[0]).toEqual(HDR_CUST)
  })

  test("one row per distinct client, merging fields across that client's jobs", () => {
    const rows = buildQboCustomersCsv([
      { client_name: 'Sarah', client_email: '', client_phone: '555-1212', client_address: '' },
      { client_name: 'Sarah', client_email: 'sarah@x.com', client_phone: '', client_address: '1 Main St' },
      { client_name: 'Bob', client_phone: '999-0000' },
    ])
    const sarah = rows.filter(r => r[0] === 'Sarah')
    expect(sarah).toHaveLength(1) // deduped
    expect(sarah[0]).toEqual(['Sarah', 'sarah@x.com', '555-1212', '1 Main St']) // merged
    expect(rows.find(r => r[0] === 'Bob')).toEqual(['Bob', '', '999-0000', ''])
  })

  test('keeps the first non-empty value for each field', () => {
    const rows = buildQboCustomersCsv([
      { client_name: 'A', client_email: 'first@x.com' },
      { client_name: 'A', client_email: 'second@x.com' },
    ])
    expect(rows.find(r => r[0] === 'A')[1]).toBe('first@x.com')
  })

  test('skips blank or whitespace-only client names', () => {
    const rows = buildQboCustomersCsv([
      { client_name: '' },
      { client_name: '   ' },
      { client_name: 'Real' },
    ])
    expect(rows).toHaveLength(2) // header + Real
    expect(rows[1][0]).toBe('Real')
  })

  test('tolerates null/undefined input → header only', () => {
    expect(buildQboCustomersCsv(null)).toEqual([HDR_CUST])
  })
})
