// Tests for the weekly digest's arithmetic. The module lives in api/ because
// that's where it runs (a Vercel function can't import out of the React
// bundle); the test lives here because this is where jest looks.
//
// This email states dollar figures to a paying customer once a week,
// unprompted, with nobody reviewing it first. A wrong number is the product's
// central promise failing in writing, in their inbox — so every rule the
// dashboard applies is pinned here too.
import { buildDigest, roundCents, THIN_MARGIN } from '../../api/_digestMath'

const WEEK_START = '2026-08-10T00:00:00.000Z'
const WEEK_END = '2026-08-17T00:00:00.000Z'
const inside = '2026-08-12T15:00:00.000Z'
const before = '2026-08-03T15:00:00.000Z'

const base = (over = {}) => ({
  projects: [{ id: 'j1', name: 'Maple St. Deck', budget: 10000, stage: 'start' }],
  receipts: [], timeEntries: [], changeOrders: [], invoices: [],
  weekStartISO: WEEK_START, weekEndISO: WEEK_END,
  ...over,
})

describe('what counts as spend', () => {
  test("a receipt's sales tax is part of what the job cost", () => {
    const d = buildDigest(base({
      receipts: [{ project_id: 'j1', amount: 100, tax_amount: 8.5, category: 'materials', purchase_date: inside }],
    }))
    expect(d.week.materials).toBe(108.5)
    expect(d.jobs[0].materials).toBe(108.5)
    expect(d.jobs[0].profit).toBe(9891.5)
  })

  test('a shift still in progress is NOT counted — it has no final cost yet', () => {
    // The single most dangerous row type: an open shift has labor_cost null.
    // Counting it would understate spend and overstate profit.
    const d = buildDigest(base({
      timeEntries: [
        { project_id: 'j1', labor_cost: 300, total_minutes: 480, clocked_out_at: inside },
        { project_id: 'j1', labor_cost: null, total_minutes: null, clocked_out_at: null },
      ],
    }))
    expect(d.week.labor).toBe(300)
    expect(d.week.hours).toBe(8)
    expect(d.jobs[0].labor).toBe(300)
  })

  test('non-materials receipts land in "other", not silently dropped', () => {
    const d = buildDigest(base({
      receipts: [{ project_id: 'j1', amount: 200, tax_amount: 0, category: 'permit', purchase_date: inside }],
    }))
    expect(d.week.other).toBe(200)
    expect(d.week.total).toBe(200)
    expect(d.jobs[0].other).toBe(200)
  })

  test('the week total always equals its own parts', () => {
    const d = buildDigest(base({
      receipts: [
        { project_id: 'j1', amount: 100.33, tax_amount: 8.11, category: 'materials', purchase_date: inside },
        { project_id: 'j1', amount: 50.55, tax_amount: 4.07, category: 'dump fee', purchase_date: inside },
      ],
      timeEntries: [{ project_id: 'j1', labor_cost: 187.77, total_minutes: 300, clocked_out_at: inside }],
    }))
    expect(d.week.total).toBe(roundCents(d.week.materials + d.week.labor + d.week.other))
  })
})

describe('the week boundary', () => {
  test('spend from an earlier week counts toward the job but NOT toward the week', () => {
    const d = buildDigest(base({
      receipts: [
        { project_id: 'j1', amount: 1000, tax_amount: 0, category: 'materials', purchase_date: before },
        { project_id: 'j1', amount: 200, tax_amount: 0, category: 'materials', purchase_date: inside },
      ],
    }))
    expect(d.week.materials).toBe(200)      // this week only
    expect(d.jobs[0].materials).toBe(1200)  // lifetime, matching the job screen
  })

  test('the date on the paper wins over when it was typed in', () => {
    // A receipt bought last week and entered today belongs to last week.
    const d = buildDigest(base({
      receipts: [{ project_id: 'j1', amount: 500, tax_amount: 0, category: 'materials', purchase_date: before, created_at: inside }],
    }))
    expect(d.week.materials).toBe(0)
  })

  test('an old row with no purchase_date falls back to when it was entered', () => {
    const d = buildDigest(base({
      receipts: [{ project_id: 'j1', amount: 500, tax_amount: 0, category: 'materials', created_at: inside }],
    }))
    expect(d.week.materials).toBe(500)
  })

  test('the window is start-inclusive and end-exclusive, so weeks never double-count', () => {
    const d = buildDigest(base({
      receipts: [
        { project_id: 'j1', amount: 10, tax_amount: 0, category: 'materials', purchase_date: WEEK_START },
        { project_id: 'j1', amount: 99, tax_amount: 0, category: 'materials', purchase_date: WEEK_END },
      ],
    }))
    expect(d.week.materials).toBe(10)
  })
})

