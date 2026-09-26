import React, { useEffect, useRef, useState } from 'react'

// Shared pieces for the public storefront pages: the homepage (Landing.js) and
// the referral link page (/jp, Meet.js). One source for contact details, the
// three offers and the client work, so the two pages can never disagree.
//
// Copy rules (CLAUDE.md §4 + JP's 2026-09-25 review): written as the business,
// not first person. Owner-facing words only: never "AI", "software", "app",
// "platform", "automation" or "POS" ("The Follow-Up System" is the offer's
// proper name). No invented stats, no testimonials, no results promised, no
// feature that is not actually offered. No em or en dashes anywhere.

export const PHONE_DISPLAY = '(518) 608-9344'
export const PHONE_HREF = 'tel:+15186089344'
export const EMAIL = 'kobrossisystems@gmail.com'
export const emailHref = (subject) => `mailto:${EMAIL}?subject=${encodeURIComponent(subject)}`
export const smsHref = (body) => `sms:+15186089344?&body=${encodeURIComponent(body)}`

const PUB = process.env.PUBLIC_URL || ''
export const asset = (p) => `${PUB}${p}`

// Live client sites. Every one was loaded and screenshotted with headless
// Chrome on 2026-09-25 (desktop 1440 or 1920 wide, phone 390 wide at 2x);
// chat bubbles and the age gate were closed before capture, nothing else was
// edited. One line each of what was actually built, read off the live site.
export const WORK = [
  {
    key: 'dktax',
    name: 'D&K Tax Services',
    place: 'The Bronx and Albany',
    domain: 'dktaxservice.com',
    did: 'An English and Spanish website with online booking for both offices.',
  },
  {
    key: 'firstclass',
    name: 'First Class Property Services',
    place: 'Capital Region',
    domain: '518firstclassservices.com',
    did: 'A website with online booking and a quote estimator for a home repair and remodeling company.',
  },
  {
    key: 'troymega',
    name: 'Troy Mega Laundromat',
    place: 'Troy',
    domain: 'troymegawash.com',
    did: 'Hours, prices and wash, dry and fold drop-off, all in one place for a Troy laundromat.',
  },
  {
    key: 'halfmoon',
    name: 'Half Moon Smoke World',
    place: 'Clifton Park',
    domain: 'halfmoonsmokeworld.com',
    did: "The shop's product menu online, so customers can look before they drive over.",
  },
]

// A laptop with the desktop screenshot and a phone with the mobile one,
// overlapping. Pure CSS frames, no image assets for the devices themselves.
export function Devices({ item, compact = false }) {
  const d = (w) => asset(`/media/work/${item.key}-desk-${w}.webp`)
  return (
    <div className={`ks-devices${compact ? ' ks-devices--compact' : ''}`} aria-hidden="true">
      <div className="ks-laptop">
        <div className="ks-laptop-screen">
          <img
            src={d(1200)}
            srcSet={`${d(640)} 640w, ${d(1200)} 1200w`}
            sizes="(max-width: 800px) 90vw, 640px"
            alt=""
            loading="lazy"
            decoding="async"
            width="1200"
            height="750"
          />
        </div>
        <div className="ks-laptop-base" />
      </div>
      {!compact && (
        <div className="ks-phone">
          <img src={asset(`/media/work/${item.key}-mob.webp`)} alt="" loading="lazy" decoding="async" width="360" height="780" />
        </div>
      )}
    </div>
  )
}

// Fade-up once when a block scrolls into view. No observer (old browser, the
// jsdom test env) means the content is simply shown.
export function Reveal({ as: Tag = 'div', className = '', children, ...rest }) {
  const ref = useRef(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          io.disconnect()
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return (
    <Tag ref={ref} className={`ks-reveal${visible ? ' ks-in' : ''} ${className}`} {...rest}>
      {children}
    </Tag>
  )
}

export function Wordmark() {
  return (
    <a className="ks-wordmark" href="/" aria-label="Kobrossi Systems, home">
      <span className="ks-wordmark-dot" aria-hidden="true" />
      Kobrossi <em>Systems</em>
    </a>
  )
}
