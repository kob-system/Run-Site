import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import App from '../App'

// Password reset is auth-critical and every failure mode here was live at once:
// the link pointed at localhost, no screen existed to land on, and Hotmail's
// link scanner burned the one-time token before the human clicked. These tests
// pin the behaviour that fixes each of those.

// Recorded so each test can assert what actually hit Supabase. These have to be
// `mock*`-prefixed — jest.mock is hoisted above them, so it only permits
// out-of-scope names matching that prefix.
const mockCalls = { verifyOtp: [], updateUser: [], resetPasswordForEmail: [] }
// Per-test knobs.
let mockSession = null
let mockVerifyOtpResult = { data: {}, error: null }
let mockUpdateUserResult = { data: {}, error: null }

const query = () => {
  const q = {
    select: () => q, eq: () => q, order: () => q, limit: () => q,
    maybeSingle: () => Promise.resolve({ data: null }),
    then: (resolve) => Promise.resolve({ data: [], error: null }).then(resolve),
  }
  return q
}

jest.mock('../supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: mockSession } }),
      onAuthStateChange: (cb) => {
        setTimeout(() => cb('INITIAL_SESSION', mockSession), 0)
        return { data: { subscription: { unsubscribe: () => {} } } }
      },
      verifyOtp: (args) => { mockCalls.verifyOtp.push(args); return Promise.resolve(mockVerifyOtpResult) },
      updateUser: (args) => { mockCalls.updateUser.push(args); return Promise.resolve(mockUpdateUserResult) },
      resetPasswordForEmail: (email, opts) => {
        mockCalls.resetPasswordForEmail.push({ email, opts })
        return Promise.resolve({ data: {}, error: null })
      },
      signOut: () => Promise.resolve({ error: null }),
    },
    from: () => query(),
  },
}))

const goTo = (url) => window.history.pushState({}, '', url)
// Every screen in App.js is React.lazy, so each render waits on a dynamic
// import behind Suspense. Jest's 5s default is not enough once the whole suite
// is running in parallel on a loaded machine, and the per-query timeout has to
// stay under the per-test one or the test dies before the query gives up.
jest.setTimeout(30000)
const ROUTE_LOAD = { timeout: 15000 }

// The link our branded email sends.
const LIVE_LINK = '/reset-password?token_hash=tok_abc123&type=recovery'
// Copied verbatim from the real failure. Note there's no type=recovery on it.
const DEAD_LINK = '/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired&sb='

beforeEach(() => {
  mockCalls.verifyOtp = []
  mockCalls.updateUser = []
  mockCalls.resetPasswordForEmail = []
  mockSession = null
  mockVerifyOtpResult = { data: {}, error: null }
  mockUpdateUserResult = { data: {}, error: null }
  goTo('/')
})

// Exact label strings, not regexes — /New Password/i also matches the confirm
// field's label.
const fillNewPassword = (pw, confirmPw = pw) => {
  fireEvent.change(screen.getByLabelText('New Password'), { target: { value: pw } })
  fireEvent.change(screen.getByLabelText('Confirm New Password'), { target: { value: confirmPw } })
}

test('a recovery link renders the reset form, not the landing page', async () => {
  goTo(LIVE_LINK)
  render(<App />)
  expect(await screen.findByText(/Set a new password/i, {}, ROUTE_LOAD)).toBeInTheDocument()
})

// The whole point of the token_hash flow: Outlook/Hotmail Safe Links GETs the
// URL before the human does. If loading the page redeemed the token, the
// scanner would burn it and the user would get otp_expired every single time.
test('loading the page does not redeem the one-time token', async () => {
  goTo(LIVE_LINK)
  render(<App />)
  await screen.findByText(/Set a new password/i, {}, ROUTE_LOAD)
  expect(mockCalls.verifyOtp).toHaveLength(0)
})

test('submitting redeems the token and then sets the password', async () => {
  goTo(LIVE_LINK)
  render(<App />)
  await screen.findByText(/Set a new password/i, {}, ROUTE_LOAD)

  fillNewPassword('newpass123')
  fireEvent.click(screen.getByRole('button', { name: /Save new password/i }))

  await screen.findByText(/Password updated/i, {}, ROUTE_LOAD)
  expect(mockCalls.verifyOtp).toEqual([{ token_hash: 'tok_abc123', type: 'recovery' }])
  expect(mockCalls.updateUser).toEqual([{ password: 'newpass123' }])
})

