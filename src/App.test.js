import { render, screen } from '@testing-library/react'
import App from './App'

// Mock the Supabase client so this smoke test never touches the network.
// Plain functions (not jest.fn().mockResolvedValue) keep this robust across
// jest versions — getSession must return a real thenable.
jest.mock('./supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signInWithPassword: () => Promise.resolve({ error: null }),
      signUp: () => Promise.resolve({ data: { session: null, user: null }, error: null }),
      signOut: () => Promise.resolve({ error: null }),
    },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }),
    }),
  },
}))

test('shows the login screen when there is no session', async () => {
  render(<App />)
  // App starts on "Loading...", then resolves getSession(null) and renders Login.
  expect(await screen.findByText(/Contractor job tracking/i)).toBeInTheDocument()
})
