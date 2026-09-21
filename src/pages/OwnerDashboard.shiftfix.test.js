import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import OwnerDashboard from './OwnerDashboard'

// The owner fixing a shift, and the profit card on a brand-new job, rendered
// the way an owner meets them. Same mock shape as the smoke test, except each
// table answers with its own rows: one worker, one new $13,500 job with
// nothing spent, and one shift that was never clocked out.

jest.mock('../supabaseClient', () => {
  const rows = {
    profiles: [{ id: 'w1', full_name: 'Mike Reyes', role: 'worker', owner_id: 'owner-1', hourly_rate: 20 }],
    projects: [{
      id: 'p1', owner_id: 'owner-1', name: 'Kitchen remodel', client_name: 'Smith',
      budget: 13500, materials_budget: 6000, labor_budget: 4800, profit_target: 2700,
      stage: 'start', created_at: '2026-09-01T12:00:00Z',
    }],
    time_entries: [{
      id: 't1', worker_id: 'w1', project_id: 'p1',
      // Clocked in two hours ago and still going.
      clocked_in_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      clocked_out_at: null, total_minutes: null, labor_cost: null,
      profiles: { full_name: 'Mike Reyes' },
    }],
  }
  const chain = (table) => {
    const p = Promise.resolve({ data: rows[table] || [], error: null })
    const handler = {
      get: (_t, prop) => {
        if (prop === 'then') return p.then.bind(p)
        if (prop === 'catch') return p.catch.bind(p)
        if (prop === 'finally') return p.finally.bind(p)
        return () => new Proxy({}, handler)
      },
    }
    return new Proxy({}, handler)
  }
  // Plain functions, not jest.fn(impl): CRA runs with resetMocks on, which
  // wipes a jest.fn's implementation before every test and would quietly turn
  // every query into undefined.
  const ok = (value) => () => Promise.resolve(value)
  return {
    supabase: {
      auth: {
        getSession: ok({ data: { session: null } }),
        signOut: ok({}),
      },
      from: (table) => chain(table),
      rpc: ok({ data: null, error: null }),
      storage: {
        from: () => ({
          upload: ok({ error: null }),
          createSignedUrl: ok({ data: null }),
          createSignedUrls: ok({ data: [] }),
        }),
      },
    },
  }
})

jest.mock('../utils/analytics', () => ({
  track: () => {},
  trackOnce: () => {},
  EV: new Proxy({}, { get: (_t, k) => String(k) }),
}))

const profile = { id: 'owner-1', email: 'mike@example.com', full_name: 'Dave Owner', company_name: 'Owner Co', role: 'owner' }
const sub = { status: 'active' }
const mount = () => render(<OwnerDashboard profile={profile} sub={sub} billingEnforced={false} />)

describe('owner fixes a shift', () => {
  it('Home shows who is still clocked in, and one tap opens the clock-out sheet', async () => {
    mount()
    expect(await screen.findByText(/1 on the clock right now/)).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: /Mike Reyes.*Clock out/ }))
    expect(await screen.findByRole('heading', { name: 'Clock Mike out' })).toBeInTheDocument()
    expect(screen.getAllByText(/Still on the clock since/).length).toBeGreaterThan(0)
    // Clock-out starts at right now, so the preview is about two hours.
    expect(screen.getByText(/^(1h 59m|2h 0m|2h 1m) · about \$/)).toBeInTheDocument()
  })

  it('refuses a clock-out before the clock-in, in plain words', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: /Mike Reyes.*Clock out/ }))
    await screen.findByRole('heading', { name: 'Clock Mike out' })
    const inDay = screen.getByLabelText('Clock-in day').value
    fireEvent.change(screen.getByLabelText('Clock-out day'), { target: { value: inDay } })
    fireEvent.change(screen.getByLabelText('Clock-in time'), { target: { value: '07:00' } })
    fireEvent.change(screen.getByLabelText('Clock-out time'), { target: { value: '06:00' } })
    expect(screen.getByText('Clock-out has to be after clock-in.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clock him out' })).toBeDisabled()
  })

  it('refuses a shift over 24 hours', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: /Mike Reyes.*Clock out/ }))
    await screen.findByRole('heading', { name: 'Clock Mike out' })
    fireEvent.change(screen.getByLabelText('Clock-in day'), { target: { value: '2026-09-01' } })
    fireEvent.change(screen.getByLabelText('Clock-in time'), { target: { value: '07:00' } })
    fireEvent.change(screen.getByLabelText('Clock-out day'), { target: { value: '2026-09-02' } })
    fireEvent.change(screen.getByLabelText('Clock-out time'), { target: { value: '09:00' } })
    expect(screen.getByText(/more than 24 hours/)).toBeInTheDocument()
  })

  it('delete asks first, and Keep it backs out', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: /Mike Reyes.*Clock out/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete this shift' }))
    expect(await screen.findByRole('heading', { name: 'Delete this shift?' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Yes, delete it' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }))
    expect(await screen.findByRole('heading', { name: 'Clock Mike out' })).toBeInTheDocument()
  })
})

describe('profit card on a new job', () => {
  it('shows the owner target with no costs, never the whole contract as profit', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: /^jobs$/i }))
    const title = (await screen.findAllByText('Kitchen remodel')).find(el => el.tagName === 'H3')
    fireEvent.click(title)
    expect(await screen.findByText('Target profit')).toBeInTheDocument()
    expect(screen.getByText('$2,700.00')).toBeInTheDocument()
    expect(screen.getByText('No costs logged yet')).toBeInTheDocument()
    // The contract only appears inside the "of the contract" line now, never
    // as a number of its own pretending to be profit.
    expect(screen.queryByText('$13,500.00')).toBeNull()
    expect(screen.getByText(/20% of the \$13,500\.00 contract/)).toBeInTheDocument()
    expect(screen.queryByText(/Projected Profit/i)).toBeNull()
    expect(screen.queryByText(/100% margin/)).toBeNull()
  })

  it('the Labor card says who is still on the clock, with the button that ends it', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: /^jobs$/i }))
    fireEvent.click((await screen.findAllByText('Kitchen remodel')).find(el => el.tagName === 'H3'))
    expect(await screen.findByText(/Still on the clock since/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clock him out' }))
    expect(await screen.findByRole('heading', { name: 'Clock Mike out' })).toBeInTheDocument()
  })
})
