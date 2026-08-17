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
const FROM = process.env.RESEND_FROM || 'JobTally <noreply@getjobtally.com>'
const APP_URL = process.env.APP_URL || 'https://getjobtally.com'
// Every calculator lead also pings the owner. Without this a lead lands in the
// `leads` table and nobody is told — the row is only found if someone remembers
// to go look, which in practice means the lead goes cold. Env-overridable so the
// alert address can change without a deploy.
const LEAD_ALERT_TO = process.env.LEAD_ALERT_TO || 'jpkobrossi@hotmail.com'

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

// One place to POST Resend so the lead's own email and the owner alert can be
// fired independently — neither failure may swallow the other.
async function sendMail(payload) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    },
    body: JSON.stringify(payload),
  })
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  return true
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  if (!process.env.RESEND_API_KEY) return res.json({ success: false, error: 'Email not configured' })

  // 3 emails/hour per IP — a real visitor re-runs the calculator once or
  // twice; anything past that is a script.
  if (!(await allowedRate(ipKey(req), 'lead-numbers', 3, 3600))) {
    return res.status(429).json({ success: false, error: 'Too many requests' })
  }

  const { email, results, source, attrib } = req.body || {}
  const addr = typeof email === 'string' ? email.trim() : ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr) || addr.length > 320) {
    return res.status(400).json({ success: false, error: 'Invalid email' })
  }

  // Per-RECIPIENT cap, and the per-IP cap above cannot substitute for it.
  // The abuse this endpoint actually enables isn't volume, it's targeting:
  // anyone can make getjobtally.com send mail to an address they chose, and
  // rotating IPs (trivial — any proxy pool) resets the per-IP bucket while
  // hammering one victim's inbox. Two a day per address means the worst
  // available attack is two emails, no matter how many IPs are thrown at it.
  // That protects the victim and, more selfishly, protects the sending
  // reputation of the domain every JobTally transactional email rides on.
  // Keyed by the lowercased address so casing tricks don't mint a new bucket.
  const addrKey = crypto.createHash('sha256').update('lead-addr:' + addr.toLowerCase()).digest('hex')
  const addrUuid = `${addrKey.slice(0, 8)}-${addrKey.slice(8, 12)}-${addrKey.slice(12, 16)}-${addrKey.slice(16, 20)}-${addrKey.slice(20, 32)}`
  if (!(await allowedRate(addrUuid, 'lead-addr', 2, 86400))) {
    // Deliberately reported as success. Telling a caller "that address is over
    // its limit" turns this into an oracle for whether someone already
    // requested their numbers, and a real visitor who double-taps Send should
    // not be shown an error for it.
    return res.json({ success: true })
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

  // Where the lead came from, for the owner alert only — never echoed back to
  // the visitor. Truncated because these land in an email subject/body and are
  // client-supplied strings.
  const tag = (v) => (typeof v === 'string' ? v.trim().slice(0, 80) : '')
  const a = attrib && typeof attrib === 'object' ? attrib : {}
  const origin = [
    tag(source) || 'remodelers-calculator',
    tag(a.utm_source) && `utm_source=${tag(a.utm_source)}`,
    tag(a.utm_medium) && `utm_medium=${tag(a.utm_medium)}`,
    tag(a.utm_campaign) && `utm_campaign=${tag(a.utm_campaign)}`,
    tag(a.ref) && `ref=${tag(a.ref)}`,
  ].filter(Boolean).join(' · ')

  // The owner alert, fired alongside the lead's own email rather than after it,
  // so a Resend rejection on one still lets the other go out. Resolves to null
  // on success or to the Error on failure — it never rejects, so it can't
  // become an unhandled rejection if the lead send throws first.
  const alert = sendMail({
    from: FROM,
    to: LEAD_ALERT_TO,
    reply_to: addr,
    subject: `New JobTally lead: ${addr} · ${fmt(profit)} profit`,
    html: `
      <div style="font-family: sans-serif; max-width: 460px; margin: 0 auto; padding: 20px;">
        <p style="font-size:13px;color:#6B7280;margin:0 0 6px;text-transform:uppercase;letter-spacing:.08em;font-weight:700;">New calculator lead</p>
        <p style="font-size:20px;font-weight:800;color:#1C2B3A;margin:0 0 2px;">
          <a href="mailto:${esc(addr)}" style="color:#1C2B3A;">${esc(addr)}</a>
        </p>
        <p style="font-size:13px;color:#6B7280;margin:0 0 16px;">${esc(origin)}</p>
        <div style="background:#f4f6f9;border-radius:12px;padding:18px;">
          <table style="width:100%;border-collapse:collapse;">
            ${row('Contract price', contract)}
            ${row('Labor', labor)}
            ${row('Materials', materials)}
            ${row('Overhead', overhead)}
            ${row('Total cost', cost, true)}
          </table>
          <p style="font-size:26px;font-weight:800;color:${profitColor};margin:12px 0 0;text-align:center;">${esc(fmt(profit))}</p>
          <p style="font-size:13px;color:#6B7280;margin:2px 0 0;text-align:center;">their profit · ${margin}% margin</p>
        </div>
        <p style="color:#4B5563;font-size:14px;margin:16px 0 0;">
          They ran their own job and gave you their email. Hit reply — this email replies straight to them.
        </p>
      </div>
    `,
  }).then(() => null, (e) => e)

  try {
    const lead = sendMail({
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
    }).then(() => null, (e) => e)

    const [leadErr, alertErr] = await Promise.all([lead, alert])
    // The alert failing is an owner-side problem, not the visitor's — log it
    // loudly but still tell them their numbers are on the way.
    if (alertErr) console.error('lead alert failed:', alertErr)
    if (leadErr) {
      console.error('lead email failed:', leadErr)
      return res.json({ success: false, error: 'Email failed' })
    }
    return res.json({ success: true })
  } catch (err) {
    console.error('send-lead-numbers error:', err)
    await alert.then((e) => { if (e) console.error('lead alert failed:', e) })
    return res.json({ success: false, error: 'Email failed' })
  }
}