describe('what the owner is shown', () => {
  test('the seeded demo job never appears in anything', () => {
    const d = buildDigest(base({
      projects: [
        { id: 'j1', name: 'Real job', budget: 10000, stage: 'start' },
        { id: 'demo', name: 'Sample job', budget: 50000, stage: 'start', is_sample: true },
      ],
      receipts: [{ project_id: 'demo', amount: 9999, tax_amount: 0, category: 'materials', purchase_date: inside }],
    }))
    expect(d.jobs).toHaveLength(1)
    expect(d.jobs[0].name).toBe('Real job')
    expect(d.week.materials).toBe(0)
  })

  test('finished jobs drop off the list but their unpaid invoices do not', () => {
    const d = buildDigest(base({
      projects: [
        { id: 'j1', name: 'Running', budget: 10000, stage: 'start' },
        { id: 'j2', name: 'Finished', budget: 8000, stage: 'end' },
      ],
      invoices: [{ project_id: 'j2', amount: 8000, status: 'sent' }],
    }))
    expect(d.jobs.map((j) => j.name)).toEqual(['Running'])
    expect(d.owed).toBe(8000)  // a finished job's money is still owed
  })

  test('only APPROVED change orders raise the contract', () => {
    const d = buildDigest(base({
      changeOrders: [
        { project_id: 'j1', amount: 2000, status: 'approved' },
        { project_id: 'j1', amount: 5000, status: 'pending' },
      ],
    }))
    expect(d.jobs[0].contract).toBe(12000)
  })

  test('the worst job is listed first — that is the one to act on', () => {
    const d = buildDigest(base({
      projects: [
        { id: 'good', name: 'Healthy', budget: 10000, stage: 'start' },
        { id: 'bad', name: 'Bleeding', budget: 10000, stage: 'start' },
      ],
      receipts: [{ project_id: 'bad', amount: 9500, tax_amount: 0, category: 'materials', purchase_date: inside }],
    }))
    expect(d.jobs[0].name).toBe('Bleeding')
    expect(d.attention[0].name).toBe('Bleeding')
  })

  test('a job losing money says so in plain words, not a percentage', () => {
    const d = buildDigest(base({
      receipts: [{ project_id: 'j1', amount: 12000, tax_amount: 0, category: 'materials', purchase_date: inside }],
    }))
    expect(d.jobs[0].profit).toBe(-2000)
    expect(d.attention[0].reason).toMatch(/losing money/)
    expect(d.attention[0].reason).toMatch(/\$2,000/)
  })

  test(`a job at exactly ${THIN_MARGIN}% is not flagged; just under it is`, () => {
    const at = buildDigest(base({
      receipts: [{ project_id: 'j1', amount: 9000, tax_amount: 0, category: 'materials', purchase_date: inside }],
    }))
    expect(at.jobs[0].margin).toBe(10)
    expect(at.attention).toHaveLength(0)

    const under = buildDigest(base({
      receipts: [{ project_id: 'j1', amount: 9200, tax_amount: 0, category: 'materials', purchase_date: inside }],
    }))
    expect(under.jobs[0].margin).toBe(8)
    expect(under.attention).toHaveLength(1)

    // Deliberate: the flag compares the ROUNDED margin, the same number the
    // email prints. A job at a true 9.5% displays "10%" and is not flagged —
    // showing someone "10% margin" next to a warning that it's under 10% is
    // worse than letting one borderline job through.
    const borderline = buildDigest(base({
      receipts: [{ project_id: 'j1', amount: 9050, tax_amount: 0, category: 'materials', purchase_date: inside }],
    }))
    expect(borderline.jobs[0].margin).toBe(10)
    expect(borderline.attention).toHaveLength(0)
  })
})

describe('when not to send at all', () => {
  test('a totally quiet week with nothing outstanding is not worth an email', () => {
    // A digest that says "you did nothing" every week is how a digest gets
    // filtered to spam — and once filtered, it can never be read again.
    const d = buildDigest(base())
    expect(d.hasSomethingToSay).toBe(false)
  })

  test('a quiet week still sends if money is owed', () => {
    const d = buildDigest(base({ invoices: [{ project_id: 'j1', amount: 4000, status: 'sent' }] }))
    expect(d.hasSomethingToSay).toBe(true)
  })

  test('a quiet week still sends if a job is bleeding', () => {
    const d = buildDigest(base({
      receipts: [{ project_id: 'j1', amount: 20000, tax_amount: 0, category: 'materials', purchase_date: before }],
    }))
    expect(d.week.total).toBe(0)
    expect(d.hasSomethingToSay).toBe(true)
  })

  test('an owner with no jobs at all produces an empty, non-throwing digest', () => {
    const d = buildDigest(base({ projects: [] }))
    expect(d.jobs).toEqual([])
    expect(d.totalProfit).toBe(0)
    expect(d.hasSomethingToSay).toBe(false)
  })
})

describe('junk in, no crash out', () => {
  test('nulls, missing fields and unparseable dates are survivable', () => {
    const d = buildDigest(base({
      projects: [{ id: 'j1', budget: null, stage: null }, null],
      receipts: [null, { project_id: 'j1' }, { project_id: 'nope', amount: 5, category: 'materials', purchase_date: inside }],
      timeEntries: [null, { project_id: 'j1', clocked_out_at: 'not-a-date', labor_cost: 50 }],
      changeOrders: [null],
      invoices: [null],
    }))
    expect(d.jobs[0].name).toBe('Untitled job')
    expect(d.jobs[0].contract).toBe(0)
    expect(d.jobs[0].margin).toBe(0)   // never divide by a zero contract
    // A row for a project that isn't this owner's is ignored, not counted.
    expect(d.week.materials).toBe(0)
    // An unparseable clock-out still counts toward the job, just not the week.
    expect(d.jobs[0].labor).toBe(50)
    expect(d.week.labor).toBe(0)
  })
})
