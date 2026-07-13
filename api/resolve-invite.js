// Resolve an owner-generated worker-invite token to the owner it links
// to, for the signup screen. The worker is NOT logged in yet, so this
// runs with the service-role key (bypasses RLS), mirroring find-owner.js.
// Returns only what the signup screen needs — never leaks other fields.
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

    // Look up an UNUSED invite by token.
    const inviteUrl = `${base}/rest/v1/worker_invites` +
      `?token=eq.${encodeURIComponent(token)}` +
      `&used_at=is.null` +
      `&select=owner_id,worker_name`

    const inviteResp = await fetch(inviteUrl, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }
    })
    if (!inviteResp.ok) throw new Error('Invite lookup failed')
    const invites = await inviteResp.json()
    if (!invites.length) return res.json({ valid: false })

    const invite = invites[0]

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
      valid: true,
      ownerId: invite.owner_id,
      workerName: invite.worker_name || '',
      companyName: owner.company_name || owner.full_name || 'your boss'
    })
  } catch (err) {
    console.error('resolve-invite error:', err)
    res.status(500).json({ error: 'Lookup failed' })
  }
}
