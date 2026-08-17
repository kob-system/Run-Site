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

// Every route in App.js is React.lazy, so each of these tests has to wait for a
// dynamic import to resolve behind Suspense. The default findBy timeout is 1s,
// which is plenty on an idle machine and NOT plenty when Jest is running every
// suite in parallel on a loaded laptop — that flaked as soon as the suite count
// grew. The assertions are unchanged; they're just allowed to take longer.
const ROUTE_LOAD = { timeout: 15000 }

beforeEach(() => goTo('/'))

test('a logged-out visitor at the root gets the public landing page', async () => {
  render(<App />)
  expect(await screen.findByText(/Know what every job really makes/i, {}, ROUTE_LOAD)).toBeInTheDocument()
})

test('a logged-out visitor at /login gets the login screen', async () => {
  goTo('/login')
  render(<App />)
  expect(await screen.findByText(/Contractor job tracking/i, {}, ROUTE_LOAD)).toBeInTheDocument()
})

test('a worker invite link reaches the login screen, not the landing page', async () => {
  // The invite token has to survive the logged-out branch or the worker lands
  // on marketing copy instead of the signup form the text message promised.
  goTo('/?invite=abc123')
  render(<App />)
  expect(await screen.findByText(/Contractor job tracking/i, {}, ROUTE_LOAD)).toBeInTheDocument()
})

// --- Routing: the landing page belongs at the ROOT and nowhere else ---------
// Before 2026-08-17 the landing page was App's catch-all, so vercel.json's SPA
// rewrite turned every unknown path into a 200-with-marketing-page "soft 404".
// These three pin the fix. If the first one ever goes green while asserting
// landing copy, the SEO regression is back.

test('an unknown path gets a real not-found page, NOT the landing page', async () => {
  goTo('/some-old-link-that-no-longer-exists')
  render(<App />)
  expect(await screen.findByText(/That page isn't here/i, {}, ROUTE_LOAD)).toBeInTheDocument()
  expect(screen.queryByText(/Know what every job really makes/i)).not.toBeInTheDocument()
})

test('the not-found page tells search engines not to index it', async () => {
  // The noindex tag is the half of the fix that search engines actually read;
  // the human-facing copy is the half a person reads. Both have to be there.
  goTo('/nope-not-a-page')
  render(<App />)
  await screen.findByText(/That page isn't here/i, {}, ROUTE_LOAD)
  // A <meta> tag in <head> is not user-visible UI, so Testing Library has no
  // query for it. The noindex tag is the entire point of this test, so reaching
  // for it directly is the only way to assert it exists.
  // eslint-disable-next-line testing-library/no-node-access
  const tag = document.head.querySelector('meta[name="robots"]')
  expect(tag).not.toBeNull()
  expect(tag.getAttribute('content')).toMatch(/noindex/)
})

test('/demo renders the public walkthrough without touching an account', async () => {
  goTo('/demo')
  render(<App />)
  expect(await screen.findByText(/Have a poke around/i, {}, ROUTE_LOAD)).toBeInTheDocument()
  // The demo must be visibly a sample, so nobody mistakes it for their own data.
  expect(screen.getByText(/SAMPLE/)).toBeInTheDocument()
})

test('a trailing slash still reaches the root landing page', async () => {
  // '/'.replace(/\/+$/,'') is '' — without the `|| '/'` fallback in App.js the
  // root itself would fall through to the not-found branch. That would have
  // taken the entire marketing site down, so it gets its own test.
  goTo('/')
  render(<App />)
  expect(await screen.findByText(/Know what every job really makes/i, {}, ROUTE_LOAD)).toBeInTheDocument()
})
