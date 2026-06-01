// Shared CSV helpers — RFC-4180-ish quoting, used by exports across the app.

export function toCsv(rows) {
  return rows
    .map(r =>
      r
        .map(cell => {
          const v = cell == null ? '' : String(cell)
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
