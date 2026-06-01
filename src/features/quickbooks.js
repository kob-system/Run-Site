// QuickBooks Online CSV exports.
// Josh imports these in QBO via Settings → Import Data → Invoices / Customers,
// then maps the columns in QBO's wizard. Dates are MM/DD/YYYY (QBO's format).
// Note: QBO imports up to 100 invoices per file — batch if a year exceeds that.

function fmtDate(d) {
  if (!d) return ''
  const dt = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + 'T00:00:00') : new Date(d)
  if (isNaN(dt.getTime())) return ''
  const p = n => String(n).padStart(2, '0')
  return `${p(dt.getMonth() + 1)}/${p(dt.getDate())}/${dt.getFullYear()}`
}

const money = n => (Number(n) || 0).toFixed(2)

// invoices: rows from `invoices` selected with `projects(name, client_name)`.
// One row per invoice (Run-Site invoices are single-amount, not line-itemed).
export function buildQboInvoicesCsv(invoices) {
  const header = ['InvoiceNo', 'Customer', 'InvoiceDate', 'DueDate', 'Item', 'ItemDescription', 'ItemAmount']
  const rows = [header]
  ;(invoices || []).forEach((inv, i) => {
    const customer = (inv.projects && inv.projects.client_name) || 'Customer'
    const job = (inv.projects && inv.projects.name) || ''
    const desc = [inv.label, job].filter(Boolean).join(' - ')
    rows.push([
      `RS-${1001 + i}`,
      customer,
      fmtDate(inv.issued_date || inv.created_at),
      fmtDate(inv.due_date),
      inv.label || 'Services',
      desc,
      money(inv.amount),
    ])
  })
  return rows
}

// customers: one row per distinct client_name across all projects, fields merged.
export function buildQboCustomersCsv(projects) {
  const header = ['Customer', 'Email', 'Phone', 'BillingAddress']
  const map = {}
  ;(projects || []).forEach(p => {
    const name = (p.client_name || '').trim()
    if (!name) return
    const c = map[name] || (map[name] = { name, email: '', phone: '', address: '' })
    if (!c.email && p.client_email) c.email = p.client_email
    if (!c.phone && p.client_phone) c.phone = p.client_phone
    if (!c.address && p.client_address) c.address = p.client_address
  })
  const rows = [header]
  Object.values(map).forEach(c => rows.push([c.name, c.email, c.phone, c.address]))
  return rows
}
