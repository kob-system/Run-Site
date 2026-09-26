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

// Google Lighthouse (v12.8.2, mobile, simulated throttling), run headless on
// each live homepage the evening of 2026-09-25 (fetchTime 2026-09-26 00:21 to
// 00:23 UTC). Only scores of 100 are shown, per site. Full results:
//   dktaxservice.com           SEO 100, accessibility 100, best practices 100
//   halfmoonsmokeworld.com     SEO 100, accessibility 100, best practices 100
//   518firstclassservices.com  SEO 100 (other categories under 100, not shown)
//   troymegawash.com           SEO 100 (other categories under 100, not shown)
// Performance was under 100 on every site and is not shown anywhere.
export const LIGHTHOUSE_DATE = 'September 25, 2026'
export const LIGHTHOUSE = [
  { key: 'dktax', name: 'D&K Tax Services', seo: 100 },
  { key: 'firstclass', name: 'First Class Property Services', seo: 100 },
  { key: 'troymega', name: 'Troy Mega Laundromat', seo: 100 },
  { key: 'halfmoon', name: 'Half Moon Smoke World', seo: 100 },
]

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Counts from 0 up to a true number once it scrolls into view. Reduced motion,
// or no observer (jsdom), shows the final number straight away.
export function CountUp({ to, duration = 1400 }) {
  const ref = useRef(null)
  const [n, setN] = useState(to)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined' || reducedMotion()) return
    // The true number shows until the moment it is seen; only then does it
    // count up, so a missed observer can never leave a false 0 on screen.
    let raf = 0
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return
      io.disconnect()
      setN(0)
      const t0 = performance.now()
      const tick = (t) => {
        const k = Math.min(1, (t - t0) / duration)
        setN(Math.round(to * (1 - Math.pow(1 - k, 3))))
        if (k < 1) raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    }, { threshold: 0.4 })
    io.observe(el)
    return () => { io.disconnect(); cancelAnimationFrame(raf) }
  }, [to, duration])
  return <span ref={ref}>{n}</span>
}

// Drag to compare two real screenshots of the same page (English / Spanish).
// A native range input drives it, so it works with a thumb, a mouse and the
// keyboard, and a screen reader announces the position.
export function Compare({ left, right, leftLabel, rightLabel, alt }) {
  const [pos, setPos] = useState(50)
  const [glide, setGlide] = useState(false)
  const jump = (v) => { setGlide(true); setPos(v) }
  return (
    <div className={`ks-compare${glide ? ' ks-compare--glide' : ''}${pos <= 1 || pos >= 99 ? ' ks-compare--end' : ''}`} style={{ '--pos': `${pos}%`, '--p': pos }}>
      <div className="ks-compare-phone">
        <img src={left} alt={alt} width="600" height="1298" loading="lazy" decoding="async" />
        <img className="ks-compare-top" src={right} alt="" aria-hidden="true" width="600" height="1298" loading="lazy" decoding="async" />
        <span className="ks-compare-bar" aria-hidden="true"><span className="ks-compare-knob" /></span>
        <input
          className="ks-compare-range"
          type="range"
          min="0"
          max="100"
          value={pos}
          onChange={(e) => { setGlide(false); setPos(Number(e.target.value)) }}
          aria-label={`Slide between ${leftLabel} and ${rightLabel}`}
        />
      </div>
      <div className="ks-compare-pills">
        <button type="button" className={pos >= 60 ? 'is-on' : ''} aria-pressed={pos >= 60} onClick={() => jump(100)}>{leftLabel}</button>
        <button type="button" className={pos <= 40 ? 'is-on' : ''} aria-pressed={pos <= 40} onClick={() => jump(0)}>{rightLabel}</button>
      </div>
    </div>
  )
}

// Buttons lean a few pixels toward the pointer on desktop. Mouse only, never
// on touch, never under reduced motion. Also feeds --mx / --my to any
// [data-glow] panel for the soft spotlight that follows the cursor.
export function usePointerCraft(rootRef) {
  useEffect(() => {
    const root = rootRef.current
    if (!root || typeof window === 'undefined' || !window.matchMedia) return
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches || reducedMotion()) return
    const onMove = (e) => {
      const glow = e.target.closest && e.target.closest('[data-glow]')
      if (glow) {
        const r = glow.getBoundingClientRect()
        glow.style.setProperty('--mx', `${e.clientX - r.left}px`)
        glow.style.setProperty('--my', `${e.clientY - r.top}px`)
      }
      const btn = e.target.closest && e.target.closest('[data-magnetic]')
      if (btn) {
        const r = btn.getBoundingClientRect()
        const x = (e.clientX - (r.left + r.width / 2)) * 0.22
        const y = (e.clientY - (r.top + r.height / 2)) * 0.32
        btn.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`
      }
    }
    const onOut = (e) => {
      const btn = e.target.closest && e.target.closest('[data-magnetic]')
      if (btn && !btn.contains(e.relatedTarget)) btn.style.transform = ''
    }
    root.addEventListener('pointermove', onMove)
    root.addEventListener('pointerout', onOut)
    return () => {
      root.removeEventListener('pointermove', onMove)
      root.removeEventListener('pointerout', onOut)
    }
  }, [rootRef])
}
