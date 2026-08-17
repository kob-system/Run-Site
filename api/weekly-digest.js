// The Friday-morning email: what moved this week, where each job stands, and
// what's owed. Triggered by a Vercel cron (see vercel.json).
//
// WHY IT EXISTS: JobTally's whole promise is knowing your number while the job
// is still running, and until now that only happened if the owner remembered to
// open the app. This is the app remembering for him. It's also the only organic
// distribution the product has — it is the screenshot one contractor forwards
// to another.
//
// THREE RULES THIS FILE IS BUILT AROUND
//   1. NEVER SEND A WRONG NUMBER. The arithmetic lives in _digestMath.js and is
//      pinned by 19 tests. This file only fetches rows and renders them.
//   2. NEVER SEND A POINTLESS ONE. A quiet week with nothing owed and nothing
//      bleeding is skipped. A digest that says "you did nothing" every week is
//      how a digest gets filtered to spam — and once filtered it is never read
//      again, including the week it finally matters.
//   3. ONE OWNER'S FAILURE IS NOT EVERYONE'S. Each owner is processed in its
//      own try/catch. A single bad row must never stop the other sends.
import { buildDigest, fmtMoney, THIN_MARGIN } from './_digestMath'
import { alertOwner } from './_alert'

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const FROM = process.env.RESEND_FROM || 'JobTally <noreply@getjobtally.com>'
const APP_URL = process.env.APP_URL || 'https://www.getjobtally.com'

