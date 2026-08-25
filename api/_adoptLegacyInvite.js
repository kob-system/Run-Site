// THE WORKERS WHO SIGNED UP BEFORE ONE-TAP EXISTED.
//
// Josh reported it on 2026-08-25: his crew tap the link he texted them and land
// on the LOGIN PAGE, with a password nobody remembers and an email address on a
// jobsite phone nobody reads. From his seat the app had just locked out the
// people already using it.
//
// Here is the whole mechanism. The OLD signup flow (api/claim-invite.js, called
// from Login.js) ran at `supabase.auth.signUp()` — and with email confirmation
// on, there is no session at that moment. So it could stamp `used_at` but had
// nobody verified to stamp `used_by` with:
//
//     if (!invite.used_at) patch.used_at = now
//     if (!invite.used_by && usedBy) patch.used_by = usedBy   // usedBy was null
//
// Every one of those invites is therefore `used_at` set, `used_by` NULL. And
// `resolve-invite` reads exactly that shape as "burned by the old flow, that
// person has real credentials, nothing to rejoin" and answers `valid: false`.
// The crew screen then shows "This link has expired" whose only button is
// "I already have a login" — which is the login page in Josh's photo.
//
// The reasoning was right when it was written and wrong in the field: those
// workers have credentials in theory and not in practice.
//
// WHAT THIS DOES. Given such an invite, find the worker it must have made and
// adopt him: backfill `used_by` so the row becomes a normal rejoinable invite,
// and from then on the link behaves like every other crew link. Self-healing —
// it runs once per stale invite and never again.
//
// WHY IT IS SAFE. It only ever adopts a profile that is already a `worker`
// already linked to THIS invite's `owner_id`, so nothing here can move a person
// between crews or reach an owner account. And it requires EXACTLY ONE name
// match: with two Mikes on the crew we would be guessing which man's timesheet
// to hand over, and guessing wrong is worse than the dead link we are fixing.
//
// The trust model is unchanged. Holding the token already signs a claimed link's
// worker back in (that is the documented no-password recovery path). This just
// extends it to the workers who joined a week too early.

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const svc = () => ({
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json'
})

// Compare the way a person would, not the way a database would. The owner typed
// the name into the invite form and the worker typed it again at signup, so
// "  mike  reilly" and "Mike Reilly" are the same man.
const norm = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ')

/**
 * Adopt the worker an old-flow invite created, if we can identify him beyond
 * doubt. Returns the profile ({ id, email, full_name }) on success, or null —
 * null always means "leave the invite exactly as it was".
 *
 * Best-effort by design: every failure path returns null rather than throwing,
 * because this runs inside the join path and a lookup hiccup must never be the
 * reason a crew member can't get to his hours.
 */
export async function adoptLegacyInvite(invite) {
  try {
    if (!invite || !invite.used_at || invite.used_by) return null
    const wanted = norm(invite.worker_name)
    if (!wanted) return null

    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles` +
      `?owner_id=eq.${invite.owner_id}&role=eq.worker` +
      `&select=id,email,full_name`,
      { headers: svc() }
    )
    if (!r.ok) return null
    const crew = await r.json()

    const matches = (crew || []).filter(p => norm(p.full_name) === wanted)
    // Zero: he never finished signup, or changed his name. Two or more: we would
    // be guessing which man's timesheet to hand over. Both fall through to the
    // old behaviour, which is a dead link and a "ask your boss for a new one".
    if (matches.length !== 1) return null
    const worker = matches[0]

    // Backfill used_by so this heals permanently. If the PATCH fails we still
    // return the worker — signing him in now matters more than the bookkeeping,
    // and the next tap simply tries the adoption again.
    await fetch(`${SUPABASE_URL}/rest/v1/worker_invites?id=eq.${invite.id}`, {
      method: 'PATCH',
      headers: { ...svc(), Prefer: 'return=minimal' },
      body: JSON.stringify({ used_by: worker.id })
    }).catch(() => {})

    return worker
  } catch {
    return null
  }
}
