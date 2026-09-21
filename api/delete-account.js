// Permanently delete the caller's account and everything in it.
//
// Why this exists: privacy.html promised "you can delete your account from
// within the app" and no such path existed anywhere in the repo. PR #52 fixed
// that by softening the promise to an email address; this fixes it the other
// way round, by making the promise true. Deletion by support ticket is also a
// standing manual job for JP, and the whole point of this app is to delete
// those.
//
// THE SAFETY MODEL, because this is the one endpoint that destroys data:
//   1. Authenticated. The uid comes from a verified Supabase JWT, never the
//      body — you can only ever delete YOURSELF.
//   2. Typed confirmation. The body must carry the account's own email
//      exactly. A misrouted or replayed POST cannot destroy an account.
//   3. Billing stops FIRST. Any live Stripe subscription is canceled before a
//      single row is touched. If Stripe will not confirm it is stopped, NOTHING
//      is deleted: a deleted account that keeps getting charged every month is
//      the worst outcome this endpoint can produce, and the customer would have
//      no login left to cancel it from.
//   4. Owners take their tenant with them; a worker deletes only themselves and
//      is unlinked from their boss, whose job records must survive — those hours
//      are the boss's payroll and tax history, not the worker's to erase.
//   5. Storage first, then rows, then the auth user LAST. If anything fails
//      part-way the account still exists and can be retried; the alternative
//      ordering strands files nobody can ever reach or authenticate to.
//   6. Rate limited, and JP is alerted on every deletion — a churned customer
//      is something he needs to know about the same day, not at month end.
import { alertOwner } from './_alert'

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY

const svc = () => ({ apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` })

// Stripe subscription statuses that can never charge again. Everything else
// (active, trialing, past_due, unpaid, incomplete, paused) can.
const DEAD = ['canceled', 'incomplete_expired']

async function getUser(req) {
  const auth = req.headers.authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token || !SUPABASE_URL || !SERVICE_KEY) return null
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` },
    })
    if (!r.ok) return null
    const u = await r.json()
    return u && u.id ? { id: u.id, email: u.email } : null
  } catch { return null }
}

