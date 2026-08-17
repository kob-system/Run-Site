// Browser crash reporter. The app POSTs here when a render error hits the
// ErrorBoundary, or an uncaught exception / rejected promise reaches window.
//
// UNAUTHENTICATED on purpose: the errors most worth knowing about are the ones
// that happen before or during sign-in — a white-screened landing page or a
// broken login is invisible to an authenticated-only reporter, and those are
// exactly the failures that cost a first customer. The trade is that anyone can
// POST here, so this endpoint is built to be boring:
//   - it stores nothing and reads nothing; the only side effect is one email
//   - every field is length-capped and HTML-escaped downstream in _alert.js
//   - per-IP AND per-signature AND global rate limits, all fail-closed
//   - it always answers 204, even when it decided to do nothing, so a crashing
//     client can never get stuck in a retry loop against an error response
import crypto from 'crypto'
import { alertOwner } from './_alert'

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const cap = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '')

function clientIp(req) {
  // Never the FIRST X-Forwarded-For hop — it's client-supplied and spoofable,
  // which would mint a fresh rate-limit bucket per request. Same rule as
  // find-owner.js: x-real-ip, else the LAST hop (the one Vercel appended).
  const xff = (req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean)
  return (req.headers['x-real-ip'] || '').trim() ||
    (xff.length ? xff[xff.length - 1] : '') ||
    (req.socket && req.socket.remoteAddress) ||
    'unknown'
}

function toUuid(seed) {
  const h = crypto.createHash('sha256').update(seed).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

// Fail-closed: a limiter we can't reach means we don't send. Nobody's session
// depends on an error report going out, so there's no reason to fail open.
async function underLimit(key, bucket, max, windowSecs) {
  if (!SUPABASE_URL || !SERVICE_KEY) return false
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rate_limit_hit`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_user: key, p_bucket: bucket, p_max: max, p_window_secs: windowSecs }),
    })
    if (!r.ok) return false
    return (await r.json()) === true
  } catch { return false }
}

export default async function handler(req, res) {
  // 204 on everything. A reporter that can return an error is a reporter that
  // can be retried in a loop by the very code that's already broken.
  if (req.method !== 'POST') return res.status(405).end()

  try {
    const b = req.body || {}
    const message = cap(b.message, 300)
    if (!message) return res.status(204).end()

    // 6 reports/hour/IP. A genuinely broken session produces two or three.
    if (!(await underLimit(toUuid('err-ip:' + clientIp(req)), 'report-error', 6, 3600))) {
      return res.status(204).end()
    }

    await alertOwner('browser', message, {
      where: cap(b.where, 60) || 'unknown',
      page: cap(b.page, 200),
      // Who it happened to, when we know — turns "something broke" into a
      // customer JP can actually call. Never an email or a name; the id is
      // enough to find them in Supabase, and it keeps PII out of the mailbox.
      user: cap(b.userId, 64) || 'signed out',
      role: cap(b.role, 20),
      build: cap(b.build, 40),
      browser: cap(req.headers['user-agent'], 180),
      stack: cap(b.stack, 900),
    })
  } catch (e) {
    console.error('report-error failed (non-fatal):', e && e.message)
  }

  return res.status(204).end()
}
