import React, { useState } from 'react'
import { supabase } from '../supabaseClient'
import { getAttribution } from '../utils/attribution'
import { track, EV } from '../utils/analytics'
import './LeadForm.css'

// A real lead-capture form, writing to public.leads (FIX-DATABASE-19).
// Before this, every CTA on the marketing pages was mailto:/tel: only —
// fine for someone ready to talk right now, but it drops anyone who's just
// curious. $100M Leads: "if you're struggling for leads, make it easier to
// raise a hand." This is that — one field of real friction (email), the
// rest optional, no password, no account.
//
// public.leads RLS is anon-INSERT-only (no select/update/delete from the
// client), so this component can never read a lead back — a submit either
// resolves or it doesn't. `source` distinguishes which page/offer a lead
// came from; `payload` carries the free-text fields the DB doesn't have
// dedicated columns for.
export default function LeadForm({
  source,
  ctaLabel = "Show me the leak",
  askMessage = "What's costing you the most right now?",
  compact = false,
  // When true, the thank-you state offers a one-tap prefilled text to JP.
  // public.leads has no alert on insert (nothing pings JP), so on the pages
  // where speed matters this is the zero-infra way to make sure he sees it:
  // the visitor's own phone sends the text, no key or server involved.
  textMeAfter = false,
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [message, setMessage] = useState('')
  const [company, setCompany] = useState('') // honeypot — real visitors never see or fill this
  const [status, setStatus] = useState('idle') // idle | sending | done | error

  const smsHref = () => {
    const body = [
      'Hi JP, I just filled out your form on getjobtally.com.',
      name.trim() && `I'm ${name.trim()}.`,
      message.trim(),
    ].filter(Boolean).join(' ').slice(0, 400)
    // `?&body=` is the form both iOS and Android Messages accept.
    return `sms:+15186089344?&body=${encodeURIComponent(body)}`
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (company) return // honeypot tripped — silently drop, no error shown to the bot
    if (status === 'sending' || status === 'done') return
    const cleanEmail = email.trim()
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setStatus('error')
      return
    }
    setStatus('sending')
    const attribution = getAttribution()
    try {
      const { error } = await supabase.from('leads').insert({
        email: cleanEmail,
        source,
        utm_source: attribution?.utm_source || null,
        utm_medium: attribution?.utm_medium || null,
        utm_campaign: attribution?.utm_campaign || null,
        payload: {
          name: name.trim().slice(0, 120) || null,
          phone: phone.trim().slice(0, 40) || null,
          message: message.trim().slice(0, 500) || null,
          landing_page: attribution?.landing_page || window.location.pathname,
        },
      })
      if (error) throw error
      setStatus('done')
      track(EV.LEAD_SUBMITTED, { source })
    } catch (err) {
      setStatus('error')
      track(EV.LEAD_FAILED, { source })
    }
  }

  if (status === 'done') {
    return (
      <div className={`lf lf-done${compact ? ' lf-compact' : ''}`}>
        <span className="lf-done-mark" aria-hidden="true">&#10003;</span>
        <div>
          <strong>Got it.</strong>
          <p>I read these myself. I'll reach out directly, usually same day.</p>
          {textMeAfter && (
            <a className="lf-text-me" href={smsHref()}>Want it faster? Text me now</a>
          )}
        </div>
      </div>
    )
  }

  return (
    <form className={`lf${compact ? ' lf-compact' : ''}`} onSubmit={handleSubmit} noValidate>
      {/* Honeypot — visually and from-AT hidden, real users never reach it via tab order either */}
      <input
        type="text"
        name="company"
        value={company}
        onChange={(e) => setCompany(e.target.value)}
        className="lf-honeypot"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
      />
      <div className="lf-row">
        <input
          type="text"
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="lf-input"
          autoComplete="name"
        />
        <input
          type="tel"
          placeholder="Phone (optional)"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="lf-input"
          autoComplete="tel"
        />
      </div>
      <input
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="lf-input"
        autoComplete="email"
        required
      />
      <textarea
        placeholder={askMessage}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        className="lf-textarea"
        rows={compact ? 2 : 3}
      />
      <button type="submit" className="lf-submit" disabled={status === 'sending'}>
        {status === 'sending' ? 'Sending…' : ctaLabel}
      </button>
      {status === 'error' && (
        <div className="lf-error">
          Couldn't send that. Double check the email, or just call me. It's faster anyway.
        </div>
      )}
      <div className="lf-note">No spam, no list. I read every one of these myself.</div>
    </form>
  )
}
