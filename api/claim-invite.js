// Mark a worker-invite token used once the invited worker has signed
// up. Best-effort: called right after signUp succeeds. Runs with the
// service-role key because the brand-new worker may not have a session
// yet (email-confirmation case). Idempotent — only flips an unused row.
//
// The invite `token` is a secret (random, only in the invite link), so it is
// the primary gate: you can only burn an invite you already possess. The one
// thing we DON'T trust from the client is who used it — `used_by` is derived
// from a verified Supabase JWT when the caller has a session, and left null
// otherwise, so a caller can't stamp an arbitrary uuid as the user.
import { rateOk } from './_ratelimit'

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

async function verifiedUserId(req) {
  const auth = req.headers.authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token || !SUPABASE_URL || !SERVICE_KEY) return null
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` },
    })
    if (!r.ok) return null
    const u = await r.json()
    return u && u.id ? u.id : null
  } catch { return null }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { token } = req.body || {}
  if (!token || typeof token !== 'string') return res.status(400).json({ error: 'Missing token' })

  // Per-IP throttle on the unauth service-role write. Fails open.
  if (!(await rateOk(req, 'claim_invite', 30, 600))) {
    return res.status(429).json({ error: 'Too many attempts, please try again shortly' })
  }

  try {
    const base = SUPABASE_URL
    const key = SERVICE_KEY

    // Trust the session, not the request body, for used_by. Null when the
    // worker has no session yet (email-confirmation case) — the invite is
    // still burned so the link can't be reused.
    const usedBy = await verifiedUserId(req)

    const url = `${base}/rest/v1/worker_invites` +
      `?token=eq.${encodeURIComponent(token)}` +
      `&used_at=is.null`

    const resp = await fetch(url, {
      method: 'PATCH',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({
        used_at: new Date().toISOString(),
        used_by: usedBy
      })
    })

    if (!resp.ok) throw new Error('Claim failed')
    res.json({ ok: true })
  } catch (err) {
    console.error('claim-invite error:', err)
    // Non-fatal for the worker — they're already signed up + linked.
    res.status(500).json({ error: 'Claim failed' })
  }
}
