// Resolve an owner-generated worker-invite token to the owner it links
// to, for the crew-invite screen. The worker is NOT logged in yet, so this
// runs with the service-role key (bypasses RLS), mirroring find-owner.js.
// Returns only what that screen needs — never leaks other fields.
//
// Three states, not two, since one-tap join (api/join-invite.js) made a spent
// link keep working:
//   valid      — never claimed. Tapping it creates the account.
//   rejoinable — already claimed by a worker who is still on this crew.
//                Tapping it signs that same worker back in. This is the
//                no-password recovery path, so it must NOT read "dead link".
//   neither    — revoked by the owner, or claimed by someone since removed.
// `valid` keeps its old meaning exactly, because Login.js still gates the
// email+password fallback form on it.
import { rateOk } from './_ratelimit'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { token } = req.body || {}
  if (!token || typeof token !== 'string') return res.status(400).json({ error: 'Missing token' })

  // Defense-in-depth per-IP throttle. Tokens are 122-bit random (unguessable),
  // so this isn't a brute-force block — it caps enumeration/abuse of the
  // unauth service-role endpoint. Fails open, so a real signup is never blocked.
  if (!(await rateOk(req, 'resolve_invite', 30, 600))) {
    return res.status(429).json({ error: 'Too many attempts, please try again shortly' })
  }

  try {
    const base = process.env.REACT_APP_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY

    // Look the invite up in ANY state — "already used" is the re-entry case
    // now, not a failure, and only the row itself can tell us which.
    // select=* on purpose: naming revoked_at is a 400 until FIX-DATABASE-31
    // has been applied, which would take every live invite link down in the
    // gap between deploying and running the SQL. Undefined reads as "not
    // revoked", so this works identically before and after the migration.
    const inviteUrl = `${base}/rest/v1/worker_invites` +
      `?token=eq.${encodeURIComponent(token)}` +
      `&select=*`

    const inviteResp = await fetch(inviteUrl, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }
    })
    if (!inviteResp.ok) throw new Error('Invite lookup failed')
    const invites = await inviteResp.json()
    if (!invites.length) return res.json({ valid: false })

    const invite = invites[0]

    // Revoked is a hard stop in every flow — the owner killed this link.
    if (invite.revoked_at) return res.json({ valid: false, revoked: true })

    // Spent links are rejoinable only while the worker they made is still on
    // this owner's crew. Once he's removed the link is inert: it must not
    // resurrect an unlinked account or mint a second one.
    let rejoinable = false
    let claimedName = ''
    if (invite.used_by) {
      const claimedResp = await fetch(
        `${base}/rest/v1/profiles?id=eq.${invite.used_by}` +
        `&owner_id=eq.${invite.owner_id}&select=full_name`,
        { headers: { apikey: key, Authorization: `Bearer ${key}` } }
      )
      const claimed = claimedResp.ok ? await claimedResp.json() : []
      rejoinable = claimed.length > 0
      claimedName = (claimed[0] && claimed[0].full_name) || ''
    }

    // Burned by the OLD email+password flow (used_at set, used_by never was):
    // that person has real credentials, so there is nothing to rejoin.
    if (invite.used_at && !rejoinable) return res.json({ valid: false })

    // Fetch the owner's company name so the signup screen can say who
    // invited them ("First Class invited you").
    const ownerUrl = `${base}/rest/v1/profiles` +
      `?id=eq.${invite.owner_id}` +
      `&select=company_name,full_name`
    const ownerResp = await fetch(ownerUrl, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }
    })
    const owners = ownerResp.ok ? await ownerResp.json() : []
    const owner = owners[0] || {}

    res.json({
      // Unclaimed AND not revoked. Login.js's fallback form keys off this.
      valid: !invite.used_at,
      rejoinable,
      ownerId: invite.owner_id,
      // WHO already claimed this link. The signed-in invite screen needs it to
      // answer the only question that matters there: is the person holding this
      // phone the same person the link belongs to? Without it, a worker who taps
      // his own link on a phone that still has his session gets told the link is
      // dead — which is what Josh's crew was told, every day, until this shipped.
      usedBy: invite.used_by || null,
      workerName: claimedName || invite.worker_name || '',
      companyName: owner.company_name || owner.full_name || 'your boss'
    })
  } catch (err) {
    console.error('resolve-invite error:', err)
    res.status(500).json({ error: 'Lookup failed' })
  }
}
