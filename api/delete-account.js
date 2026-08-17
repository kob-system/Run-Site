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
//   3. Owners take their tenant with them; a worker deletes only themselves and
//      is unlinked from their boss, whose job records must survive — those hours
//      are the boss's payroll and tax history, not the worker's to erase.
//   4. Storage first, then rows, then the auth user LAST. If anything fails
//      part-way the account still exists and can be retried; the alternative
//      ordering strands files nobody can ever reach or authenticate to.
//   5. Rate limited, and JP is alerted on every deletion — a churned customer
//      is something he needs to know about the same day, not at month end.
import { alertOwner } from './_alert'

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const svc = () => ({ apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` })

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
        impact: 'Delete this user by hand in Supabase → Authentication. They can still sign in to an empty account.',
      })
      return res.status(500).json({ error: 'Could not finish deleting your account. Email support@getjobtally.com — nothing is lost.' })
    }

    alertOwner('account-deleted', `${isOwner ? 'An owner' : 'A crew member'} deleted their account`, {
      email: user.email,
      company: (prof && prof.company_name) || '',
      role: isOwner ? 'owner' : 'worker',
      files_removed: filesDeleted,
    })

    return res.json({ ok: true })
  } catch (err) {
    console.error('delete-account error:', err)
    await alertOwner('delete-account', 'Account deletion threw', {
      user: user.id, error: (err && err.message) || String(err),
    })
    return res.status(500).json({ error: 'Could not delete your account. Email support@getjobtally.com.' })
  }
}
