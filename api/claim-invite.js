// Mark a worker-invite token used once the invited worker has signed
// up, and apply the pay rate the owner set on that invite. Best-effort:
// called right after signUp succeeds (and again on first sign-in for the
// email-confirmation flow, where the profile doesn't exist yet at signUp
// time). Runs with the service-role key because the brand-new worker may
// not have a session yet.
//
// The invite `token` is a secret (random, only in the invite link), so it is
// the primary gate: you can only burn an invite you already possess. The one
// thing we DON'T trust from the client is who used it — `used_by` is derived
// from a verified Supabase JWT when the caller has a session, and left null
// otherwise, so a caller can't stamp an arbitrary uuid as the user.
//
// The rate is read from the invite ROW (owner-written, service-key read) —
// never from anything the signing-up worker can set — so a crew member can't
// inflate their own pay by editing signup metadata. It is only applied to a
// profile that (a) belongs to the verified caller, (b) is already linked to
// the invite's owner, and (c) has no rate yet, which makes a replay of the
// token a no-op instead of a way to reset a rate the owner later changed.
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
    const svc = { apikey: key, Authorization: `Bearer ${key}` }

    // Trust the session, not the request body, for used_by. Null when the
    // worker has no session yet (email-confirmation case) — the invite is
    // still burned so the link can't be reused.
    const usedBy = await verifiedUserId(req)

    // Look the invite up in ANY state. The email-confirmation flow calls this
    // twice: once at signUp (no session, burns the link) and once on first
    // sign-in (session + profile exist, so the rate can finally be applied).
    const lookup = await fetch(
      `${base}/rest/v1/worker_invites?token=eq.${encodeURIComponent(token)}` +
      `&select=id,owner_id,hourly_rate,used_at,used_by`,
      { headers: svc }
    )
    if (!lookup.ok) throw new Error('Invite lookup failed')
    const rows = await lookup.json()
    const invite = rows && rows[0]
    if (!invite) return res.json({ ok: true, applied: false })

    // Burn it (first call), and stamp used_by the first time we know who.
    const patch = {}
    if (!invite.used_at) patch.used_at = new Date().toISOString()
    if (!invite.used_by && usedBy) patch.used_by = usedBy
    if (Object.keys(patch).length) {
      const resp = await fetch(
        `${base}/rest/v1/worker_invites?id=eq.${invite.id}`,
        { method: 'PATCH', headers: { ...svc, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(patch) }
      )
      if (!resp.ok) throw new Error('Claim failed')
    }

    // Apply the owner's pay rate to the worker who just joined.
    let applied = false
    if (usedBy && invite.hourly_rate != null) {
      const rate = Number(invite.hourly_rate)
      if (Number.isFinite(rate) && rate >= 0 && rate <= 500) {
        const upd = await fetch(
          `${base}/rest/v1/profiles?id=eq.${usedBy}` +
          `&owner_id=eq.${invite.owner_id}` +
          `&or=(hourly_rate.is.null,hourly_rate.eq.0)` +
          `&select=id`,
          {
            method: 'PATCH',
            headers: { ...svc, 'Content-Type': 'application/json', Prefer: 'return=representation' },
            body: JSON.stringify({ hourly_rate: rate }),
          }
        )
        if (upd.ok) {
          const changed = await upd.json().catch(() => [])
          applied = Array.isArray(changed) && changed.length > 0
        }
      }
    }

    res.json({ ok: true, applied })
  } catch (err) {
    console.error('claim-invite error:', err)
    // Non-fatal for the worker — they're already signed up + linked.
    res.status(500).json({ error: 'Claim failed' })
  }
}
