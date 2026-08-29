import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import Login from './Login'

// SIGN-UP IS THREE QUESTIONS: name, email, password. One at a time, on JP's
// call. These tests pin the two things that make that safe rather than costly:
//
//   1. The list stays at THREE. Every question added here is asked of every
//      contractor forever. "Worker or owner" and "company name" were both
//      removed because neither one is needed to make an account work.
//   2. The password step still carries a hidden username field. Without it no
//      password manager offers to save, and every future sign-in gets typed by
//      hand — which is exactly the pain this app already had once.
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
const next = () => fireEvent.click(screen.getByRole('button', { name: /^next$/i }))
const type = (el, value) => fireEvent.change(el, { target: { value } })

describe('owner signup', () => {
  it('opens on the name, alone, at step 1 of 3', () => {
    renderSignup()
    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument()
    expect(screen.getByLabelText(/what's your name/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/email/i)).toBeNull()
    expect(screen.queryByLabelText(/password/i)).toBeNull()
  })

  it('never asks for a company name or which kind of person they are', () => {
    renderSignup()
    // Both were real questions on this form. Neither is needed to make an
    // account, and every one of them is asked of every contractor forever.
    expect(screen.queryByText(/company/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /worker/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /contractor \/ owner/i })).toBeNull()
  })

  it('walks name to email to password, and the last button creates the account', () => {
    renderSignup()
    type(screen.getByLabelText(/what's your name/i), 'Mike Reynolds')
    next()

    expect(screen.getByText('Step 2 of 3')).toBeInTheDocument()
    type(screen.getByLabelText(/what's your email/i), 'mike@example.com')
    next()

    expect(screen.getByText('Step 3 of 3')).toBeInTheDocument()
    expect(screen.getByLabelText(/choose a password/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /create my account/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^next$/i })).toBeNull()
  })

  it('will not move on from a name that is blank or an email that is not one', () => {
    renderSignup()
    next()
    expect(screen.getByText(/please enter your name/i)).toBeInTheDocument()
    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument()

    type(screen.getByLabelText(/what's your name/i), 'Mike Reynolds')
    next()
    type(screen.getByLabelText(/what's your email/i), 'not-an-email')
    next()
    expect(screen.getByText(/valid email/i)).toBeInTheDocument()
    expect(screen.getByText('Step 2 of 3')).toBeInTheDocument()
  })

  it('carries the email onto the password step so it can be saved', () => {
    const { container } = renderSignup()
    type(screen.getByLabelText(/what's your name/i), 'Mike Reynolds')
    next()
    type(screen.getByLabelText(/what's your email/i), 'mike@example.com')
    next()

    const user = container.querySelector('input[autocomplete="username"]')
    const pw = container.querySelector('input[autocomplete="new-password"]')
    expect(user).not.toBeNull()
    expect(pw).not.toBeNull()
    // Same form, and carrying the real address — that pair is what makes the
    // browser offer "Save password?".
    expect(user.closest('form')).toBe(pw.closest('form'))
    expect(user.value).toBe('mike@example.com')
  })

  it('lets them go back and change an answer', () => {
    renderSignup()
    type(screen.getByLabelText(/what's your name/i), 'Mike Reynolds')
    next()
    fireEvent.click(screen.getByRole('button', { name: /^back$/i }))
    expect(screen.getByLabelText(/what's your name/i).value).toBe('Mike Reynolds')
  })

  it('sends a crew member to the crew door instead of a form he cannot pass', () => {
    renderSignup()
    const link = screen.getByRole('link', { name: /lost yours/i })
    expect(link).toHaveAttribute('href', '/crew')
  })
})

describe('sign in', () => {
  // Deliberately NOT split, unlike sign-up: a password manager will not offer
  // to FILL a login whose username field is missing from the DOM, and there is
  // no decoy trick that fixes it on the filling side.
  it('is one screen with both fields', () => {
    window.history.replaceState({}, '', '/login')
    const { container } = render(<Login />)
    const user = container.querySelector('input[autocomplete="username"]')
    const pw = container.querySelector('input[autocomplete="current-password"]')
    expect(user).not.toBeNull()
    expect(pw).not.toBeNull()
    expect(user.closest('form')).toBe(pw.closest('form'))
    expect(screen.queryByRole('button', { name: /^next$/i })).toBeNull()
  })
})
