// One place that sends customer email, and one shell every message is poured
// into, so the receipt, the welcome and the dunning notice read as one system
// instead of three people's HTML.
//
// Why this file exists: notify-owner, request-assignment, weekly-digest and
// _alert each grew their own copy of the same Resend fetch and the same inline
// styles. That was survivable while there were three of them. It is not
// survivable now that billing sends mail too — a receipt that looks nothing
// like the rest of the product is the email a contractor reports as phishing.
//
// This module NEVER throws. Email is always a side effect of something more
// important (a payment landed, an account was created); a Resend outage must
// not fail that.

const FROM = process.env.RESEND_FROM || 'JobTally <noreply@getjobtally.com>'
const APP_URL = process.env.APP_URL || 'https://www.getjobtally.com'

export const esc = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

// Money, from Stripe's integer cents, in the currency Stripe actually charged.
export function money(cents, currency) {
  if (typeof cents !== 'number' || !isFinite(cents)) return ''
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: (currency || 'usd').toUpperCase(),
    }).format(cents / 100)
  } catch {
    return '$' + (cents / 100).toFixed(2)
  }
}

// A unix second-stamp as a plain American date. Stripe speaks seconds; every
// date in these emails comes from Stripe, so this takes seconds, not ms.
export function stamp(sec) {
  if (typeof sec !== 'number' || !isFinite(sec)) return ''
  try {
    return new Date(sec * 1000).toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York',
    })
  } catch { return '' }
}

// The shell. Dark header, one big number, one button, a plain footer.
// `hero` is the thing you want read from the lock screen — a dollar amount, a
// duration, a name. It is the only element allowed to be large.
export function shell({ heading, lead, hero, heroLabel, rows, cta, ctaHref, foot }) {
  const rowHtml = (rows || [])
    .filter(Boolean)
    .map(
      ([k, v]) => `<tr>
        <td style="padding:7px 0;color:#667085;font-size:14px;">${esc(k)}</td>
        <td style="padding:7px 0;color:#1C2B3A;font-size:14px;font-weight:700;text-align:right;">${esc(v)}</td>
      </tr>`
    )
    .join('')

  return `<div style="background:#f4f6f9;padding:24px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:440px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e3e8ef;">
    <div style="background:#1C2B3A;padding:18px 24px;">
      <span style="color:#E07B2A;font-size:19px;font-weight:800;letter-spacing:.02em;">JobTally</span>
    </div>
    <div style="padding:24px;">
      <h1 style="margin:0 0 8px;font-size:20px;line-height:1.3;color:#1C2B3A;font-weight:800;">${esc(heading)}</h1>
      ${lead ? `<p style="margin:0 0 18px;font-size:15px;line-height:1.55;color:#425466;">${lead}</p>` : ''}
      ${hero ? `<div style="text-align:center;margin:18px 0;padding:18px;background:#f4f6f9;border-radius:12px;">
        <div style="font-size:38px;font-weight:800;color:#E07B2A;line-height:1;">${esc(hero)}</div>
        ${heroLabel ? `<div style="font-size:13px;color:#888;margin-top:6px;">${esc(heroLabel)}</div>` : ''}
      </div>` : ''}
      ${rowHtml ? `<table style="width:100%;border-collapse:collapse;margin:8px 0 4px;">${rowHtml}</table>` : ''}
      ${cta ? `<p style="margin:22px 0 0;text-align:center;">
        <a href="${esc(ctaHref || APP_URL)}" style="display:inline-block;background:#E07B2A;color:#ffffff;text-decoration:none;padding:13px 26px;border-radius:9px;font-size:16px;font-weight:700;">${esc(cta)}</a>
      </p>` : ''}
      ${foot ? `<p style="margin:20px 0 0;padding-top:16px;border-top:1px solid #eef2f6;font-size:13px;line-height:1.55;color:#667085;">${foot}</p>` : ''}
    </div>
  </div>
  <p style="max-width:440px;margin:14px auto 0;font-size:11.5px;color:#98a2b3;text-align:center;line-height:1.5;">
    JobTally &middot; <a href="${esc(APP_URL)}" style="color:#98a2b3;">getjobtally.com</a><br />
    Sent because you have a JobTally account.
  </p>
</div>`
}

// Fire and forget. Returns true on a 2xx from Resend, false on anything else —
// never throws, never rejects.
export async function send({ to, subject, html, replyTo }) {
  try {
    if (!process.env.RESEND_API_KEY) {
      console.error('_email: RESEND_API_KEY missing, not sending:', subject)
      return false
    }
    if (!to) return false
    const body = {
      from: FROM,
      to,
      subject: String(subject || '').replace(/[\r\n]+/g, ' ').slice(0, 200),
      html,
    }
    if (replyTo) body.reply_to = replyTo
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify(body),
    })
    if (!r.ok) {
      console.error('_email: Resend', r.status, await r.text().catch(() => ''))
      return false
    }
    return true
  } catch (e) {
    console.error('_email: send threw (swallowed):', e && e.message)
    return false
  }
}

export { APP_URL }
