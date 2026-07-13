// Shared per-IP rate-limit helper for the UNAUTHENTICATED service-role
// endpoints (find-owner / resolve-invite / claim-invite / lead email). Files
// beginning with "_" are not routed as functions by Vercel, so this is safe to
// live under api/ and be imported by the real handlers.
//
// It reuses the same public.rate_limit_hit(uuid,...) Postgres counter the authed
// endpoints use — no extra infra. The IP is hashed into a stable uuid-shaped key
// so anonymous callers get a bucket too.
import crypto from 'crypto'

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

// The platform-trusted client IP. NEVER the first X-Forwarded-For hop — that is
// client-supplied and spoofable (a fresh value per request would mint a new
// bucket every call and defeat the cap). Vercel sets x-real-ip to the true
// client IP; the LAST XFF entry is the hop Vercel appended, so it's trustworthy.
export function clientIp(req) {
  const xff = (req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean)
  return (
    (req.headers['x-real-ip'] || '').trim() ||
    (xff.length ? xff[xff.length - 1] : '') ||
    (req.socket && req.socket.remoteAddress) ||
    'unknown'
  )
}

function ipToUuid(prefix, ip) {
  const h = crypto.createHash('sha256').update(prefix + ':' + ip).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

// Returns true if the call is allowed. FAILS OPEN — an infra hiccup must never
// block a legitimate worker signup on these public endpoints.
export async function rateOk(req, bucket, max, windowSecs) {
  if (!SUPABASE_URL || !SERVICE_KEY) return true
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rate_limit_hit`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_user: ipToUuid(bucket, clientIp(req)),
        p_bucket: bucket,
        p_max: max,
        p_window_secs: windowSecs,
      }),
    })
    if (!r.ok) return true
    return (await r.json()) !== false
  } catch {
    return true
  }
}
