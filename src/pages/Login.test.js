import React from 'react'
import { render, screen } from '@testing-library/react'
import Login from './Login'

// Guards the thing that keeps costing real money when it regresses: SIGNUP IS
// ONE SCREEN. It was five "Next" taps until 2026-08-28. If someone re-splits
// it, two things break at once — a contractor gives up four screens in, and no
// password manager will ever offer to save the account, because a browser only
// offers when the username field and the new-password field are in the DOM
// together. That is also why the email box carries name="username".
jest.mock('../supabaseClient', () => ({
  supabase: { auth: { resend: jest.fn(), resetPasswordForEmail: jest.fn() } },
  getStaySignedIn: () => true,
  setStaySignedIn: jest.fn(),
}))
jest.mock('../utils/attribution', () => ({ getAttribution: () => null, saveSignupAttribution: jest.fn() }))
jest.mock('../utils/welcome', () => ({ sendWelcomeEmail: jest.fn() }))
jest.mock('../buildInfo.json', () => ({ sha: 'test', time: 'test' }), { virtual: true })

function renderSignup() {
  window.history.replaceState({}, '', '/login?signup=1')
  return render(<Login />)
}

describe('owner signup', () => {
  it('puts every field on one screen, with no Next button', () => {
    renderSignup()
    expect(screen.getByLabelText(/your name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/company name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/your email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/choose a password/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /create my account/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^next$/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^back$/i })).toBeNull()
  })

  it('gives the password manager a username field beside the new password', () => {
    const { container } = renderSignup()
    const user = container.querySelector('input[autocomplete="username"]')
    const pw = container.querySelector('input[autocomplete="new-password"]')
    expect(user).not.toBeNull()
    expect(pw).not.toBeNull()
    // Same <form>, or the browser will not offer to save it.
    expect(user.closest('form')).toBe(pw.closest('form'))
    // And the username must be the REAL, typeable email box — not the hidden
    // read-only decoy the five-step flow needed.
    expect(user.readOnly).toBe(false)
    expect(user.getAttribute('type')).toBe('email')
  })
})

describe('sign in', () => {
  it('is one screen with both fields, for the same reason', () => {
    window.history.replaceState({}, '', '/login')
    const { container } = render(<Login />)
    const user = container.querySelector('input[autocomplete="username"]')
    const pw = container.querySelector('input[autocomplete="current-password"]')
    expect(user).not.toBeNull()
    expect(pw).not.toBeNull()
    expect(user.closest('form')).toBe(pw.closest('form'))
  })
})
