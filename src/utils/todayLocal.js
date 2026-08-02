// Today's date as YYYY-MM-DD in the DEVICE's timezone, not UTC.
//
// The obvious `new Date().toISOString().split('T')[0]` is wrong for everyone
// west of Greenwich. In Eastern time (UTC-4/-5) it starts returning TOMORROW
// at 8pm local — so a crew member checking the app after supper saw today's
// schedule vanish, and a receipt or mileage entry logged that evening got
// pre-filled with tomorrow's date. At New Year's Eve that lands in the wrong
// tax year.
//
// `scheduled_date`, `trip_date`, `log_date`, `work_date`, and `issued_date`
// are all Postgres `date` columns holding a plain calendar day — they have no
// timezone, so they must be compared against a plain LOCAL calendar day.
export function todayLocal(d = new Date()) {
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
