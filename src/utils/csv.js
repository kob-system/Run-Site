// Shared CSV helpers — RFC-4180-ish quoting, used by exports across the app.

// CSV formula-injection guard. Spreadsheet apps (Excel/Sheets/QBO import)
// execute a cell that starts with = + - @ or a control char, so a client name
// like `=HYPERLINK("http://evil","click")` becomes live code in whoever opens
// the export. Neutralize by prefixing a single quote — the standard OWASP
// mitigation. Applied to every stringified cell before quoting.
function sanitizeCell(v) {
  // A pure number — including a negative or decimal like -12.50 — is legitimate
  // data, not a formula, so it must NOT get a quote prefix (that corrupts every
  // negative dollar amount in an export). Only a lead char followed by more than
  // a plain number can be an injection (`-3+cmd`, `=SUM(...)`), and those stay guarded.
  if (/^[-+]?(\d+\.?\d*|\.\d+)$/.test(v)) return v
  return /^[=+\-@\t\r]/.test(v) ? "'" + v : v
}

export function toCsv(rows) {
  return rows
    .map(r =>
      r
        .map(cell => {
          const v = sanitizeCell(cell == null ? '' : String(cell))
          return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v
        })
        .join(',')
    )
    .join('\n')
}

export function downloadCsv(rows, filename) {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
