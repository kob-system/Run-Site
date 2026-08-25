// Emails the owner when their worker clocks in/out. Requires an authenticated
// worker; the worker's name, their owner, and the job name are ALL resolved
// server-side from trusted data (never the request body), so the email can't be
// spoofed, and user-controlled text is HTML-escaped as defense in depth.
const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const FROM = process.env.RESEND_FROM || 'JobTally <noreply@getjobtally.com>'

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
    // Allow unless the limiter explicitly denies. Matches find-owner's
    // `!== false` convention so an unexpected payload shape never silently
    // blocks a legitimate clock-in notification.
    return (await r.json()) !== false
  } catch { return true }
}

// The worker's phone sends its IANA zone. Anything Intl doesn't recognise falls
// back to Eastern rather than throwing — a bad string must never cost an email.
function safeZone(tz) {
  if (typeof tz !== 'string' || !/^[A-Za-z0-9_+\-/]{3,64}$/.test(tz)) return 'America/New_York'
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return tz
  } catch { return 'America/New_York' }
}

// Null coords are the normal case, not an error: GPS never blocks a punch, so a
// basement clock-in legitimately has none. Returning '' makes the email say so.
function mapLink(lat, lng) {
  if (typeof lat !== 'number' || typeof lng !== 'number') return ''
  if (!isFinite(lat) || !isFinite(lng)) return ''
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return ''
  return `https://www.google.com/maps?q=${lat},${lng}`
}

function formatWorked(mins) {
  if (typeof mins !== 'number' || !isFinite(mins) || mins < 0) return ''
  const h = Math.floor(mins / 60)
  const m = Math.round(mins % 60)
  if (!h) return `${m}m`
  return m ? `${h}h ${m}m` : `${h}h`
}

// The shift this notification is about. clientId narrows it to the exact row,
// but it stays scoped to worker_id + owner's project either way, so a forged
// clientId can only ever name a shift the caller already owns.
async function latestShift(workerId, projectId, clientId) {
  try {
    let q = `time_entries?worker_id=eq.${encodeURIComponent(workerId)}&select=gps_lat,gps_lng,gps_out_lat,gps_out_lng,total_minutes&order=clocked_in_at.desc&limit=1`
    if (clientId && typeof clientId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(clientId)) {
      q += `&client_id=eq.${encodeURIComponent(clientId)}`
    } else if (projectId) {
      q += `&project_id=eq.${encodeURIComponent(projectId)}`
    }
    const rows = await sbGet(q)
    return (rows && rows[0]) || null
  } catch { return null }
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

  const { projectId, action, timestamp, tz, clientId } = req.body || {}
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

    // getjobtally.com is a verified Resend sending domain, so alerts go straight
    // to the real owner. (The old NOTIFY_OVERRIDE_TO test hatch existed only
    // because onboarding@resend.dev could deliver to one address — it's gone.)
    const recipient = ownerEmail

    let jobName = 'a job'
    if (projectId) {
      // Tenant-scope: only resolve the name if the project belongs to THIS worker's owner,
      // so an authenticated worker can't read an arbitrary project's name by guessing a UUID.
      const projRows = await sbGet(`projects?id=eq.${encodeURIComponent(projectId)}&owner_id=eq.${encodeURIComponent(worker.owner_id)}&select=name`)
      if (projRows && projRows[0] && projRows[0].name) jobName = projRows[0].name
    }

    const workerName = worker.full_name || 'A worker'
    const ts = timestamp ? new Date(timestamp) : new Date()
    // This function runs on Vercel, whose clock is UTC. Formatting without a
    // zone emailed Josh "12:02 PM" for an 8:02 AM punch all summer. The zone
    // comes from the WORKER's phone, which is the one standing on the jobsite.
    const time = isNaN(ts.getTime())
      ? ''
      : ts.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: safeZone(tz) })
    const verb = action === 'out' ? 'clocked out of' : 'clocked in on'
    const subject = `${esc(workerName)} ${action === 'out' ? 'clocked out' : 'clocked in'} — ${esc(jobName)}`.replace(/[\r\n]+/g, ' ')
    const line = `${esc(workerName)} ${verb} ${esc(jobName)}${time ? ` at ${esc(time)}` : ''}.`

    // The shift row, read server-side, is where the location and the hours live.
    // The client never gets to assert either one — it only says which shift.
    const shift = await latestShift(workerId, projectId, clientId)
    const pin = action === 'out'
      ? mapLink(shift && shift.gps_out_lat, shift && shift.gps_out_lng)
      : mapLink(shift && shift.gps_lat, shift && shift.gps_lng)
    const worked = action === 'out' ? formatWorked(shift && shift.total_minutes) : ''

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
              ${worked ? `<p style="font-size: 34px; font-weight: 800; color: #E07B2A; margin: 14px 0 2px; line-height: 1;">${worked}</p>
              <p style="font-size: 13px; color: #888; margin: 0 0 8px;">on the job</p>` : ''}
              ${pin ? `<p style="margin: 14px 0 0;"><a href="${pin}" style="display: inline-block; background: #1C2B3A; color: #ffffff; text-decoration: none; padding: 11px 18px; border-radius: 8px; font-size: 15px; font-weight: 700;">&#128205; See where he ${action === 'out' ? 'finished' : 'started'}</a></p>`
                    : `<p style="font-size: 13px; color: #B45309; margin: 12px 0 0;">No location on this punch &mdash; his phone couldn't get a fix.</p>`}
              <p style="font-size: 14px; color: #888; margin: 14px 0 0;">Logged automatically by JobTally</p>
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
