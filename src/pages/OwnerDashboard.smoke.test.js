import React from 'react'
import { render, screen } from '@testing-library/react'
import OwnerDashboard from './OwnerDashboard'

// WHY THIS FILE EXISTS.
//
// On 2026-08-30 the three-door rebuild shipped to production with `useRef`
// used in this file and never imported. It compiled clean. All 189 tests
// passed. Webpack does not resolve free variables, so the ReferenceError only
// happened when a real owner opened the app — and every one of them got
// "Something went wrong" and a dead screen.
//
// 189 tests passed because NOT ONE OF THEM EVER RENDERED THIS COMPONENT. The
// owner dashboard is the single biggest screen in the app and it had zero
// render coverage. That is the hole this closes.
//
// This is deliberately a SMOKE test, not a feature test. It does not assert on
// business logic — the point is only that the component mounts and paints
// without throwing. That is the exact class of failure that got through, and a
// test that mounts it will catch the next missing import, the next dead-zone
// reference, and the next typo'd hook, on every single run.
//
// Keep it cheap and keep it dependency-free so it never gets skipped.

jest.mock('../supabaseClient', () => {
  // Every query resolves empty. A chainable stub, because this component builds
  // long .from().select().eq().order() chains and any of them may be awaited.
  const chain = () => {
    const p = Promise.resolve({ data: [], error: null })
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
  return {
    supabase: {
      auth: {
        getSession: jest.fn().mockResolvedValue({ data: { session: null } }),
        signOut: jest.fn().mockResolvedValue({}),
      },
      from: jest.fn(() => chain()),
      rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
      storage: {
        from: jest.fn(() => ({
          upload: jest.fn().mockResolvedValue({ error: null }),
          createSignedUrl: jest.fn().mockResolvedValue({ data: null }),
          createSignedUrls: jest.fn().mockResolvedValue({ data: [] }),
        })),
      },
    },
  }
})

jest.mock('../utils/analytics', () => ({
  track: jest.fn(),
  trackOnce: jest.fn(),
  EV: new Proxy({}, { get: (_t, k) => String(k) }),
}))

const profile = {
  id: 'owner-1',
  email: 'mike@example.com',
  full_name: 'Mike Reynolds',
  company_name: 'Reynolds Contracting',
  role: 'owner',
}
const sub = { status: 'active' }

describe('OwnerDashboard mounts', () => {
  // The bug that motivated this file would have failed exactly here, with
  // "useRef is not defined", before a single assertion ran.
  it('renders the home screen without throwing', () => {
    expect(() => render(<OwnerDashboard profile={profile} sub={sub} billingEnforced={false} />))
      .not.toThrow()
  })

  it('paints the bottom bar, including the Ask orb', async () => {
    render(<OwnerDashboard profile={profile} sub={sub} billingEnforced={false} />)
    expect(await screen.findByRole('button', { name: /ask jobtally/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^home$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^jobs$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^crew$/i })).toBeInTheDocument()
  })

  // The orb is the mic now. If the press-and-hold wiring throws on mount, or
  // the label regresses to something that does not say it can be held, the
  // whole voice path is gone and nothing else would tell us.
  it('says the Ask orb can be held, because holding it is what records', async () => {
    render(<OwnerDashboard profile={profile} sub={sub} billingEnforced={false} />)
    const orb = await screen.findByRole('button', { name: /hold to talk/i })
    expect(orb).toBeInTheDocument()
  })
})
