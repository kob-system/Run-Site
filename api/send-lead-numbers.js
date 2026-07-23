// Emails a /remodelers calculator user their own numbers. PUBLIC endpoint
// (the visitor is anonymous by definition), so it is deliberately dumb:
//   - it only echoes back numbers, re-validated server-side — no data reads,
//     no lookups, nothing an attacker can exfiltrate;
//   - the lead row is stored by the CLIENT via the leads table's anon-insert
//     RLS before this is called — a mail failure never loses the lead;
//   - rate-limited per-IP through the same rate_limit_hit() Postgres counter
//     the authed endpoints use (IP hashed into a stable uuid key).
import crypto from 'crypto'

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const FROM = process.env.RESEND_FROM || 'JobTally <onboarding@resend.dev>'
const APP_URL = process.env.APP_URL || 'https://getjobtally.com'

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

// Coerce to a sane finite dollar amount (server-side re-validation — we never
// trust client-computed strings into an email).
const money = (v) => {
  const n = Number(v)
  if (!Number.isFinite(n) || Math.abs(n) > 1e9) return 0
  return Math.round(n * 100) / 100
}
const fmt = (n) => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US')

// Stable uuid-shaped key from the caller's IP so rate_limit_hit(uuid,...) can
// count anonymous callers too. Uses the platform-trusted client IP — NEVER the
// first X-Forwarded-For hop, which is client-supplied and spoofable (an attacker
// could mint a fresh rate-limit bucket every request and turn this into an
// uncapped email cannon). Matches find-owner.js: prefer x-real-ip, else the LAST
// XFF hop (the one Vercel appended), else the socket address.
function ipKey(req) {
  const xff = (req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean)
  const ip =
    (req.headers['x-real-ip'] || '').trim() ||
    (xff.length ? xff[xff.length - 1] : '') ||
    (req.socket && req.socket.remoteAddress) ||
    'unknown'
  const h = crypto.createHash('sha256').update('lead:' + ip).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

// Same fail-open pattern as notify-owner.js: an infra hiccup never blocks.
async function allowedRate(key, bucket, max, windowSecs) {
  if (!SUPABASE_URL || !SERVICE_KEY) return true
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rate_limit_hit`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_user: key, p_bucket: bucket, p_max: max, p_window_secs: windowSecs }),
    })
    if (!r.ok) return true
    return (await r.json()) === true
  } catch { return true }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  if (!process.env.RESEND_API_KEY) return res.json({ success: false, error: 'Email not configured' })

  // 3 emails/hour per IP — a real visitor re-runs the calculator once or
  // twice; anything past that is a script.
  if (!(await allowedRate(ipKey(req), 'lead-numbers', 3, 3600))) {
    return res.status(429).json({ success: false, error: 'Too many requests' })
  }

  const { email, results } = req.body || {}
  const addr = typeof email === 'string' ? email.trim() : ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr) || addr.length > 320) {
    return res.status(400).json({ success: false, error: 'Invalid email' })
  }

  const r = results || {}
  const contract = money(r.contract)
  const labor = money(r.labor)
  const materials = money(r.materials)
  const overhead = money(r.overhead)
  const cost = money(r.cost)
  const profit = money(r.profit)
  const margin = contract > 0 ? Math.round((profit / contract) * 100) : 0
  if (contract <= 0) return res.status(400).json({ success: false, error: 'No numbers to send' })

  const row = (label, val, strong) =>
    `<tr><td style="padding:6px 0;color:#4B5563;font-size:14px;">${label}</td>` +
    `<td style="padding:6px 0;text-align:right;font-size:14px;font-weight:${strong ? 700 : 600};color:#1C2B3A;">${esc(fmt(val))}</td></tr>`

  const profitColor = profit >= 0 ? '#16A34A' : '#DC2626'

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: FROM,
        to: addr,
        subject: `Your job's real number: ${fmt(profit)} profit (${margin}% margin)`,
        html: `
          <div style="font-family: sans-serif; max-width: 440px; margin: 0 auto; padding: 24px;">
            <h2 style="color: #1C2B3A; margin: 0 0 4px;">JobTally</h2>
            <p style="color: #4B5563; font-size: 14px; margin: 0 0 16px;">Here's the job you ran through the profit calculator:</p>
            <div style="background: #f4f6f9; border-radius: 12px; padding: 20px;">
              <table style="width:100%;border-collapse:collapse;">
                ${row('Contract price', contract)}
                ${row('Labor', labor)}
                ${row('Materials', materials)}
                ${row('Overhead', overhead)}
                ${row('Total cost', cost, true)}
              </table>
              <p style="font-size: 30px; font-weight: 800; color: ${profitColor}; margin: 14px 0 0; text-align: center;">${esc(fmt(profit))}</p>
              <p style="font-size: 13px; color: #6B7280; margin: 2px 0 0; text-align: center;">true profit · ${margin}% margin</p>
            </div>
            <p style="color: #4B5563; font-size: 14px; margin: 18px 0 0;">
              JobTally keeps score like this on every job automatically — crew hours, receipts,
              and what's left for you, while the job is still running.
            </p>
            <p style="margin: 16px 0 0;">
              <a href="${APP_URL}/?signup=1&utm_source=lead-email&utm_medium=email&utm_campaign=calculator"
                 style="display:inline-block;background:#E07B2A;color:#fff;font-weight:700;font-size:15px;padding:12px 20px;border-radius:8px;text-decoration:none;">
                Start your 30-day free trial
              </a>
            </p>
            <p style="font-size: 12px; color: #888; margin: 16px 0 0;">
              You asked for this one-time email on getjobtally.com/remodelers. No list, no follow-up spam.
            </p>
          </div>
        `,
      }),
    })

    if (!response.ok) {
      const body = await response.text()
      console.error('Resend error', response.status, body)
      return res.json({ success: false, error: 'Email failed' })
    }
    return res.json({ success: true })
  } catch (err) {
    console.error('send-lead-numbers error:', err)
    return res.json({ success: false, error: 'Email failed' })
  }
}
