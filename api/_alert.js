// Server-side "wake JP up" alerting.
//
// The gap this fills: until now a crash anywhere in JobTally went to
// console.error, which lands in a Vercel log nobody is watching. With a paying
// customer that means the first person who knows the app is broken is the
// customer, on the phone, angry. This is the smallest thing that fixes that —
// no new vendor, no new account, no new dashboard to remember to check. It
// rides Resend, which is already configured and already sending lead alerts.
//
// THE HARD RULE: alerting must never make an outage worse. Every function here
// swallows its own errors and resolves — a failure to send an alert can never
// turn a handled error into an unhandled one, and can never add latency to a
// user-facing response (callers fire-and-forget).
//
// FLOOD CONTROL is the whole design problem. A broken deploy doesn't throw once,
// it throws for every request from every user. Three layers, all riding the
// existing rate_limit_hit() Postgres counter so there's no new infrastructure:
//   1. per-signature — the SAME error alerts at most once every 6 hours. This
//      is the one that matters: 4,000 copies of one bug become one email.
//   2. global — at most 12 alert emails an hour no matter how many DISTINCT
//      errors fire, so a catastrophic deploy can't empty the Resend quota or
//      bury the inbox.
//   3. fail-CLOSED — if the limiter can't be reached we do NOT send. An alert
//      is worth nothing if the price of a hiccup is an unbounded mail loop.
//      This is deliberately the opposite of find-owner.js, where failing open
//      protects a real user's signup. Nobody's signup depends on an alert.
import crypto from 'crypto'

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const FROM = process.env.RESEND_FROM || 'JobTally <noreply@getjobtally.com>'
// Same address the lead alerts already go to, overridable without a deploy.
const ALERT_TO = process.env.ALERT_TO || process.env.LEAD_ALERT_TO || 'jpkobrossi@hotmail.com'

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

// rate_limits is keyed by uuid, so every bucket key is a hash folded into uuid
// shape — the same trick find-owner.js uses for IPs.
function toUuid(seed) {
  const h = crypto.createHash('sha256').update(seed).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

// FAIL-CLOSED, unlike the user-facing limiters. See the header.
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

// A stable fingerprint for "this is the same bug again". Digits are flattened
// to # so `job 4f2a not found` and `job 91bc not found` collapse into one
// signature instead of alerting separately for every affected row.
export function signatureOf(where, message) {
  const norm = String(message || '')
    .slice(0, 300)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
    .replace(/\d+/g, '#')
  return `${where}::${norm}`
}

/**
 * Fire an alert. Never throws, never rejects — callers may ignore the promise.
 *
 * @param {string} where    short origin tag, e.g. 'stripe-webhook'
 * @param {string} message  the one-line problem
 * @param {object} [detail] extra key/values rendered as a table
 */
export async function alertOwner(where, message, detail) {
  try {
    if (!process.env.RESEND_API_KEY) return false

    const sig = signatureOf(where, message)
    // 1 per signature per 6h, then 12/hour across everything.
    if (!(await underLimit(toUuid('alert-sig:' + sig), 'alert-sig', 1, 21600))) return false
    if (!(await underLimit(toUuid('alert-global'), 'alert-global', 12, 3600))) return false

    const rows = Object.entries(detail || {})
      .map(([k, v]) => {
        const val = typeof v === 'object' ? JSON.stringify(v) : String(v == null ? '' : v)
        return `<tr><td style="padding:4px 12px 4px 0;color:#6B7280;font-size:13px;vertical-align:top;">${esc(k)}</td>` +
               `<td style="padding:4px 0;font-size:13px;font-family:ui-monospace,monospace;color:#1C2B3A;">${esc(val.slice(0, 500))}</td></tr>`
      })
      .join('')

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: FROM,
        to: ALERT_TO,
        subject: `JobTally broke: ${String(message || 'unknown error').slice(0, 90)}`.replace(/[\r\n]+/g, ' '),
        html: `
          <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; padding: 20px;">
            <p style="font-size:12px;color:#DC2626;margin:0 0 6px;text-transform:uppercase;letter-spacing:.08em;font-weight:800;">JobTally error · ${esc(where)}</p>
            <p style="font-size:17px;font-weight:700;color:#1C2B3A;margin:0 0 14px;line-height:1.35;">${esc(String(message || '').slice(0, 400))}</p>
            ${rows ? `<table style="border-collapse:collapse;width:100%;background:#f4f6f9;border-radius:10px;padding:10px;">${rows}</table>` : ''}
            <p style="font-size:12px;color:#94a3b8;margin:16px 0 0;line-height:1.5;">
              You get this once per distinct error every 6 hours, max 12 an hour overall — so this is
              one email, not one per affected request. Logs: Vercel → runsite → Logs.
            </p>
          </div>
        `,
      }),
    })
    return r.ok
  } catch (e) {
    // Deliberately terminal. An alerting failure must never propagate.
    console.error('alertOwner failed (non-fatal):', e && e.message)
    return false
  }
}