const svc = () => ({ apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` })

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

async function sb(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: svc() })
  if (!r.ok) throw new Error(`${path} -> ${r.status}`)
  return r.json()
}

// The week the owner is CURRENTLY finishing: most recent Sunday 00:00 → now.
//
// This is deliberately not "the last complete week." Sent Friday morning, a
// complete-week window would report Sunday-to-Sunday of the week BEFORE the one
// he just worked — five days stale, describing jobs he's already moved on from.
// The email says "this week" and it has to mean it. Running Friday at 12:00 UTC
// (8am ET) it covers Sunday through Thursday: the work week, as of the morning
// he reads it.
//
// KNOWN AND ACCEPTED: the boundary is UTC, not each owner's local midnight, so
// a late-Saturday receipt on the US east coast can land in the next week's
// email. Fixing that per-owner needs a timezone on the profile, which doesn't
// exist yet. Nothing is lost or double-counted either way — the window is
// start-inclusive and end-exclusive.
function currentWeek(now) {
  const start = new Date(now)
  start.setUTCHours(0, 0, 0, 0)
  start.setUTCDate(start.getUTCDate() - start.getUTCDay()) // back to this Sunday
  return { weekStartISO: start.toISOString(), weekEndISO: new Date(now).toISOString() }
}

const prettyRange = (startISO, endISO) => {
  const o = { month: 'short', day: 'numeric', timeZone: 'UTC' }
  const a = new Date(startISO).toLocaleDateString('en-US', o)
  const b = new Date(new Date(endISO).getTime() - 86400000).toLocaleDateString('en-US', o)
  return `${a} – ${b}`
}

function renderEmail(d, name) {
  const hi = name ? `${esc(name.split(' ')[0])}, here's` : "Here's"
  const worst = d.attention[0]

  const jobRows = d.jobs.slice(0, 6).map((j) => {
    const color = j.profit < 0 ? '#DC2626' : j.margin < THIN_MARGIN ? '#B8860B' : '#16A34A'
    return `<tr>
      <td style="padding:9px 0;font-size:14px;color:#1C2B3A;">${esc(j.name)}</td>
      <td style="padding:9px 0;text-align:right;font-size:14px;font-weight:700;color:${color};white-space:nowrap;">${esc(fmtMoney(j.profit))}</td>
      <td style="padding:9px 0 9px 12px;text-align:right;font-size:13px;color:#6B7280;white-space:nowrap;">${j.margin}%</td>
    </tr>`
  }).join('')

  const more = d.jobs.length > 6
    ? `<p style="font-size:12px;color:#94a3b8;margin:6px 0 0;">+ ${d.jobs.length - 6} more in the app</p>` : ''

  return `
  <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
    <p style="font-size:12px;color:#6B7280;margin:0 0 4px;text-transform:uppercase;letter-spacing:.08em;font-weight:700;">
      Your week · ${esc(prettyRange(d.weekStartISO, d.weekEndISO))}
    </p>
    <h2 style="color:#1C2B3A;margin:0 0 16px;font-size:20px;">${hi} where your jobs stand.</h2>

    <div style="background:#f4f6f9;border-radius:12px;padding:18px;">
      <p style="font-size:12px;color:#6B7280;margin:0;text-transform:uppercase;letter-spacing:.06em;font-weight:700;">Went out this week</p>
      <p style="font-size:30px;font-weight:800;color:#1C2B3A;margin:2px 0 0;">${esc(fmtMoney(d.week.total))}</p>
      <p style="font-size:13px;color:#6B7280;margin:2px 0 0;">
        ${esc(fmtMoney(d.week.labor))} labor${d.week.hours ? ` (${d.week.hours}h)` : ''} ·
        ${esc(fmtMoney(d.week.materials))} materials${d.week.other ? ` · ${esc(fmtMoney(d.week.other))} other` : ''}
      </p>
    </div>

    ${worst ? `
    <div style="background:#fbf1ee;border-left:4px solid #c0492b;border-radius:8px;padding:14px 16px;margin-top:14px;">
      <p style="font-size:14px;color:#7a2e1c;margin:0;line-height:1.5;">
        <b>${esc(worst.name)}</b> ${esc(worst.reason)}. Worth a look before Monday.
      </p>
    </div>` : ''}

    ${d.jobs.length ? `
    <p style="font-size:12px;color:#6B7280;margin:22px 0 2px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;">Profit so far, by job</p>
    <table style="width:100%;border-collapse:collapse;">${jobRows}</table>${more}
    <p style="font-size:12px;color:#94a3b8;margin:10px 0 0;line-height:1.5;">
      That's what's left after everything logged so far — it moves as the job runs.
    </p>` : ''}

    ${d.owed > 0 ? `
    <div style="border-top:1px solid #e3e8ef;margin-top:20px;padding-top:16px;">
      <p style="font-size:15px;color:#1C2B3A;margin:0;">
        <b>${esc(fmtMoney(d.owed))}</b> is still owed to you on unpaid invoices.
      </p>
    </div>` : ''}

    <p style="margin:22px 0 0;">
      <a href="${APP_URL}/?utm_source=digest&utm_medium=email&utm_campaign=weekly"
         style="display:inline-block;background:#E07B2A;color:#fff;font-weight:700;font-size:15px;padding:12px 20px;border-radius:8px;text-decoration:none;">
        Open JobTally
      </a>
    </p>
    <p style="font-size:11px;color:#94a3b8;margin:18px 0 0;line-height:1.6;">
      You get this once a week because you have jobs running. Don't want it? Just reply to this
      email and I'll switch it off — it comes straight to me.
    </p>
  </div>`
}

export default async function handler(req, res) {
  // Vercel cron calls with `Authorization: Bearer $CRON_SECRET`. Without this
  // check the endpoint is a public button that emails every customer — so it
  // fails CLOSED: no secret configured means nobody can trigger it, including
  // by accident.
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  if (!SUPABASE_URL || !SERVICE_KEY || !process.env.RESEND_API_KEY) {
    console.error('weekly-digest: missing env config')
    return res.status(500).json({ error: 'Not configured' })
  }

  const { weekStartISO, weekEndISO } = currentWeek(new Date())
  let sent = 0, skipped = 0, failed = 0

  try {
    const owners = await sb('profiles?role=eq.owner&select=id,email,full_name')

    for (const owner of owners) {
      if (!owner || !owner.email) { skipped++; continue }
      try {
        const [projects, receipts, changeOrders, invoices] = await Promise.all([
          sb(`projects?owner_id=eq.${owner.id}&select=id,name,budget,stage,is_sample`),
          sb(`receipts?owner_id=eq.${owner.id}&select=project_id,amount,tax_amount,category,purchase_date,created_at`),
          sb(`change_orders?owner_id=eq.${owner.id}&select=project_id,amount,status`),
          sb(`invoices?owner_id=eq.${owner.id}&select=project_id,amount,status`),
        ])

        // time_entries has no owner_id — it hangs off the project.
        const ids = projects.map((p) => p.id)
        const timeEntries = ids.length
          ? await sb(`time_entries?project_id=in.(${ids.join(',')})&select=project_id,labor_cost,total_minutes,clocked_out_at`)
          : []

        const digest = buildDigest({
          projects, receipts, timeEntries, changeOrders, invoices, weekStartISO, weekEndISO,
        })
        if (!digest.hasSomethingToSay) { skipped++; continue }

        const worst = digest.attention[0]
        const subject = worst
          ? `This week: ${fmtMoney(digest.week.total)} out — and ${worst.name} needs a look`
          : `This week: ${fmtMoney(digest.week.total)} out across ${digest.jobs.length} job${digest.jobs.length === 1 ? '' : 's'}`

        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          },
          body: JSON.stringify({
            from: FROM,
            to: owner.email,
            subject: subject.replace(/[\r\n]+/g, ' ').slice(0, 120),
            html: renderEmail(digest, owner.full_name),
          }),
        })
        if (!r.ok) throw new Error(`resend ${r.status} ${await r.text()}`)
        sent++
      } catch (e) {
        // One owner's bad data must never stop everyone else's email.
        failed++
        console.error('weekly-digest: owner failed', owner.id, e && e.message)
      }
    }

    // Tell JP only when something actually went wrong. A clean run is silent —
    // an alert every Friday saying "all fine" trains him to ignore the channel
    // that also carries the real outages.
    if (failed > 0) {
      await alertOwner('weekly-digest', `${failed} weekly digest(s) failed to send`, {
        sent, skipped, failed, week: `${weekStartISO} → ${weekEndISO}`,
      })
    }
    console.log(`weekly-digest: sent=${sent} skipped=${skipped} failed=${failed}`)
    return res.json({ ok: true, sent, skipped, failed })
  } catch (err) {
    console.error('weekly-digest failed:', err)
    await alertOwner('weekly-digest', 'The weekly digest run died before finishing', {
      error: (err && err.message) || String(err), sent, skipped, failed,
    })
    return res.status(500).json({ error: 'Digest run failed' })
  }
}
