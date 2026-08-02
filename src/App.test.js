import { render, screen } from '@testing-library/react'
import App from './App'

// Mock the Supabase client so this smoke test never touches the network.
// Plain functions (not jest.fn().mockResolvedValue) keep this robust across
// jest versions — getSession must return a real thenable.
//
// Two things this mock has to get right, both of which it used to get wrong:
//
// 1. onAuthStateChange is what clears the loading state. App dropped its
//    separate getSession() call because the real client fires INITIAL_SESSION
//    immediately with the stored session (or null). A mock that only returns
//    the subscription and never invokes the callback leaves the app stuck on
//    "Loading JobTally..." forever.
// 2. from() has to be a chainable thenable. Landing queries testimonials with
//    .select().eq().order().limit().then(...), so a two-link chain throws a
//    TypeError inside an effect and takes the render down with it.
const query = () => {
  const q = {
    select: () => q, eq: () => q, order: () => q, limit: () => q,
    maybeSingle: () => Promise.resolve({ data: null }),
    then: (resolve) => Promise.resolve({ data: [], error: null }).then(resolve),
  }
  return q
}

jest.mock('./supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: (cb) => {
        setTimeout(() => cb('INITIAL_SESSION', null), 0)
        return { data: { subscription: { unsubscribe: () => {} } } }
      },
      signInWithPassword: () => Promise.resolve({ error: null }),
      signUp: () => Promise.resolve({ data: { session: null, user: null }, error: null }),
      signOut: () => Promise.resolve({ error: null }),
    },
    from: () => query(),
  },
}))

// jsdom's location can't be assigned, but history.pushState moves it fine.
const goTo = (path) => window.history.pushState({}, '', path)

beforeEach(() => goTo('/'))

test('a logged-out visitor at the root gets the public landing page', async () => {
  render(<App />)
  expect(await screen.findByText(/Know what every job really makes/i)).toBeInTheDocument()
})

test('a logged-out visitor at /login gets the login screen', async () => {
  goTo('/login')
  render(<App />)
  expect(await screen.findByText(/Contractor job tracking/i)).toBeInTheDocument()
})

test('a worker invite link reaches the login screen, not the landing page', async () => {
  // The invite token has to survive the logged-out branch or the worker lands
  // on marketing copy instead of the signup form the text message promised.
  goTo('/?invite=abc123')
  render(<App />)
  expect(await screen.findByText(/Contractor job tracking/i)).toBeInTheDocument()
})
