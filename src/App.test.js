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

// The crew-invite screen resolves the token over HTTP before it can render, so
// these tests stand in a fetch. Keyed by URL because that screen makes two very
// different calls: the invite lookup, and a HEAD probe for the optional crew
// video — which must answer with a non-video content type, or the component
// correctly concludes vercel.json's SPA rewrite handed it an HTML page.
let inviteReply = { valid: true, workerName: 'Mike Reyes', companyName: 'First Class Property Services' }
const mockFetch = (url, opts) => {
  if (String(url).includes('/api/resolve-invite')) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve(inviteReply) })
  }
  return Promise.resolve({ ok: false, headers: { get: () => 'text/html' }, json: () => Promise.resolve({}) })
}
beforeEach(() => {
  inviteReply = { valid: true, workerName: 'Mike Reyes', companyName: 'First Class Property Services' }
  global.fetch = jest.fn(mockFetch)
  // A saved crew key changes what the ROOT renders, so it has to be cleared
  // between tests or the landing-page assertions start failing for a reason
  // that has nothing to do with what they're testing.
  localStorage.clear()
})

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

test('a worker invite link reaches the crew screen, not the landing page', async () => {
  // The invite token has to survive the logged-out branch, or the worker lands
  // on marketing copy instead of the screen the text message promised. And what
  // he gets there is the PITCH, not a form: the whole reason crews stalled was
  // being asked for three fields before being told a single reason to care.
  goTo('/?invite=abc123')
  render(<App />)
  expect(await screen.findByText(/put you on the crew/i, {}, ROUTE_LOAD)).toBeInTheDocument()
  expect(screen.getByText(/First Class Property Services/)).toBeInTheDocument()
  // The surveillance objection is what actually kills adoption, so answering it
  // here — before signup, not on a settings page a week later — is load-bearing.
  expect(screen.getByText(/never be disputed/i)).toBeInTheDocument()
  // One tap. If a name, email or password field ever reappears on this screen,
  // the thing that made crews quit is back.
  // eslint-disable-next-line testing-library/no-node-access
  expect(document.querySelectorAll('input')).toHaveLength(0)
})

test('a dead invite link still gives the worker a way in', async () => {
  // Used, revoked, or mistyped are indistinguishable from his seat and all end
  // the same way: ask the boss. Never leave him on a screen with nothing to tap.
  inviteReply = { valid: false, rejoinable: false }
  goTo('/?invite=deadtoken')
  render(<App />)
  expect(await screen.findByText(/link has expired/i, {}, ROUTE_LOAD)).toBeInTheDocument()
  // The LOUD button has to be the boss, not the login form. A crew member has
  // no password, so making "I already have a login" the primary action put him
  // one tap from a login screen he could not pass — the screen in the photo
  // Josh sent on 2026-08-25.
  expect(screen.getByRole('link', { name: /text my boss/i })).toBeInTheDocument()
  // The sign-in door still exists for the rare worker who really does have
  // credentials. It just is not the thing being pushed.
  expect(screen.getByRole('button', { name: /email and password/i })).toBeInTheDocument()
})

// --- The passwordless crew member's way back in ----------------------------
// A crew account has no password and no reachable email, so a saved invite token
// is the only thing that can re-authenticate one. These two pin the behaviour
// that makes a home-screen icon worth installing: tapping it when the session
// has expired lands on "welcome back", not on marketing copy aimed at his boss.

test('a saved crew key turns the root into a one-tap way back in', async () => {
  localStorage.setItem('jt_crew_key', 'saved-token')
  inviteReply = { valid: false, rejoinable: true, workerName: 'Mike Reyes', companyName: 'First Class Property Services' }
  goTo('/')
  render(<App />)
  expect(await screen.findByText(/still on the/i, {}, ROUTE_LOAD)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /get me back in/i })).toBeInTheDocument()
  expect(screen.queryByText(/Know what every job really makes/i)).not.toBeInTheDocument()
})

test('a revoked crew key is thrown away instead of stranding him', async () => {
  // Otherwise his home-screen icon opens on "expired" forever, with no route
  // back to the rest of the site.
  localStorage.setItem('jt_crew_key', 'revoked-token')
  inviteReply = { valid: false, rejoinable: false, revoked: true }
  goTo('/')
  render(<App />)
  expect(await screen.findByText(/Know what every job really makes/i, {}, ROUTE_LOAD)).toBeInTheDocument()
  expect(localStorage.getItem('jt_crew_key')).toBeNull()
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
