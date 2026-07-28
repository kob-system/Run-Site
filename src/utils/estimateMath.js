// Estimate line-item math — extracted from OwnerDashboard so the one number a
// client actually reads (the total on a quote) can be unit-tested.
//
// THE BUG THIS FIXES:
// The old math was `total = subtotal + subtotal * rate`. It taxed EVERYTHING,
// labor included. In New York, and in most states, a contractor who does that
// on a $12,000 job with $7,000 of labor overcharges the customer roughly $560
// in tax he then has to remit or refund. It is the kind of error that ends in
// a chargeback or an audit letter, and the app was making it silently.
//
// WHY A MODE INSTEAD OF PER-LINE CHECKBOXES:
// Taxability is a property of the JOB, not of the line. New York is the clean
// example (Pub 862 / Form ST-124):
//   - CAPITAL IMPROVEMENT (new deck, new roof, finished basement) — the
//     contractor pays tax to the supply house and charges the customer NO
//     sales tax at all. Not on materials, not on labor.
//   - REPAIR / MAINTENANCE (fix the deck, patch the roof) — the ENTIRE charge
//     is taxable, labor included.
// Most other states instead tax materials and exempt labor, which is the
// third mode and the safest default for a first-time user.
//
// Three plain-English choices cover every real job. A taxable checkbox on each
// of fifteen line items would be more "flexible" and would get it wrong more
// often, because the contractor would have to know the rule per line.
import { roundCents } from './money'

// value must match the tax_mode check constraint in FIX-DATABASE-28.
export const TAX_MODES = [
  {
    value: 'materials',
    label: 'Materials only',
    help: 'Tax on materials, not on labor. The usual setup in most states.'
  },
  {
    value: 'repair',
    label: 'Repair or service — tax the whole job',
    help: 'Fixing or maintaining something that already exists. In NY the whole charge is taxable, labor included.'
  },
  {
    value: 'capital',
    label: 'Capital improvement — no sales tax',
    help: 'Building something new and permanent. In NY you pay the tax at the supply house and charge the customer none (Form ST-124).'
  }
]

export const DEFAULT_TAX_MODE = 'materials'

// Anything unrecognised — an older row saved before the tax_mode column
// existed, or a hand-edited value — falls back to the default rather than
// throwing on a screen the owner is trying to send a quote from.
export const normalizeTaxMode = (mode) =>
  TAX_MODES.some(m => m.value === mode) ? mode : DEFAULT_TAX_MODE

export const taxModeLabel = (mode) =>
  (TAX_MODES.find(m => m.value === normalizeTaxMode(mode)) || TAX_MODES[0]).label

export const itemAmount = (it) =>
  (parseFloat(it && it.qty) || 0) * (parseFloat(it && it.unit_price) || 0)

export const subtotal = (items) =>
  (Array.isArray(items) ? items : []).reduce((s, it) => s + itemAmount(it), 0)

// The dollars sales tax is actually charged on. 'other' lines (dump fees,
// permit pass-throughs, equipment rental) follow labor: not taxed in the
// materials-only mode. If one genuinely is taxable, tag it Materials.
export const taxableBase = (items, mode) => {
  const m = normalizeTaxMode(mode)
  if (m === 'capital') return 0
  if (m === 'repair') return subtotal(items)
  return (Array.isArray(items) ? items : [])
    .filter(it => (it && it.kind ? it.kind : 'materials') === 'materials')
    .reduce((s, it) => s + itemAmount(it), 0)
}

// Rounded to whole cents so the printed Subtotal + Tax always equals the
// printed Total — an off-by-a-cent on a document the client pays from is a
// phone call the owner does not want.
export const taxAmount = (items, taxRate, mode) =>
  roundCents(taxableBase(items, mode) * (parseFloat(taxRate) || 0) / 100)

export const estimateTotal = (items, taxRate, mode) =>
  roundCents(roundCents(subtotal(items)) + taxAmount(items, taxRate, mode))
