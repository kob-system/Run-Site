// The welcome email. Sent once, the moment an account actually exists.
//
// Called by App.js at the exact point the profiles row is inserted — which
// happens once per account, on both signup paths (instant and, if email
// confirmation is ever turned back on, first sign-in). That is the honest
// definition of "signed up", and it is why there is no separate flag column:
// the caller is already once-per-account.
//
// The rate limiter is the belt to that suspenders. A double-mount, a refresh
// mid-insert or a retry can call this twice; rate_limit_hit() caps it at one
// send per user per day, so the worst case is a no-op, never a second email.
//
// Two different letters, because two different people sign up here:
//   owner  — here is the one thing to do first, and here is how your crew gets in
//   worker — you are on <company>'s crew, your link IS your login, do not lose it
import { send, shell, esc, APP_URL } from './_email'

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  })
  if (!r.ok) throw new Error('Supabase lookup failed: ' + r.status)
  return r.json()
}

async function getUserId(req) {
  const auth = req.headers.authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token) return null
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` },
    })
    if (!r.ok) return null
    const u = await r.json()
    return u && u.id ? u.id : null
  } catch { return null }
}

// One welcome per user per day. Fails CLOSED, unlike the clock-in limiter:
// there, a blocked send costs an owner a notification; here, an unbounded send
// is a mail loop pointed at a customer.
async function firstTimeToday(uid) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rate_limit_hit`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_user: uid, p_bucket: 'welcome-email', p_max: 1, p_window_secs: 86400 }),
    })
    if (!r.ok) return false
    return (await r.json()) === true
  } catch { return false }
}

function ownerLetter(firstName) {
  return {
    subject: 'Your JobTally account is open — start here',
    html: shell({
      heading: `You're in${firstName ? ', ' + esc(firstName) : ''}.`,
      lead:
        "There's already a finished sample job in your dashboard so you can see what the numbers look like before you type anything. Poke at it, then delete it. It never counts toward your totals.",
      hero: '1 job',
      heroLabel: 'free, forever, no card',
      rows: [
        ['Do first', 'Text your guy his invite link'],
        ['Then', 'Make your real job'],
        ['Then', 'Put him on it, and snap one receipt'],
      ],
      cta: 'Open JobTally',
      ctaHref: APP_URL,
      foot:
        'Your crew never types a password. You make a link, you text it to them, they tap it once and they are on the clock. ' +
        'Stuck on anything, hit the mic in the app and just say it, or reply straight to this email and it comes to me. <strong>John Paul, JobTally</strong>',
    }),
  }
}

function workerLetter(firstName, company) {
  return {
    subject: `You're on ${company || 'the'} crew on JobTally`,
    html: shell({
      heading: `You're set up${firstName ? ', ' + esc(firstName) : ''}.`,
      lead:
        `${esc(company || 'Your boss')} put you on JobTally. It is one big Clock In button and nothing else you have to learn.`,
      rows: [
        ['To clock in', 'Open the link your boss texted you'],
        ['Password', 'There is none. The link is your login'],
        ['Save it', 'Put it on your home screen so you never hunt for it'],
      ],
      cta: 'Open JobTally',
      ctaHref: APP_URL,
      foot:
        '<strong>Do not delete that text.</strong> If you lose the link, ask your boss to send it again, or go to ' +
        `<a href="${esc(APP_URL)}/crew" style="color:#E07B2A;">getjobtally.com/crew</a> and we will help you find it.`,
    }),
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  // A missing config must never be loud here — the account was already created
  // and the customer is looking at their dashboard. Say ok, log the truth.
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('welcome: server misconfigured')
    return res.json({ sent: false })
  }

  const uid = await getUserId(req)
  if (!uid) return res.status(401).json({ sent: false })

  try {
    if (!(await firstTimeToday(uid))) return res.json({ sent: false, duplicate: true })

    const rows = await sbGet(
      `profiles?id=eq.${encodeURIComponent(uid)}&select=email,full_name,role,company_name,owner_id`
    )
    const me = rows && rows[0]
    if (!me || !me.email) return res.json({ sent: false })

    const firstName = String(me.full_name || '').trim().split(/\s+/)[0] || ''

    let letter
    if (me.role === 'worker') {
      // The company name lives on the OWNER's row, not the worker's.
      let company = ''
      if (me.owner_id) {
        try {
          const o = await sbGet(`profiles?id=eq.${encodeURIComponent(me.owner_id)}&select=company_name`)
          company = (o && o[0] && o[0].company_name) || ''
        } catch { /* the letter reads fine without it */ }
      }
      letter = workerLetter(firstName, company)
    } else {
      letter = ownerLetter(firstName)
    }

    const ok = await send({ to: me.email, subject: letter.subject, html: letter.html })
    return res.json({ sent: ok })
  } catch (err) {
    console.error('welcome error:', err)
    return res.json({ sent: false })
  }
}
