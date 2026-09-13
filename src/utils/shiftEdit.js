// The owner fixing a shift: the pure parts, pulled out so they can be tested
// without a screen.
//
// Every time here is the OWNER's local time. The inputs on the fix sheet are a
// plain <input type="date"> and <input type="time">, and a 'YYYY-MM-DDTHH:MM'
// string with no zone on the end is read by the browser as local. That is the
// whole trick: never build these from toISOString(), which is UTC and after
// ~8pm Eastern puts the shift on tomorrow.
//
// The database is still the one that decides hours and pay. The payroll
// trigger (FIX-DATABASE-8, extended in 29) recomputes total_minutes and
// labor_cost on every insert or update from the worker's own rate. The math
// below only mirrors it for the "about" preview before he taps Save.

import { roundCents } from './money'

const pad = (n) => String(n).padStart(2, '0')

// A timestamp → { date: 'YYYY-MM-DD', time: 'HH:MM' }, local, for the inputs.
export const toLocalInputs = (value) => {
  const d = value instanceof Date ? value : new Date(value)
  if (value == null || isNaN(d.getTime())) return { date: '', time: '' }
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  }
}

// The inputs back to a Date, read as local time. null for anything unreadable.
export const fromLocalInputs = (date, time) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^\d{2}:\d{2}/.test(time || '')) return null
  const d = new Date(`${date}T${time.slice(0, 5)}:00`)
  return isNaN(d.getTime()) ? null : d
}

export const MAX_SHIFT_MINUTES = 24 * 60

// '' when the shift can be saved, otherwise the one plain sentence to show him.
// A minute of slack on "later than now" so a clock-out stamped this very
// minute never trips over a phone clock a few seconds ahead of the server.
export const shiftProblem = (inAt, outAt, now = new Date()) => {
  if (!inAt) return 'Pick the day and time he clocked in.'
  if (!outAt) return 'Pick the day and time he clocked out.'
  if (outAt.getTime() <= inAt.getTime()) return 'Clock-out has to be after clock-in.'
  if (outAt.getTime() - inAt.getTime() > MAX_SHIFT_MINUTES * 60000) return 'That is more than 24 hours on one shift. Check the day and the times.'
  if (outAt.getTime() > now.getTime() + 60000) return 'Clock-out can’t be later than right now.'
  return ''
}

// Same rounding as the trigger: whole minutes, floored.
export const shiftMinutes = (inAt, outAt) =>
  Math.max(0, Math.floor((new Date(outAt).getTime() - new Date(inAt).getTime()) / 60000))

// Same as the trigger: (minutes / 60) × his rate, to the cent.
export const shiftPay = (minutes, rate) => roundCents(((minutes || 0) / 60) * (rate || 0))

// "7:02 AM". Built by hand rather than toLocaleTimeString so it reads the same
// on every phone (newer ICU puts an invisible narrow space before AM).
export const clockTime = (value) => {
  const d = new Date(value)
  if (value == null || isNaN(d.getTime())) return ''
  const h = d.getHours() % 12 || 12
  return `${h}:${pad(d.getMinutes())} ${d.getHours() < 12 ? 'AM' : 'PM'}`
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// "Tue, Sep 8" for a shift row.
export const shiftDay = (value) => {
  const d = new Date(value)
  if (value == null || isNaN(d.getTime())) return ''
  return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`
}

// What goes after "Still on the clock since". Today: just the time. Any other
// day: the day too, because "since 7:02 AM" on a shift that started Tuesday is
// exactly the lie that hides a forgotten clock-out.
export const sinceLabel = (value, now = new Date()) => {
  const d = new Date(value)
  if (value == null || isNaN(d.getTime())) return ''
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  return sameDay ? clockTime(d) : `${shiftDay(d)}, ${clockTime(d)}`
}

// Past this, an open shift is almost certainly a man who went home and forgot.
export const LONG_OPEN_MINUTES = 12 * 60
