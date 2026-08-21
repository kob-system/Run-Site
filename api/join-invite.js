// ONE-TAP CREW JOIN.
//
// The old worker path was: open the texted link -> type your name -> type your
// email -> invent a password -> (if email confirmation is on) leave the app,
// find the email, come back, and sign in AGAIN with the password you just
// invented. Five screens and an inbox trip, all of it asked BEFORE the worker
// has been told a single reason to bother. That is why Josh's crew didn't sign
// up: not confusion, cost.
//
// This endpoint replaces all of it with one tap. The owner already typed the
// worker's name (and often his pay rate) when he made the invite, so the invite
// row already IS the signup form. We:
//   1. create the auth user server-side (service role, email pre-confirmed),
//   2. create the matching profile, linked to the owner, with the pay rate,
//   3. assign him to the owner's job if there's exactly one to be on,
//   4. hand back a one-time magic-link hash the browser redeems for a session.
// The worker types nothing and never sees a password or a confirmation email.
//
// IDENTITY. Supabase auth needs an email address, and a crew member on a job
// site frequently doesn't have one he can check on his phone. So we mint one on
// a subdomain we own and never send mail to it. It exists to be a primary key,
// not a mailbox. The worker can attach a real address later from his own
// screen; nothing in the app needs one before then.
//
// RE-ENTRY. Because there is no password, the invite link itself is the
// credential — re-opening it after it's claimed re-issues a session for the
// SAME worker instead of failing. That is deliberate: "my boss texts me the
// link again" is a recovery story a framer will actually complete, where
// "reset your password" is not. The link is a 122-bit secret in a private text,
// the blast radius is one worker's own timesheet, and the owner can kill it
// from the Workers tab (worker_invites.revoked_at) if a phone walks off.
import { rateOk } from './_ratelimit'

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

// Never receives mail. See IDENTITY above.
const CREW_EMAIL_DOMAIN = 'crew.getjobtally.com'

const svcHeaders = () => ({
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json'
})

function mintCrewEmail() {
  const rand = Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
  return `crew-${rand}@${CREW_EMAIL_DOMAIN}`
}

// A one-time hash the browser redeems with supabase.auth.verifyOtp() to get a
// real session. The admin generate_link endpoint mints it WITHOUT sending any
// email, which is the whole point — no inbox is involved at any step.
async function mintSessionHash(email) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: svcHeaders(),
    body: JSON.stringify({ type: 'magiclink', email })
  })
  if (!r.ok) throw new Error('generate_link failed: ' + (await r.text()).slice(0, 200))
  const data = await r.json()
  const hash = data.hashed_token || (data.properties && data.properties.hashed_token)
  if (!hash) throw new Error('generate_link returned no hashed_token')
  return hash
}

