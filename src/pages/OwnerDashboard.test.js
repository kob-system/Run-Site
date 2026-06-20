import { render, screen, fireEvent } from '@testing-library/react'
import OwnerDashboard from './OwnerDashboard'

// Chainable Supabase mock: every query-builder method returns a thenable that
// resolves to an empty result, so the dashboard's mount-time fetches no-op and
// the component renders against empty data. This lets us mount the real
// OwnerDashboard in jsdom — the only way to catch the temporal-dead-zone
// white-screens this codebase has hit before (a passing build does NOT).
jest.mock('../supabaseClient', () => {
  const result = { data: [], error: null }
  const makeBuilder = () => {
    const builder = { then: (resolve) => resolve(result) }
    ;['select', 'eq', 'neq', 'in', 'not', 'gte', 'lte', 'order', 'limit', 'range', 'single', 'maybeSingle', 'insert', 'update', 'delete', 'upsert']
      .forEach((m) => { builder[m] = () => makeBuilder() })
    return builder
  }
  return {
    supabase: {
      from: () => makeBuilder(),
      storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: null, error: null }), upload: () => Promise.resolve({ error: null }) }) },
      auth: { signOut: () => Promise.resolve({ error: null }) },
    },
  }
})

const newOwner = { id: 'owner-1', role: 'owner', full_name: 'Test Owner', created_at: new Date().toISOString() }

beforeEach(() => localStorage.clear())

test('renders for a brand-new account without white-screening, showing the exposure tour', async () => {
  render(<OwnerDashboard profile={newOwner} />)
  // The tour is the first thing a new owner sees. Assert via the step
  // descriptions, which are unique to the card (the labels Jobs/Estimates/etc.
  // also appear as top-nav tabs).
  expect(await screen.findByText(/Take the tour/i)).toBeInTheDocument()
  expect(screen.getByText(/Every project, budget, and photo/i)).toBeInTheDocument()
  expect(screen.getByText(/Quote new work and win it/i)).toBeInTheDocument()
  expect(screen.getByText(/track who still owes you/i)).toBeInTheDocument()
  expect(screen.getByText(/crew, their rates, and their hours/i)).toBeInTheDocument()
  expect(screen.getByText('Scan a receipt')).toBeInTheDocument()
  expect(screen.getByText(/Open any job/i)).toBeInTheDocument()
  expect(screen.getByText(/0 of 5 seen/i)).toBeInTheDocument()
})

test('does not show the tour to established accounts (created > 14 days ago)', async () => {
  render(<OwnerDashboard profile={{ ...newOwner, created_at: '2020-01-01T00:00:00Z' }} />)
  // Home still renders (the dark "Owed to you" card always shows)...
  expect(await screen.findByText(/Owed to you/i)).toBeInTheDocument()
  // ...but the onboarding tour is gated out for non-new accounts.
  expect(screen.queryByText(/Take the tour/i)).not.toBeInTheDocument()
})

test('visiting a section checks its step off — exposure, not data entry', async () => {
  render(<OwnerDashboard profile={newOwner} />)
  await screen.findByText(/Take the tour/i)
  // Navigate via the top nav (exact name matches the nav button, not the tour
  // step, whose accessible name also includes its description).
  fireEvent.click(screen.getByRole('button', { name: 'Estimates' }))
  fireEvent.click(screen.getByRole('button', { name: 'Home' }))
  // Back on Home, the tour now reflects one section seen — with zero data created.
  expect(await screen.findByText(/1 of 5 seen/i)).toBeInTheDocument()
})

test('Hide dismisses the tour and persists the choice per user', async () => {
  const { unmount } = render(<OwnerDashboard profile={newOwner} />)
  fireEvent.click(await screen.findByText('Hide'))
  expect(screen.queryByText(/Take the tour/i)).not.toBeInTheDocument()
  // Remounting (e.g. a page reload) keeps it hidden via localStorage.
  unmount()
  render(<OwnerDashboard profile={newOwner} />)
  expect(await screen.findByText(/Owed to you/i)).toBeInTheDocument()
  expect(screen.queryByText(/Take the tour/i)).not.toBeInTheDocument()
})