// Stripping the spent token is what keeps a back-button or a shared screenshot
// from replaying it. It also used to break the screen: App decided the recovery
// branch by re-reading the URL on every render, so clearing it flipped the
// branch and dumped the user on the marketing landing page the instant the
// reset succeeded. App now latches recovery mode at mount.
test('the used token is stripped from the address bar, and the confirmation survives it', async () => {
  goTo(LIVE_LINK)
  const { rerender } = render(<App />)
  await screen.findByText(/Set a new password/i, {}, ROUTE_LOAD)

  fillNewPassword('newpass123')
  fireEvent.click(screen.getByRole('button', { name: /Save new password/i }))

  await screen.findByText(/Password updated/i, {}, ROUTE_LOAD)
  expect(window.location.search).toBe('')
  expect(window.location.pathname).toBe('/')

  // Any re-render after the strip — and there is always one, because verifyOtp
  // signs you in for real and the auth listener fires — used to blow the
  // confirmation away and render marketing copy instead.
  rerender(<App />)
  expect(await screen.findByText(/Password updated/i)).toBeInTheDocument()
  expect(screen.queryByText(/Know what every job really makes/i)).not.toBeInTheDocument()
})

test('mismatched passwords are caught before anything hits the network', async () => {
  goTo(LIVE_LINK)
  render(<App />)
  await screen.findByText(/Set a new password/i, {}, ROUTE_LOAD)

  fillNewPassword('newpass123', 'newpass124')
  fireEvent.click(screen.getByRole('button', { name: /Save new password/i }))

  expect(await screen.findByText(/don't match/i)).toBeInTheDocument()
  expect(mockCalls.verifyOtp).toHaveLength(0)
  expect(mockCalls.updateUser).toHaveLength(0)
})

// The exact URL a dead link produces. It used to dump the user on marketing
// copy with a raw error string in the address bar and no way forward.
test('an expired link offers a fresh one instead of dead-ending', async () => {
  goTo(DEAD_LINK)
  render(<App />)
  expect(await screen.findByText(/Get a new reset link/i, {}, ROUTE_LOAD)).toBeInTheDocument()
  expect(screen.getByText(/expired or was already used/i)).toBeInTheDocument()
})

test('the resend sends people back to /reset-password, never to the app root', async () => {
  goTo(DEAD_LINK)
  render(<App />)
  await screen.findByText(/Get a new reset link/i, {}, ROUTE_LOAD)

  fireEvent.change(screen.getByLabelText(/Your Email/i), { target: { value: 'jp@example.com' } })
  fireEvent.click(screen.getByRole('button', { name: /Send me a new link/i }))

  await waitFor(() => expect(mockCalls.resetPasswordForEmail).toHaveLength(1))
  expect(mockCalls.resetPasswordForEmail[0].email).toBe('jp@example.com')
  // A recovery link pointed at the root just signs you in and leaves the old
  // password in place — the original bug. It has to land on the reset screen.
  expect(mockCalls.resetPasswordForEmail[0].opts.redirectTo).toMatch(/\/reset-password$/)
})

// The legacy implicit link signs the user in as the page loads. If App.js
// checked the session before the recovery branch, they'd be bounced to the
// dashboard and would never get to change the password they came to change.
test('recovery beats an active session', async () => {
  mockSession = { user: { id: 'u1', email: 'jp@example.com' } }
  goTo(LIVE_LINK)
  render(<App />)
  expect(await screen.findByText(/Set a new password/i, {}, ROUTE_LOAD)).toBeInTheDocument()
})

test('a token rejected at submit time falls through to the resend path', async () => {
  mockVerifyOtpResult = { data: {}, error: { code: 'otp_expired', message: 'Token has expired' } }
  goTo(LIVE_LINK)
  render(<App />)
  await screen.findByText(/Set a new password/i, {}, ROUTE_LOAD)

  fillNewPassword('newpass123')
  fireEvent.click(screen.getByRole('button', { name: /Save new password/i }))

  expect(await screen.findByText(/Get a new reset link/i, {}, ROUTE_LOAD)).toBeInTheDocument()
  expect(mockCalls.updateUser).toHaveLength(0)
})
