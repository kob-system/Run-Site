import React from 'react'
import { render, screen } from '@testing-library/react'
import Billing from './Billing'

// The money screen. These tests exist because it is the one screen nobody sees
// while developing — it lives behind a login and behind an already-used free
// job — so a regression here is invisible until it costs a sale.
jest.mock('../supabaseClient', () => ({ supabase: { auth: { getSession: jest.fn(), signOut: jest.fn() }, from: jest.fn() } }))
jest.mock('../utils/analytics', () => ({
  track: jest.fn(),
  trackOnce: jest.fn(),
  EV: { PAYWALL_HIT: 'paywall_hit', CHECKOUT_STARTED: 'checkout_started' },
}))

const profile = { email: 'mike@example.com' }

describe('paywall, no subscription', () => {
  it('leads with one price and one button', () => {
    render(<Billing profile={profile} sub={null} mode="paywall" />)
    expect(screen.getByText('$150')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^subscribe$/i })).toBeInTheDocument()
  })

  it('says the wallets out loud, because that is the friction it removes', () => {
    render(<Billing profile={profile} sub={null} mode="paywall" />)
    expect(screen.getByText(/apple pay/i)).toBeInTheDocument()
    expect(screen.getByText(/google pay/i)).toBeInTheDocument()
  })

  it('offers yearly without giving it equal weight', () => {
    render(<Billing profile={profile} sub={null} mode="paywall" />)
    expect(screen.getByRole('button', { name: /pay yearly instead/i })).toBeInTheDocument()
  })

  it('keeps the export and the extras out of the way until asked', () => {
    render(<Billing profile={profile} sub={null} mode="paywall" />)
    expect(screen.queryByRole('button', { name: /export all my data/i })).toBeNull()
  })
})

describe('active subscriber', () => {
  it('is never pitched the plan again', () => {
    render(<Billing profile={profile} sub={{ status: 'active', current_period_end: '2026-09-28T00:00:00Z' }} mode="manage" />)
    expect(screen.queryByRole('button', { name: /^subscribe$/i })).toBeNull()
    expect(screen.getByRole('button', { name: /manage billing/i })).toBeInTheDocument()
  })

  // 'comp' is a grandfathered/free grant. Pitching checkout at a comp'd owner
  // lets them start a paid subscription the webhook then writes over the top of.
  it('treats a comp grant like an active subscription', () => {
    render(<Billing profile={profile} sub={{ status: 'comp' }} mode="paywall" />)
    expect(screen.queryByRole('button', { name: /^subscribe$/i })).toBeNull()
  })

  it('says plainly when a card failed, and that nothing shut off', () => {
    render(<Billing profile={profile} sub={{ status: 'past_due' }} mode="manage" />)
    expect(screen.getByText(/didn’t go through/i)).toBeInTheDocument()
    expect(screen.getByText(/nothing has shut off/i)).toBeInTheDocument()
  })
})
