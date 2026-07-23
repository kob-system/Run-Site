// The demo job a brand-new owner lands on.
//
// Why: signing up used to drop you on a completely empty dashboard. Nothing to
// look at, nothing to click, and no way to tell what the app is even FOR. The
// whole pitch is "see what a job actually made you" — so we show that on day
// one, with a finished job whose numbers are already filled in.
//
// Rules:
//   • Seeded ONCE, and only for an owner who has zero jobs. We never touch an
//     account that already has real work in it.
//   • Every row is flagged is_sample (FIX-DATABASE-24) so it's labelled in the
//     UI, excluded from real reporting, and removable in one click.
//   • Entirely best-effort. If any part fails the owner just gets the empty
//     dashboard they'd have had anyway — signup never breaks over demo data.

import { track, EV } from './analytics'

// A believable small-crew kitchen remodel. Billed $12,400; real cost $9,750.21;
// so the dashboard opens on "+$2,649.79 profit / 21.4% margin" — which is the
// exact number a contractor is trying to find out and almost never knows.
const BILLED = 12400
const MATERIALS_BUDGET = 6200
const LABOR_BUDGET = 3000
const PROFIT_TARGET = 3200

// amount is PRE-tax; the dashboard costs a receipt as amount + tax_amount.
const RECEIPTS = [
  { description: 'Cabinets + countertop',      store: 'Curtis Lumber',  amount: 4180.00, tax_amount: 334.40, category: 'materials' },
  { description: 'Tile and underlayment',      store: 'Floor & Decor',  amount: 985.00,  tax_amount: 78.80,  category: 'materials' },
  { description: 'Sink, faucet, disposal',     store: 'Ferguson',       amount: 612.45,  tax_amount: 49.00,  category: 'materials' },
  { description: 'Outlets, lighting, misc',    store: 'Home Depot',     amount: 268.30,  tax_amount: 21.46,  category: 'materials' },
  { description: '10-yard dumpster',           store: 'County Waste',   amount: 385.00,  tax_amount: 30.80,  category: 'other' },
]

// Days-ago the shift started, hours worked, and what it cost. Logged against
// the owner's own profile because a fresh account has no crew yet — owners can
// log their own time (FIX-DATABASE-8), so this is a real, valid entry.
const SHIFTS = [
  { daysAgo: 18, startHour: 7,  hours: 12.0, cost: 660.00 },
  { daysAgo: 17, startHour: 7,  hours: 10.5, cost: 577.50 },
  { daysAgo: 14, startHour: 8,  hours: 11.0, cost: 605.00 },
  { daysAgo: 10, startHour: 8,  hours: 9.0,  cost: 495.00 },
  { daysAgo: 6,  startHour: 8,  hours: 8.5,  cost: 467.50 },
]

const SEEDED_KEY = 'jobtally_sample_seeded'

const daysAgo = (n, hour = 8) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(hour, 0, 0, 0)
  return d
}

// Create the demo job if — and only if — this owner has no jobs at all.
// Returns the created project row, or null when nothing was seeded.
export async function seedSampleJob(supabase, profile) {
  if (!profile || profile.role !== 'owner') return null
  try {
    // Local guard first (cheap), then the authoritative DB check. The local one
    // stops a re-render from double-seeding; the DB one stops a second device.
    if (localStorage.getItem(`${SEEDED_KEY}_${profile.id}`)) return null
  } catch {
    // storage blocked — fall through to the DB check, which is the real gate
  }

  try {
    const { data: existing, error: exErr } = await supabase
      .from('projects')
      .select('id')
      .eq('owner_id', profile.id)
      .limit(1)
    if (exErr) return null
    if (existing && existing.length) {
      // They already have work in here. Never seed over a real account.
      try { localStorage.setItem(`${SEEDED_KEY}_${profile.id}`, '1') } catch {}
      return null
    }

    const { data: project, error } = await supabase
      .from('projects')
      .insert({
        owner_id: profile.id,
        name: 'Sample job — Kitchen remodel',
        client_name: 'Sample Client',
        client_address: '12 Maple St',
        budget: BILLED,
        materials_budget: MATERIALS_BUDGET,
        labor_budget: LABOR_BUDGET,
        profit_target: PROFIT_TARGET,
        stage: 'end',
        completed_at: daysAgo(4).toISOString(),
        is_sample: true,
      })
      .select()
      .single()
    if (error || !project) return null

    // Children are best-effort: a job with partial detail still demonstrates
    // the point far better than an empty screen.
    await Promise.all([
      supabase.from('receipts').insert(
        RECEIPTS.map((r) => ({ ...r, project_id: project.id, owner_id: profile.id }))
      ),
      supabase.from('time_entries').insert(
        SHIFTS.map((s) => {
          const start = daysAgo(s.daysAgo, s.startHour)
          const end = new Date(start.getTime() + s.hours * 60 * 60 * 1000)
          return {
            project_id: project.id,
            worker_id: profile.id,
            clocked_in_at: start.toISOString(),
            clocked_out_at: end.toISOString(),
            total_minutes: Math.round(s.hours * 60),
            labor_cost: s.cost,
          }
        })
      ),
    ])

    try { localStorage.setItem(`${SEEDED_KEY}_${profile.id}`, '1') } catch {}
    track(EV.SAMPLE_JOB_SEEDED, { job_id: project.id })
    return project
  } catch {
    return null // demo data is never worth failing a login over
  }
}

// One-click cleanup from the dashboard banner. Children are removed first in
// case the FKs aren't set to cascade; the project row goes last so a partial
// failure can be retried.
export async function deleteSampleJob(supabase, projectId) {
  if (!projectId) return false
  try {
    await supabase.from('receipts').delete().eq('project_id', projectId)
    await supabase.from('time_entries').delete().eq('project_id', projectId)
    const { error } = await supabase.from('projects').delete().eq('id', projectId)
    if (error) return false
    track(EV.SAMPLE_JOB_DISMISSED, { job_id: projectId })
    return true
  } catch {
    return false
  }
}
