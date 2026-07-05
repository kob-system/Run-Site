// Emails the owner when their worker clocks in/out. Requires an authenticated
// worker; the worker's name, their owner, and the job name are ALL resolved
// server-side from trusted data (never the request body), so the email can't be
// spoofed, and user-controlled text is HTML-escaped as defense in depth.
const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const FROM = process.env.RESEND_FROM || 'JobTally <onboarding@resend.dev>'

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

// Per-user rate limit via the rate_limit_hit() Postgres function (no extra infra).
// Returns true if allowed. FAILS OPEN so an infra hiccup never blocks a real clock-in.
async function allowedRate(uid, bucket, max, windowSecs) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rate_limit_hit`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_user: uid, p_bucket: bucket, p_max: max, p_window_secs: windowSecs })
    })
    if (!r.ok) return true
    return (await r.json()) === true
  } catch { return true }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  if (!SUPABASE_URL || !SERVICE_KEY) return res.json({ success: false, error: 'Server misconfigured' })
  if (!process.env.RESEND_API_KEY) return res.json({ success: false, error: 'Email not configured' })

  const workerId = await getUserId(req)
  if (!workerId) return res.status(401).json({ success: false, error: 'Unauthorized' })

  // Cap at 60 clock-in/out emails per hour per worker — far above any honest crew
  // day, but stops a loop from spamming an owner's inbox.
  if (!(await allowedRate(workerId, 'notify-owner', 60, 3600))) {
    return res.status(429).json({ success: false, error: 'Too many notifications. Please slow down.' })
  }

  const { projectId, action, timestamp } = req.body || {}
  if (action !== 'in' && action !== 'out') {
    return res.status(400).json({ error: 'invalid action' })
  }

  try {
    // Worker (name + their owner) resolved from the AUTHENTICATED id, not the body.
    const workerRows = await sbGet(`profiles?id=eq.${encodeURIComponent(workerId)}&select=full_name,owner_id`)
    const worker = workerRows && workerRows[0]
    if (!worker || !worker.owner_id) return res.json({ success: false, error: 'No linked owner' })

    const ownerRows = await sbGet(`profiles?id=eq.${encodeURIComponent(worker.owner_id)}&select=email`)
    const ownerEmail = ownerRows && ownerRows[0] && ownerRows[0].email
    if (!ownerEmail) return res.json({ success: false, error: 'Owner email not found' })

    // TEMP (until a Resend sending domain is verified): onboarding@resend.dev can only
    // deliver to the Resend account's own email. Set NOTIFY_OVERRIDE_TO in Vercel to that
    // address to route every alert there for testing; remove it once a domain is verified
    // so alerts go to the real owners.
    const recipient = process.env.NOTIFY_OVERRIDE_TO || ownerEmail
    const testNote = process.env.NOTIFY_OVERRIDE_TO
      ? `<p style="font-size:12px;color:#888;margin:8px 0 0;">Test mode — originally addressed to ${esc(ownerEmail)}.</p>`
      : ''

    let jobName = 'a job'
    if (projectId) {
      // Tenant-scope: only resolve the name if the project belongs to THIS worker's owner,
      // so an authenticated worker can't read an arbitrary project's name by guessing a UUID.
      const projRows = await sbGet(`projects?id=eq.${encodeURIComponent(projectId)}&owner_id=eq.${encodeURIComponent(worker.owner_id)}&select=name`)
      if (projRows && projRows[0] && projRows[0].name) jobName = projRows[0].name
    }

    const workerName = worker.full_name || 'A worker'
    const ts = timestamp ? new Date(timestamp) : new Date()
    const time = isNaN(ts.getTime())
      ? ''
      : ts.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    const verb = action === 'out' ? 'clocked out of' : 'clocked in on'
    const subject = `${esc(workerName)} ${action === 'out' ? 'clocked out' : 'clocked in'} — ${esc(jobName)}`.replace(/[\r\n]+/g, ' ')
    const line = `${esc(workerName)} ${verb} ${esc(jobName)}${time ? ` at ${esc(time)}` : ''}.`

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`
      },
      body: JSON.stringify({
        from: FROM,
        to: recipient,
        subject,
        html: `
          <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto; padding: 24px;">
            <h2 style="color: #1C2B3A; margin-bottom: 8px;">JobTally</h2>
            <div style="background: #f4f6f9; border-radius: 12px; padding: 20px; margin-top: 16px;">
              <p style="font-size: 18px; font-weight: 700; color: #1C2B3A; margin: 0 0 8px;">${line}</p>
              <p style="font-size: 14px; color: #888; margin: 0;">Logged automatically by JobTally</p>${testNote}
            </div>
          </div>
        `
      })
    })

    if (!response.ok) {
      const body = await response.text()
      console.error('Resend error', response.status, body)
      return res.json({ success: false, error: 'Email failed' })
    }
    res.json({ success: true })
  } catch (err) {
    console.error('notify-owner error:', err)
    res.json({ success: false, error: 'Notify failed' })
  }
}