// Put the new hire on a job so his first screen is a Clock In button rather
// than "No jobs assigned yet. Ask your boss to assign you to a job." — which is
// where the old flow dumped every worker who made it through signup, and is a
// terrible payoff for the effort we just asked him to spend.
//
// Only when the choice is unambiguous: exactly ONE real, unfinished job. With
// two we'd be guessing which crew he's on, and guessing wrong puts a worker's
// hours on the wrong job's cost sheet. The sample/tutorial job never counts.
// Best-effort throughout: a worker who lands unassigned is a worse first
// screen, not a broken account, so nothing here may fail the join.
async function autoAssign(ownerId, workerId) {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/projects?owner_id=eq.${ownerId}&select=id,stage,is_sample`,
      { headers: svcHeaders() }
    )
    if (!r.ok) return null
    const rows = await r.json()
    const live = (rows || []).filter(
      p => !p.is_sample && (p.stage == null || p.stage !== 'end')
    )
    if (live.length !== 1) return null
    const ins = await fetch(`${SUPABASE_URL}/rest/v1/project_workers`, {
      method: 'POST',
      headers: { ...svcHeaders(), Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ project_id: live[0].id, worker_id: workerId })
    })
    return ins.ok ? live[0].id : null
  } catch {
    return null
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Server not configured' })

  const { token } = req.body || {}
  if (!token || typeof token !== 'string') return res.status(400).json({ error: 'Missing token' })

  // This endpoint CREATES accounts unauthenticated, so it gets a tighter cap
  // than the read-only resolve. Tokens are unguessable; this bounds abuse of
  // the endpoint itself. Fails open, so a real crew member is never blocked.
  if (!(await rateOk(req, 'join_invite', 20, 600))) {
    return res.status(429).json({ error: 'Too many attempts, please try again shortly' })
  }

  try {
    // Look the invite up in ANY state — an already-claimed one is the re-entry
    // case, not an error. Revoked is the one hard stop.
    const lookup = await fetch(
      `${SUPABASE_URL}/rest/v1/worker_invites?token=eq.${encodeURIComponent(token)}` +
      // select=* so this endpoint works whether or not FIX-DATABASE-31 has
      // been run yet — naming revoked_at before the column exists is a 400,
      // and that would break joining entirely for the length of the gap.
      `&select=*`,
      { headers: svcHeaders() }
    )
    if (!lookup.ok) throw new Error('Invite lookup failed')
    const invite = (await lookup.json())[0]
    if (!invite) return res.json({ ok: false, reason: 'invalid' })
    if (invite.revoked_at) return res.json({ ok: false, reason: 'revoked' })

    // ---- Re-entry: this link has already made an account, so sign that same
    // worker back in. Guarded on the profile still existing AND still being
    // linked to the inviting owner, so a link can never be replayed into a
    // crew the worker was removed from.
    if (invite.used_by) {
      const pr = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?id=eq.${invite.used_by}` +
        `&owner_id=eq.${invite.owner_id}&select=id,email,full_name`,
        { headers: svcHeaders() }
      )
      const existing = pr.ok ? (await pr.json())[0] : null
      // Claimed by a worker who has since been unlinked or deleted: the link is
      // spent and must not silently mint a second account for the same person.
      if (!existing) return res.json({ ok: false, reason: 'used' })
      const tokenHash = await mintSessionHash(existing.email)
      return res.json({
        ok: true,
        returning: true,
        tokenHash,
        workerName: existing.full_name || invite.worker_name || ''
      })
    }

    // Claimed by the OLD email+password flow (used_at stamped, used_by never
    // was, because there was no session at burn time). Nothing here can help
    // that person; they have a real password. Send them to the sign-in form.
    if (invite.used_at) return res.json({ ok: false, reason: 'used' })

    // ---- First claim: build the account.
    const email = mintCrewEmail()
    const fullName = (invite.worker_name || '').trim() || 'Crew member'

    const createResp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: svcHeaders(),
      body: JSON.stringify({
        email,
        // Pre-confirmed: there is no inbox behind this address, and requiring a
        // click on mail nobody can read would lock the account permanently.
        email_confirm: true,
        user_metadata: {
          full_name: fullName,
          role: 'worker',
          owner_id: invite.owner_id,
          // Marks an account with no password and no reachable email, so the
          // app can offer to attach real credentials later instead of assuming
          // a normal signup. Metadata is worker-editable, so this is a UI hint
          // ONLY — nothing security-bearing may ever read it.
          crew_passwordless: true
        }
      })
    })
    if (!createResp.ok) {
      throw new Error('admin create user failed: ' + (await createResp.text()).slice(0, 200))
    }
    const user = await createResp.json()
    if (!user || !user.id) throw new Error('admin create user returned no id')

    // The profile row is what actually tenants this worker to the owner. RLS
    // can't help us here (no session yet), so it's written with the service key
    // from the INVITE row — never from anything the visitor sent us. That's
    // also why the rate rides along here: a worker can't set his own pay.
    const rate = Number(invite.hourly_rate)
    const profileBody = {
      id: user.id,
      email,
      full_name: fullName,
      role: 'worker',
      owner_id: invite.owner_id
    }
    if (Number.isFinite(rate) && rate >= 0 && rate <= 500) profileBody.hourly_rate = rate

    const profResp = await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
      method: 'POST',
      headers: { ...svcHeaders(), Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(profileBody)
    })
    if (!profResp.ok) {
      // Don't strand a half-built account: an auth user with no profile row is
      // the orphaned-session state App.js has a whole recovery screen for.
      await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user.id}`, {
        method: 'DELETE', headers: svcHeaders()
      }).catch(() => {})
      throw new Error('profile insert failed: ' + (await profResp.text()).slice(0, 200))
    }

    // Burn the link for its create-an-account power. It stays valid for
    // re-entry (the used_by branch above) — that's the recovery story.
    await fetch(`${SUPABASE_URL}/rest/v1/worker_invites?id=eq.${invite.id}`, {
      method: 'PATCH',
      headers: { ...svcHeaders(), Prefer: 'return=minimal' },
      body: JSON.stringify({ used_at: new Date().toISOString(), used_by: user.id })
    }).catch(() => {})

    const assignedProjectId = await autoAssign(invite.owner_id, user.id)
    const tokenHash = await mintSessionHash(email)

    res.json({
      ok: true,
      returning: false,
      tokenHash,
      workerName: fullName,
      assigned: !!assignedProjectId
    })
  } catch (err) {
    console.error('join-invite error:', err)
    res.status(500).json({ error: 'Join failed' })
  }
}
