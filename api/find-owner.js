// Unauthenticated owner-email → owner-id lookup, used during worker signup
// (the worker isn't logged in yet, so they can't read profiles directly). To
// blunt email enumeration of the owner base, calls are rate-limited per client
// IP via the existing public.rate_limit_hit RPC. The limiter fails OPEN — an
// infra hiccup must never block a legitimate worker from joining.
import crypto from 'crypto'

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

// rate_limits is keyed by uuid; derive a stable uuid-shaped id from the IP.
function ipToUuid(ip) {
  const h = crypto.createHash('sha256').update('find-owner:' + ip).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

async function rateOk(ip) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rate_limit_hit`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_user: ipToUuid(ip),
        p_bucket: 'find_owner',
        p_max: 20,
        p_window_secs: 600, // 20 lookups / 10 min / IP
      }),
    })
    if (!r.ok) return true // fail open: never block a real signup on infra error
    const ok = await r.json()
    return ok !== false
  } catch {
    return true
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { ownerEmail } = req.body
  if (!ownerEmail) return res.status(400).json({ error: 'Missing ownerEmail' })

  const ip =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    (req.socket && req.socket.remoteAddress) ||
    'unknown'
  if (!(await rateOk(ip))) {
    return res.status(429).json({ error: 'Too many lookups, please try again shortly' })
  }

  try {
    // Service role key bypasses RLS — required because the worker is not
    // logged in yet when they sign up, so they can't read profiles directly.
    const url = `${SUPABASE_URL}/rest/v1/profiles` +
      `?email=eq.${encodeURIComponent(ownerEmail)}` +
      `&role=eq.owner&select=id`

    const response = await fetch(url, {
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
    })

    if (!response.ok) throw new Error('Lookup failed')
    const rows = await response.json()

    // Only return the owner id — never any other profile fields.
    if (!rows.length) return res.json({ ownerId: null })
    res.json({ ownerId: rows[0].id })
  } catch (err) {
    console.error('find-owner error:', err)
    res.status(500).json({ error: 'Lookup failed' })
  }
}
