// A crew member with no job assigned taps "Ask my boss to put me on a job" and
// this emails the owner. It exists because that line used to be the LABEL on a
// disabled Clock In button — the worker read it as an instruction, tapped it,
// and got a no-entry cursor and silence. Now the tap does the thing it says.
//
// Same trust model as notify-owner.js: the worker's name and their owner are
// resolved SERVER-SIDE from the authenticated token, never from the body, so
// nobody can make this email land in a stranger's inbox or claim a name that
// is not theirs. The only user text is an optional one-line note, capped and
// HTML-escaped.
const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const FROM = process.env.RESEND_FROM || 'JobTally <noreply@getjobtally.com>'
const APP_URL = process.env.PUBLIC_APP_URL || 'https://getjobtally.com'

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
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
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` }
    })
    if (!r.ok) return null
    const u = await r.json()
    return u && u.id ? u.id : null
  } catch { return null }
}

// Three a day is plenty for "put me on something" and stops a bored crew
// member (or a retry loop) from burying an owner's inbox. FAILS CLOSED here,
// unlike the clock-in notifier: a missed nudge costs nothing, and this is the
// one worker-triggered email with no shift behind it.
async function allowedRate(uid) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rate_limit_hit`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_user: uid, p_bucket: 'request-assignment', p_max: 3, p_window_secs: 86400 })
    })
    if (!r.ok) return true
    return (await r.json()) !== false
  } catch { return true }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ success: false, error: 'Server misconfigured' })
  if (!process.env.RESEND_API_KEY) return res.status(500).json({ success: false, error: 'Email not configured' })

  const workerId = await getUserId(req)
  if (!workerId) return res.status(401).json({ success: false, error: 'Unauthorized' })

  if (!(await allowedRate(workerId))) {
    return res.status(429).json({ success: false, error: "You've already asked a few times today. Give him a chance to see it." })
  }

  const rawNote = (req.body && typeof req.body.note === 'string') ? req.body.note.trim().slice(0, 140) : ''

  try {
    const workerRows = await sbGet(`profiles?id=eq.${encodeURIComponent(workerId)}&select=full_name,owner_id`)
    const worker = workerRows && workerRows[0]
    if (!worker || !worker.owner_id) {
      return res.status(200).json({ success: false, error: "You're not linked to a boss yet, so there's no one to send this to." })
    }

    const ownerRows = await sbGet(`profiles?id=eq.${encodeURIComponent(worker.owner_id)}&select=email,full_name`)
    const ownerEmail = ownerRows && ownerRows[0] && ownerRows[0].email
    if (!ownerEmail) return res.status(200).json({ success: false, error: 'Owner email not found' })

    const workerName = esc(worker.full_name || 'A crew member')
    const note = esc(rawNote)
    const subject = `${workerName} is waiting on a job assignment`.replace(/[\r\n]+/g, ' ')

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      body: JSON.stringify({
        from: FROM,
        to: ownerEmail,
        subject,
        html: `
          <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto; padding: 24px;">
            <h2 style="color: #1C2B3A; margin-bottom: 8px;">JobTally</h2>
            <div style="background: #f4f6f9; border-radius: 12px; padding: 20px; margin-top: 16px;">
              <p style="font-size: 18px; font-weight: 700; color: #1C2B3A; margin: 0 0 6px;">${workerName} can't clock in yet.</p>
              <p style="font-size: 14px; color: #4B5563; margin: 0 0 14px; line-height: 1.5;">He isn't on a job, so his Clock In button is off. Put him on one and it turns on by itself &mdash; he doesn't have to do anything.</p>
              ${note ? `<p style="font-size: 14px; color: #1C2B3A; background: #ffffff; border-left: 3px solid #E07B2A; padding: 10px 12px; margin: 0 0 14px;">&ldquo;${note}&rdquo;</p>` : ''}
              <p style="margin: 0;"><a href="${APP_URL}" style="display: inline-block; background: #E07B2A; color: #ffffff; text-decoration: none; padding: 12px 20px; border-radius: 8px; font-size: 15px; font-weight: 700;">Assign him a job</a></p>
              <p style="font-size: 13px; color: #888; margin: 16px 0 0;">Crew &rarr; tap his name &rarr; Assign to a job.</p>
            </div>
          </div>
        `
      })
    })

    if (!response.ok) {
      const body = await response.text()
      console.error('Resend error', response.status, body)
      return res.status(200).json({ success: false, error: 'Email failed' })
    }
    res.status(200).json({ success: true })
  } catch (err) {
    console.error('request-assignment error:', err)
    res.status(200).json({ success: false, error: 'Could not send that. Try again.' })
  }
}