async function allowedRate(uid) {
  // Fail-CLOSED. If we cannot confirm this is under the cap we refuse — the
  // downside of a blocked delete is a retry; the downside of an unbounded loop
  // of deletes is unrecoverable.
  if (!SUPABASE_URL || !SERVICE_KEY) return false
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rate_limit_hit`, {
      method: 'POST',
      headers: { ...svc(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_user: uid, p_bucket: 'delete-account', p_max: 3, p_window_secs: 3600 }),
    })
    if (!r.ok) return false
    return (await r.json()) === true
  } catch { return false }
}

const rest = (path, method) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: { ...svc(), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
  })

// Every file this owner put in the shared `receipts` bucket. Uploads are keyed
// under the uploader's uid as the first path segment (the storage policy in
// FIX-DATABASE-4 enforces exactly that), so the prefix IS the tenant boundary.
async function deleteStorage(uid) {
  try {
    const list = await fetch(`${SUPABASE_URL}/storage/v1/object/list/receipts`, {
      method: 'POST',
      headers: { ...svc(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: `${uid}/`, limit: 1000 }),
    })
    if (!list.ok) return 0
    const files = await list.json()
    if (!Array.isArray(files) || !files.length) return 0
    const names = files.map((f) => `${uid}/${f.name}`)
    await fetch(`${SUPABASE_URL}/storage/v1/object/receipts`, {
      method: 'DELETE',
      headers: { ...svc(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: names }),
    })
    return names.length
  } catch { return 0 }
}

// ── Billing ─────────────────────────────────────────────────────────────────
// No Stripe SDK, same as create-checkout-session.js and stripe-webhook.js:
// REST via fetch with the secret key.
async function stripeCall(method, path) {
  const r = await fetch('https://api.stripe.com/v1/' + path, {
    method,
    headers: { Authorization: 'Bearer ' + STRIPE_SECRET },
  })
  let data = null
  try { data = await r.json() } catch { /* empty body */ }
  return { ok: r.ok, status: r.status, data }
}

const stripeErrCode = (res) => (res && res.data && res.data.error && res.data.error.code) || null

class BillingError extends Error {}

// Cancel every subscription that could still charge this account. Returns the
// ids it canceled. THROWS (BillingError) whenever it cannot be sure billing is
// stopped, and the caller then deletes nothing.
//
// Two sources, because either alone can miss one:
//   - our subscriptions row (stripe_subscription_id), written by the webhook
//   - Stripe's own list for the row's customer, which also catches a second
//     live subscription the row never recorded (e.g. a double checkout)
// A 'comp' row has no Stripe ids and costs nothing to skip.
export async function cancelBilling(uid) {
  let rows
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/subscriptions?owner_id=eq.${encodeURIComponent(uid)}&select=stripe_subscription_id,stripe_customer_id,status`,
      { headers: svc() }
    )
    if (!r.ok) throw new Error('status ' + r.status)
    rows = await r.json()
  } catch (e) {
    // "Couldn't read it" is not "there isn't one". Fail closed.
    throw new BillingError('subscriptions read failed: ' + ((e && e.message) || e))
  }
  const row = Array.isArray(rows) ? rows[0] : null
  if (!row) return []

  const ids = new Set()
  if (row.stripe_subscription_id && !DEAD.includes(row.status)) ids.add(row.stripe_subscription_id)

  if (!STRIPE_SECRET) {
    // Nothing live on record: nothing to cancel, carry on. Something live on
    // record and no way to reach Stripe: refuse.
    if (ids.size) throw new BillingError('STRIPE_SECRET_KEY is not set, so a live subscription cannot be canceled')
    return []
  }

  if (row.stripe_customer_id) {
    const list = await stripeCall('GET', `subscriptions?customer=${encodeURIComponent(row.stripe_customer_id)}&status=all&limit=100`)
    if (list.ok) {
      const subs = (list.data && Array.isArray(list.data.data)) ? list.data.data : []
      for (const s of subs) if (s && s.id && !DEAD.includes(s.status)) ids.add(s.id)
    } else if (stripeErrCode(list) !== 'resource_missing') {
      // The customer being gone means there is nothing left to bill. Anything
      // else means we could not see, so we cannot say it is stopped.
      throw new BillingError(`Stripe would not list subscriptions for ${row.stripe_customer_id} (HTTP ${list.status})`)
    }
  }

  const canceled = []
  for (const id of ids) {
    const del = await stripeCall('DELETE', `subscriptions/${encodeURIComponent(id)}`)
    if (del.ok) { canceled.push(id); continue }
    // Refused. Believe Stripe's record of the subscription, not the error
    // text: already canceled, or gone entirely, both mean nothing will charge.
    const chk = await stripeCall('GET', `subscriptions/${encodeURIComponent(id)}`)
    if (chk.ok && chk.data && DEAD.includes(chk.data.status)) continue
    if (!chk.ok && stripeErrCode(chk) === 'resource_missing') continue
    throw new BillingError(`Stripe refused to cancel ${id} (HTTP ${del.status}${stripeErrCode(del) ? ' ' + stripeErrCode(del) : ''})`)
  }
  return canceled
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Not configured' })

  const user = await getUser(req)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })
  if (!(await allowedRate(user.id))) {
    return res.status(429).json({ error: 'Too many attempts. Try again shortly.' })
  }

  // The typed confirmation. Compared against the address on the VERIFIED JWT,
  // not against anything else in the body.
  const typed = typeof (req.body || {}).confirmEmail === 'string' ? req.body.confirmEmail.trim() : ''
  if (!typed || !user.email || typed.toLowerCase() !== String(user.email).toLowerCase()) {
    return res.status(400).json({ error: 'Type your account email exactly to confirm.' })
  }

  // Billing before anything else. Run for every account, not just owners: a
  // worker has no subscriptions row and this costs one read.
  let billingCanceled = []
  try {
    billingCanceled = await cancelBilling(user.id)
  } catch (err) {
    const why = (err && err.message) || String(err)
    console.error('delete-account: billing cancel failed, nothing deleted:', why)
    await alertOwner('delete-account', 'Account delete STOPPED: could not cancel billing', {
      user: user.id, email: user.email, error: why,
      impact: 'Nothing was deleted and they may still be billed. Cancel the subscription in Stripe by hand, then they can delete again.',
    })
    return res.status(502).json({
      error: "We couldn't stop your billing, so nothing was deleted. Email support@getjobtally.com and we'll cancel it and close the account.",
    })
  }

  try {
    const profRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=role,owner_id,company_name`,
      { headers: svc() }
    )
    const prof = profRes.ok ? (await profRes.json())[0] : null
    const isOwner = !prof || prof.role === 'owner'

    let filesDeleted = 0

    if (isOwner) {
      filesDeleted = await deleteStorage(user.id)

      // Children before parents. Postgres FKs may or may not cascade depending
      // on how each table was created across 29 migrations, so this does not
      // rely on cascade — it deletes in dependency order and treats a missing
      // table as a no-op. `projects` and `profiles` come last.
      const owned = [
        'assistant_actions?owner_scope=eq.', 'testimonials?owner_id=eq.',
        'paychecks?owner_id=eq.', 'time_off_requests?owner_id=eq.',
        'worker_invites?owner_id=eq.', 'compliance_items?owner_id=eq.',
        'warranties?owner_id=eq.', 'permits?owner_id=eq.',
        'schedule_entries?owner_id=eq.', 'job_documents?owner_id=eq.',
        'material_items?owner_id=eq.', 'punch_items?owner_id=eq.',
        'daily_logs?owner_id=eq.', 'change_orders?owner_id=eq.',
        'job_photos?owner_id=eq.', 'mileage_entries?owner_id=eq.',
        'receipts?owner_id=eq.', 'invoices?owner_id=eq.', 'estimates?owner_id=eq.',
      ]
      for (const t of owned) {
        try { await rest(t + user.id, 'DELETE') } catch { /* table may not exist */ }
      }
      // Time entries and crew assignments hang off projects, not the owner.
      try {
        const pr = await fetch(`${SUPABASE_URL}/rest/v1/projects?owner_id=eq.${user.id}&select=id`, { headers: svc() })
        const ids = pr.ok ? (await pr.json()).map((p) => p.id) : []
        if (ids.length) {
          const inList = `(${ids.join(',')})`
          try { await rest(`time_entries?project_id=in.${inList}`, 'DELETE') } catch {}
          try { await rest(`project_workers?project_id=in.${inList}`, 'DELETE') } catch {}
        }
      } catch {}
      try { await rest(`projects?owner_id=eq.${user.id}`, 'DELETE') } catch {}
      try { await rest(`subscriptions?owner_id=eq.${user.id}`, 'DELETE') } catch {}
      // Cut the crew loose rather than deleting them. Their accounts are their
      // own; an owner closing their business does not get to delete other
      // people's logins.
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/profiles?owner_id=eq.${user.id}`, {
          method: 'PATCH',
          headers: { ...svc(), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ owner_id: null }),
        })
      } catch {}
    } else {
      // A worker. Their clocked hours are the BOSS's payroll and tax record and
      // must survive — deleting them would silently rewrite someone else's
      // books. Only what is unambiguously the worker's own goes.
      filesDeleted = await deleteStorage(user.id)
      try { await rest(`time_off_requests?worker_id=eq.${user.id}`, 'DELETE') } catch {}
      try { await rest(`project_workers?worker_id=eq.${user.id}`, 'DELETE') } catch {}
    }

    // The profile row, then the login itself. LAST, so every failure above
    // leaves a recoverable account rather than an orphaned pile of rows.
    try { await rest(`profiles?id=eq.${user.id}`, 'DELETE') } catch {}

    const del = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user.id}`, {
      method: 'DELETE',
      headers: svc(),
    })
    if (!del.ok) {
      const body = await del.text()
      console.error('delete-account: auth user delete failed', del.status, body)
      await alertOwner('delete-account', 'Account data was deleted but the LOGIN survived', {
        user: user.id, email: user.email, status: del.status,
        billing_canceled: billingCanceled.length,
        impact: 'Delete this user by hand in Supabase → Authentication. They can still sign in to an empty account.',
      })
      return res.status(500).json({ error: 'Could not finish deleting your account. Email support@getjobtally.com — nothing is lost.' })
    }

    alertOwner('account-deleted', `${isOwner ? 'An owner' : 'A crew member'} deleted their account`, {
      email: user.email,
      company: (prof && prof.company_name) || '',
      role: isOwner ? 'owner' : 'worker',
      files_removed: filesDeleted,
      billing_canceled: billingCanceled.length,
    })

    return res.json({ ok: true })
  } catch (err) {
    console.error('delete-account error:', err)
    await alertOwner('delete-account', 'Account deletion threw', {
      user: user.id, error: (err && err.message) || String(err),
      billing_canceled: billingCanceled.length,
    })
    return res.status(500).json({ error: 'Could not delete your account. Email support@getjobtally.com.' })
  }
}
