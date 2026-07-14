// JobTally assistant — the "execute" endpoint. Runs a WRITE the user already
// confirmed on the client. It does NOT trust that /api/assistant proposed it:
// the tool + args are re-validated here, and the write runs under the caller's
// OWN JWT (apikey = anon) so row-level security applies exactly as in the UI.
// Every attempt is recorded in assistant_actions (service role) — the audit
// trail — with status executed|failed.
//
// v0.3: full-app coverage — 30 write tools, every insert/update mirrors the
// dashboard's exact column shapes (a wrong column = PostgREST 400 = a false
// "blocked" error, so shapes here must track OwnerDashboard.js).
// v0.4: workers get their own three tools (clock_in / clock_out /
// request_time_off), whitelisted PER ROLE — a worker can never run an owner
// tool and vice versa. Worker writes mirror WorkerDashboard.js shapes.
const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY

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
    return u && u.id ? { id: u.id, token } : null
  } catch { return null }
}

async function getProfile(uid) {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${uid}&select=id,role,owner_id,hourly_rate`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    )
    if (!r.ok) return null
    const rows = await r.json()
    return rows && rows[0] ? rows[0] : null
  } catch { return null }
}

async function allowedRate(uid, max, windowSecs) {
  if (!SUPABASE_URL || !SERVICE_KEY) return false
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rate_limit_hit`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_user: uid, p_bucket: 'assistant-exec', p_max: max, p_window_secs: windowSecs }),
    })
    if (!r.ok) return false
    return (await r.json()) === true
  } catch { return false }
}

// PostgREST as the USER (RLS enforced).
async function userReq(userToken, path, method, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${userToken}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await r.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  return { ok: r.ok, status: r.status, data }
}

async function logAction(actorId, actorRole, ownerScope, action, params, status, result) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/assistant_actions`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        actor_id: actorId, actor_role: actorRole, owner_scope: ownerScope,
        action, params, status, result,
      }),
    })
  } catch (e) { console.error('assistant-execute: audit log failed (non-fatal):', e) }
}

// ---------- helpers ----------
const asNum = (v) => (typeof v === 'number' ? v : parseFloat(v))
const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
// Mirrors src/utils/money.js roundCents — money must round the same everywhere.
const rc = (x) => Math.round(((x || 0) + Number.EPSILON) * 100) / 100
const money = (n) => `$${Number(n || 0).toFixed(2)}`
const isDateKey = (s) =>
  typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime())
const normTime = (s) => {
  if (typeof s !== 'string') return null
  const m = s.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const h = parseInt(m[1], 10)
  if (h > 23 || parseInt(m[2], 10) > 59) return null
  return `${String(h).padStart(2, '0')}:${m[2]}`
}
// tz = minutes from client getTimezoneOffset() (positive west of UTC).
const todayKey = (tz) => new Date(Date.now() - tz * 60000).toISOString().slice(0, 10)
// Local wall-clock date+time → real UTC instant.
const toUtcIso = (dateKey, hhmm, tz) =>
  new Date(new Date(`${dateKey}T${hhmm}:00Z`).getTime() + tz * 60000).toISOString()
const addDaysKey = (key, days) =>
  new Date(new Date(`${key}T00:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10)
// Sunday-start week key of a timestamp, in the caller's local time — mirrors
// the dashboard's payroll grouping.
const weekStartOf = (dateLike, tz) => {
  const local = new Date(new Date(dateLike).getTime() - tz * 60000)
  return new Date(local.getTime() - local.getUTCDay() * 86400000).toISOString().slice(0, 10)
}
// Snap a plain local date key to its week's Sunday (no tz shift needed).
const snapToSunday = (key) => addDaysKey(key, -new Date(`${key}T00:00:00Z`).getUTCDay())
// Mirrors OwnerDashboard estItemAmount/estSubtotal.
const estItemAmount = (it) => (parseFloat(it && it.qty) || 0) * (parseFloat(it && it.unit_price) || 0)
const estSubtotal = (items) => (Array.isArray(items) ? items : []).reduce((s, it) => s + estItemAmount(it), 0)
const BLOCKED = 'Save was blocked (check your subscription is active).'

// ---------- resolvers (all under the caller's RLS) ----------
const ilikeSafe = (s) => encodeURIComponent(String(s).replace(/[%*,()]/g, ''))

// Every word must appear in `field`, in any order — "Delgado basement" still
// finds "Basement Finish – Delgado Residence". Returns a PostgREST and=() filter,
// or null when there's only one word (the plain substring match already covers it).
function wordFilter(field, needle) {
  const words = String(needle).trim().split(/\s+/).filter((w) => w.length > 1)
  if (words.length < 2) return null
  return `and=(${words.map((w) => `${field}.ilike.*${ilikeSafe(w)}*`).join(',')})`
}

// Resolve a job name to exactly one of the caller's projects.
async function resolveJob(userToken, jobName) {
  if (!jobName || typeof jobName !== 'string' || !jobName.trim()) return { error: 'Missing job name.' }
  const select = 'projects?select=id,name,budget,materials_budget,labor_budget,profit_target,stage'
  let { ok, data } = await userReq(
    userToken,
    `${select}&name=ilike.*${ilikeSafe(jobName)}*&order=created_at.desc`,
    'GET'
  )
  if (!ok || !Array.isArray(data)) return { error: 'Could not look up jobs.' }
  if (data.length === 0) {
    const wf = wordFilter('name', jobName)
    if (wf) {
      const retry = await userReq(userToken, `${select}&${wf}&order=created_at.desc`, 'GET')
      if (retry.ok && Array.isArray(retry.data)) data = retry.data
    }
  }
  if (data.length === 0) return { error: `No job found matching “${jobName}”.` }
  if (data.length > 1) {
    const exact = data.filter((p) => (p.name || '').trim().toLowerCase() === jobName.trim().toLowerCase())
    if (exact.length === 1) return { project: exact[0] }
    return { error: `More than one job matches “${jobName}” (${data.slice(0, 5).map((p) => p.name).join(', ')}). Be more specific.` }
  }
  return { project: data[0] }
}

// Resolve a crew-member name to exactly one of the owner's workers.
async function resolveWorker(userToken, uid, workerName) {
  if (!workerName || typeof workerName !== 'string' || !workerName.trim()) return { error: 'Missing worker name.' }
  const select = `profiles?select=id,full_name,hourly_rate&owner_id=eq.${uid}&role=eq.worker`
  let { ok, data } = await userReq(
    userToken,
    `${select}&full_name=ilike.*${ilikeSafe(workerName)}*`,
    'GET'
  )
  if (!ok || !Array.isArray(data)) return { error: 'Could not look up your crew.' }
  if (data.length === 0) {
    const wf = wordFilter('full_name', workerName)
    if (wf) {
      const retry = await userReq(userToken, `${select}&${wf}`, 'GET')
      if (retry.ok && Array.isArray(retry.data)) data = retry.data
    }
  }
  if (data.length === 0) return { error: `No crew member found matching “${workerName}”.` }
  if (data.length > 1) {
    const exact = data.filter((w) => (w.full_name || '').trim().toLowerCase() === workerName.trim().toLowerCase())
    if (exact.length === 1) return { worker: exact[0] }
    return { error: `More than one crew member matches “${workerName}” (${data.map((w) => w.full_name).join(', ')}). Use the full name.` }
  }
  return { worker: data[0] }
}

// Pick exactly one row whose `field` contains `needle` (case-insensitive).
function matchOne(rows, field, needle, what) {
  const n = String(needle || '').trim().toLowerCase()
  if (!n) return { error: `Missing ${what}.` }
  let hits = (rows || []).filter((r) => String(r[field] || '').toLowerCase().includes(n))
  if (hits.length === 0) {
    const words = n.split(/\s+/).filter((w) => w.length > 1)
    if (words.length > 1) {
      hits = (rows || []).filter((r) => {
        const v = String(r[field] || '').toLowerCase()
        return words.every((w) => v.includes(w))
      })
    }
  }
  if (hits.length === 0) return { error: `No ${what} found matching “${needle}”.` }
  if (hits.length > 1) {
    const exact = hits.filter((r) => String(r[field] || '').trim().toLowerCase() === n)
    if (exact.length === 1) return { row: exact[0] }
    return { error: `More than one ${what} matches “${needle}”. Be more specific.` }
  }
  return { row: hits[0] }
}

// Resolve an estimate title to exactly one estimate.
async function resolveEstimate(userToken, title) {
  if (!title || typeof title !== 'string' || !title.trim()) return { error: 'Missing estimate title.' }
  const select = 'estimates?select=id,title,status,items,tax_rate,client_name,client_phone,client_email'
  let { ok, data } = await userReq(
    userToken,
    `${select}&title=ilike.*${ilikeSafe(title)}*&order=created_at.desc`,
    'GET'
  )
  if (!ok || !Array.isArray(data)) return { error: 'Could not look up estimates.' }
  if (data.length === 0) {
    const wf = wordFilter('title', title)
    if (wf) {
      const retry = await userReq(userToken, `${select}&${wf}&order=created_at.desc`, 'GET')
      if (retry.ok && Array.isArray(retry.data)) data = retry.data
    }
  }
  if (data.length === 0) return { error: `No estimate found matching “${title}”.` }
  if (data.length > 1) {
    const exact = data.filter((e) => (e.title || '').trim().toLowerCase() === title.trim().toLowerCase())
    if (exact.length === 1) return { estimate: exact[0] }
    return { error: `More than one estimate matches “${title}” (${data.slice(0, 5).map((e) => e.title).join(', ')}). Be more specific.` }
  }
  return { estimate: data[0] }
}

// Resolve a job name to exactly one of the WORKER's assigned jobs. Workers
// have no read on the base projects table (FIX-16 Part B) — only the
// hard-scoped worker_projects view (assigned, non-completed jobs).
async function resolveMyJob(userToken, jobName) {
  if (!jobName || typeof jobName !== 'string' || !jobName.trim()) return { error: 'Which job? Give the job name.' }
  const select = 'worker_projects?select=id,name'
  let { ok, data } = await userReq(userToken, `${select}&name=ilike.*${ilikeSafe(jobName)}*`, 'GET')
  if (!ok || !Array.isArray(data)) return { error: 'Could not look up your jobs.' }
  if (data.length === 0) {
    const wf = wordFilter('name', jobName)
    if (wf) {
      const retry = await userReq(userToken, `${select}&${wf}`, 'GET')
      if (retry.ok && Array.isArray(retry.data)) data = retry.data
    }
  }
  if (data.length === 0) return { error: `No assigned job found matching “${jobName}”. Ask your boss to assign you if it's missing.` }
  if (data.length > 1) {
    const exact = data.filter((p) => (p.name || '').trim().toLowerCase() === jobName.trim().toLowerCase())
    if (exact.length === 1) return { project: exact[0] }
    return { error: `More than one of your jobs matches “${jobName}” (${data.slice(0, 5).map((p) => p.name).join(', ')}). Be more specific.` }
  }
  return { project: data[0] }
}

// The origin to use for internal API calls and user-facing links. The browser's
// Origin header can be the apex (https://getjobtally.com), but the apex
// 308-redirects to www and DROPS the POST body — so an internal POST to the apex
// silently loses its payload. Force the www host to avoid that.
function appOrigin(ctx) {
  let o = typeof ctx.origin === 'string' && ctx.origin.startsWith('https://') ? ctx.origin : 'https://www.getjobtally.com'
  return o.replace('https://getjobtally.com', 'https://www.getjobtally.com')
}

// Owner email on worker clock in/out — same endpoint the dashboard uses; it
// re-resolves worker/owner/job server-side from the worker's JWT, so nothing
// here is trusted. Best-effort: a failed email never fails the clock action.
async function notifyOwner(ctx, projectId, action, timestamp) {
  try {
    const origin = appOrigin(ctx)
    await fetch(`${origin}/api/notify-owner`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ctx.token}` },
      body: JSON.stringify({ projectId, action, timestamp }),
    })
  } catch { /* best-effort */ }
}

// Validate + execute one write tool. Returns { ok, message, result } or { error }.
async function runTool(tool, args, ctx) {
  const { uid, token, tz } = ctx

  // ---- money in / money out ----
  if (tool === 'add_expense') {
    const amount = asNum(args.amount)
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) return { error: 'Amount must be between $0 and $100,000.' }
    const category = ['materials', 'labor', 'other'].includes(args.category) ? args.category : 'materials'
    // A crew member can log a scanned receipt, but it always books to the BOSS's
    // tenant: owner_id = their owner, and the job must be one they're assigned to
    // (worker_projects view; the receipts INSERT RLS re-checks project_workers).
    const isWorker = ctx.profile && ctx.profile.role === 'worker'
    const ownerId = isWorker ? (ctx.profile && ctx.profile.owner_id) : uid
    if (isWorker && !ownerId) return { error: 'You’re not linked to a boss yet.' }
    const resolved = isWorker ? await resolveMyJob(token, args.job_name) : await resolveJob(token, args.job_name)
    if (resolved.error) return { error: resolved.error }
    const { ok, data } = await userReq(token, 'receipts', 'POST', {
      project_id: resolved.project.id,
      owner_id: ownerId,
      amount,
      category,
      store: clean(args.store, 120) || null,
      description: clean(args.description, 200) || null,
    })
    if (!ok) return { error: BLOCKED }
    const row = Array.isArray(data) ? data[0] : data
    return {
      ok: true,
      message: `Added a ${money(amount)} ${category} expense to “${resolved.project.name}.”`,
      result: { id: row && row.id, project: resolved.project.name, amount, category },
    }
  }

  if (tool === 'create_invoice') {
    const amount = asNum(args.amount)
    if (!Number.isFinite(amount) || amount <= 0 || amount > 10000000) return { error: 'Invoice amount is out of range.' }
    const resolved = await resolveJob(token, args.job_name)
    if (resolved.error) return { error: resolved.error }
    const due = isDateKey(args.due_date) ? args.due_date : null
    const { ok, data } = await userReq(token, 'invoices', 'POST', {
      owner_id: uid, project_id: resolved.project.id,
      label: clean(args.label, 120) || 'Invoice', amount,
      issued_date: todayKey(tz),
      due_date: due, notes: clean(args.notes, 500) || null, payment_link: null, status: 'unpaid',
    })
    if (!ok) return { error: BLOCKED }
    const row = Array.isArray(data) ? data[0] : data
    return {
      ok: true,
      message: `Created a ${money(amount)} invoice on “${resolved.project.name}”${due ? ` due ${due}` : ''}.`,
      result: { id: row && row.id, project: resolved.project.name, amount, due_date: due },
    }
  }

  if (tool === 'mark_invoice_paid') {
    let project = null
    if (args.job_name) {
      const resolved = await resolveJob(token, args.job_name)
      if (resolved.error) return { error: resolved.error }
      project = resolved.project
    }
    const { ok, data } = await userReq(
      token,
      'invoices?status=eq.unpaid&select=id,label,amount,project_id,projects(name)&order=issued_date.desc&limit=100',
      'GET'
    )
    if (!ok || !Array.isArray(data)) return { error: 'Could not look up invoices.' }
    let list = data
    if (project) list = list.filter((i) => i.project_id === project.id)
    if (args.label) {
      const n = String(args.label).trim().toLowerCase()
      list = list.filter((i) => String(i.label || '').toLowerCase().includes(n))
    }
    if (args.amount != null) {
      const amt = asNum(args.amount)
      if (Number.isFinite(amt)) list = list.filter((i) => Math.abs((i.amount || 0) - amt) < 0.005)
    }
    if (list.length === 0) return { error: 'No unpaid invoice matches that. Check the job, label, or amount.' }
    if (list.length > 1) {
      const opts = list.slice(0, 5).map((i) => `${i.label || 'Invoice'} — ${money(i.amount)} (${(i.projects && i.projects.name) || 'job'})`).join('; ')
      return { error: `More than one unpaid invoice matches: ${opts}. Say which one (label or amount).` }
    }
    const inv = list[0]
    const upd = await userReq(token, `invoices?id=eq.${inv.id}`, 'PATCH', { status: 'paid', paid_at: new Date().toISOString() })
    if (!upd.ok) return { error: BLOCKED }
    return {
      ok: true,
      message: `Marked “${inv.label || 'Invoice'}” (${money(inv.amount)}) on “${(inv.projects && inv.projects.name) || 'job'}” as paid.`,
      result: { id: inv.id, label: inv.label, amount: inv.amount },
    }
  }

  // ---- jobs ----
  if (tool === 'create_job') {
    const name = clean(args.name, 120)
    if (!name) return { error: 'A job name is required.' }
    const contract = args.contract_price != null ? asNum(args.contract_price) : 0
    if (!Number.isFinite(contract) || contract < 0 || contract > 10000000) return { error: 'Contract price is out of range.' }
    // Seed the budget buckets so the Edit Job form (which reads
    // materials_budget/labor_budget/profit_target) can't recompute budget→$0
    // when the owner edits an unrelated field. profit_target holds the contract.
    const { ok, data } = await userReq(token, 'projects', 'POST', {
      owner_id: uid,
      name,
      client_name: clean(args.client_name, 120) || null,
      client_phone: clean(args.client_phone, 40) || null,
      client_email: clean(args.client_email, 160) || null,
      client_address: clean(args.client_address, 240) || null,
      budget: rc(contract),
      materials_budget: 0,
      labor_budget: 0,
      profit_target: rc(contract),
      stage: 'start',
    })
    if (!ok) return { error: 'Create was blocked (check your subscription is active).' }
    const row = Array.isArray(data) ? data[0] : data
    return {
      ok: true,
      message: `Created the job “${name}.”`,
      result: { id: row && row.id, name, contract_price: contract },
    }
  }

  if (tool === 'update_job') {
    const resolved = await resolveJob(token, args.job_name)
    if (resolved.error) return { error: resolved.error }
    const p = resolved.project
    const patch = {}
    if (args.new_name != null) {
      const nn = clean(args.new_name, 120)
      if (!nn) return { error: 'The new job name can’t be empty.' }
      patch.name = nn
    }
    if (args.client_name != null) patch.client_name = clean(args.client_name, 120) || null
    if (args.client_phone != null) patch.client_phone = clean(args.client_phone, 40) || null
    if (args.client_email != null) patch.client_email = clean(args.client_email, 160) || null
    if (args.client_address != null) patch.client_address = clean(args.client_address, 240) || null
    if (args.contract_price != null) {
      const contract = asNum(args.contract_price)
      if (!Number.isFinite(contract) || contract < 0 || contract > 10000000) return { error: 'Contract price is out of range.' }
      // Keep the app's invariant: budget = materials + labor + profit_target.
      // Buckets stay put; the profit target absorbs the contract change.
      patch.budget = rc(contract)
      patch.profit_target = rc(contract - (p.materials_budget || 0) - (p.labor_budget || 0))
    }
    if (Object.keys(patch).length === 0) return { error: 'Nothing to update — say what should change.' }
    const upd = await userReq(token, `projects?id=eq.${p.id}`, 'PATCH', patch)
    if (!upd.ok) return { error: BLOCKED }
    return {
      ok: true,
      message: `Updated “${p.name}”${patch.name ? ` (now “${patch.name}”)` : ''}${patch.budget != null ? ` — contract ${money(patch.budget)}` : ''}.`,
      result: { id: p.id, changed: Object.keys(patch) },
    }
  }

  if (tool === 'set_job_stage') {
    const stage = String(args.stage || '')
    if (!['start', 'mid', 'end', 'reopen'].includes(stage)) return { error: 'Stage must be start, mid, end, or reopen.' }
    const resolved = await resolveJob(token, args.job_name)
    if (resolved.error) return { error: resolved.error }
    const p = resolved.project
    const patch = stage === 'end'
      ? { stage: 'end', completed_at: new Date().toISOString() }
      : stage === 'reopen'
        ? { stage: 'mid', completed_at: null }
        : { stage, completed_at: null }
    const upd = await userReq(token, `projects?id=eq.${p.id}`, 'PATCH', patch)
    if (!upd.ok) return { error: BLOCKED }
    const label = stage === 'end' ? 'marked done' : stage === 'reopen' ? 'reopened' : `moved to ${stage}`
    return { ok: true, message: `“${p.name}” ${label}.`, result: { id: p.id, stage: patch.stage } }
  }

  // ---- time, mileage, logs ----
  if (tool === 'add_time_entry') {
    const resolvedJob = await resolveJob(token, args.job_name)
    if (resolvedJob.error) return { error: resolvedJob.error }
    const resolvedWorker = await resolveWorker(token, uid, args.worker_name)
    if (resolvedWorker.error) return { error: resolvedWorker.error }
    const w = resolvedWorker.worker
    if (!isDateKey(args.date)) return { error: 'Give the date as YYYY-MM-DD.' }
    const start = normTime(args.start_time || '08:00')
    if (!start) return { error: 'Start time must look like 08:00.' }
    const startAt = new Date(toUtcIso(args.date, start, tz))
    let endAt
    if (args.end_time != null && args.end_time !== '') {
      const end = normTime(args.end_time)
      if (!end) return { error: 'End time must look like 16:30.' }
      endAt = new Date(toUtcIso(args.date, end, tz))
      if (endAt <= startAt) return { error: 'End time must be after the start time.' }
    } else {
      const hours = asNum(args.hours)
      if (!Number.isFinite(hours) || hours <= 0 || hours > 24) return { error: 'Give an end time, or hours between 0 and 24.' }
      endAt = new Date(startAt.getTime() + hours * 3600000)
    }
    const totalMinutes = Math.round((endAt - startAt) / 60000)
    const laborCost = rc((totalMinutes / 60) * (w.hourly_rate || 0))
    // Mirrors the dashboard's manual time insert — time_entries has no owner_id.
    const { ok, data } = await userReq(token, 'time_entries', 'POST', {
      project_id: resolvedJob.project.id,
      worker_id: w.id,
      clocked_in_at: startAt.toISOString(),
      clocked_out_at: endAt.toISOString(),
      total_minutes: totalMinutes,
      labor_cost: laborCost,
    })
    if (!ok) return { error: BLOCKED }
    const row = Array.isArray(data) ? data[0] : data
    return {
      ok: true,
      message: `Logged ${(totalMinutes / 60).toFixed(2)}h for ${w.full_name} on “${resolvedJob.project.name}” (${args.date}) — ${money(laborCost)} labor.`,
      result: { id: row && row.id, worker: w.full_name, minutes: totalMinutes, labor_cost: laborCost },
    }
  }

  if (tool === 'add_mileage') {
    const resolved = await resolveJob(token, args.job_name)
    if (resolved.error) return { error: resolved.error }
    const miles = asNum(args.miles)
    if (!Number.isFinite(miles) || miles <= 0 || miles > 10000) return { error: 'Miles must be between 0 and 10,000.' }
    const rate = args.rate != null ? asNum(args.rate) : 0.7
    if (!Number.isFinite(rate) || rate <= 0 || rate > 10) return { error: 'Rate per mile is out of range.' }
    const tripDate = isDateKey(args.trip_date) ? args.trip_date : todayKey(tz)
    const { ok, data } = await userReq(token, 'mileage_entries', 'POST', {
      owner_id: uid, project_id: resolved.project.id,
      trip_date: tripDate, miles, rate, notes: clean(args.notes, 200) || null,
    })
    if (!ok) return { error: BLOCKED }
    const row = Array.isArray(data) ? data[0] : data
    return {
      ok: true,
      message: `Logged ${miles} miles on “${resolved.project.name}” (${tripDate}) — ${money(miles * rate)} deduction.`,
      result: { id: row && row.id, miles, rate, trip_date: tripDate },
    }
  }

  if (tool === 'add_daily_log') {
    const note = clean(args.note, 1000)
    if (!note) return { error: 'The log note can’t be empty.' }
    const resolved = await resolveJob(token, args.job_name)
    if (resolved.error) return { error: resolved.error }
    const logDate = isDateKey(args.log_date) ? args.log_date : todayKey(tz)
    const { ok, data } = await userReq(token, 'daily_logs', 'POST', {
      owner_id: uid, project_id: resolved.project.id,
      log_date: logDate, weather: clean(args.weather, 80) || null, note,
    })
    if (!ok) return { error: BLOCKED }
    const row = Array.isArray(data) ? data[0] : data
    return { ok: true, message: `Saved a daily log on “${resolved.project.name}” (${logDate}).`, result: { id: row && row.id, log_date: logDate } }
  }

  // ---- extras / punch list / materials ----
  if (tool === 'add_change_order') {
    const description = clean(args.description, 300)
    if (!description) return { error: 'Describe the extra.' }
    const amount = asNum(args.amount)
    if (!Number.isFinite(amount) || Math.abs(amount) > 10000000) return { error: 'Amount is out of range.' }
    const status = ['approved', 'pending', 'declined'].includes(args.status) ? args.status : 'approved'
    const resolved = await resolveJob(token, args.job_name)
    if (resolved.error) return { error: resolved.error }
    const { ok, data } = await userReq(token, 'change_orders', 'POST', {
      owner_id: uid, project_id: resolved.project.id, description, amount, status,
    })
    if (!ok) return { error: BLOCKED }
    const row = Array.isArray(data) ? data[0] : data
    return {
      ok: true,
      message: `Added a ${money(amount)} ${status} extra to “${resolved.project.name}”: ${description}`,
      result: { id: row && row.id, amount, status },
    }
  }

  if (tool === 'add_punch_item') {
    const description = clean(args.description, 300)
    if (!description) return { error: 'Describe the punch-list item.' }
    const resolved = await resolveJob(token, args.job_name)
    if (resolved.error) return { error: resolved.error }
    const { ok, data } = await userReq(token, 'punch_items', 'POST', {
      owner_id: uid, project_id: resolved.project.id, description,
    })
    if (!ok) return { error: BLOCKED }
    const row = Array.isArray(data) ? data[0] : data
    return { ok: true, message: `Added to the punch list on “${resolved.project.name}”: ${description}`, result: { id: row && row.id } }
  }

  if (tool === 'set_punch_item') {
    if (typeof args.done !== 'boolean') return { error: 'Say whether it’s done or not done.' }
    const resolved = await resolveJob(token, args.job_name)
    if (resolved.error) return { error: resolved.error }
    const { ok, data } = await userReq(token, `punch_items?project_id=eq.${resolved.project.id}&select=id,description,done`, 'GET')
    if (!ok || !Array.isArray(data)) return { error: 'Could not look up the punch list.' }
    const m = matchOne(data, 'description', args.description, 'punch-list item')
    if (m.error) return { error: m.error }
    const upd = await userReq(token, `punch_items?id=eq.${m.row.id}`, 'PATCH', { done: args.done })
    if (!upd.ok) return { error: BLOCKED }
    return {
      ok: true,
      message: `Marked “${m.row.description}” ${args.done ? 'done ✓' : 'not done'} on “${resolved.project.name}.”`,
      result: { id: m.row.id, done: args.done },
    }
  }

  if (tool === 'add_material_item') {
    const name = clean(args.name, 200)
    if (!name) return { error: 'Name the material.' }
    const resolved = await resolveJob(token, args.job_name)
    if (resolved.error) return { error: resolved.error }
    const { ok, data } = await userReq(token, 'material_items', 'POST', {
      owner_id: uid, project_id: resolved.project.id, name, qty: clean(args.qty, 60) || null,
    })
    if (!ok) return { error: BLOCKED }
    const row = Array.isArray(data) ? data[0] : data
    return { ok: true, message: `Added “${name}”${args.qty ? ` (${clean(args.qty, 60)})` : ''} to the shopping list on “${resolved.project.name}.”`, result: { id: row && row.id } }
  }

  if (tool === 'set_material_item') {
    if (typeof args.bought !== 'boolean') return { error: 'Say whether it’s bought or not bought.' }
    const resolved = await resolveJob(token, args.job_name)
    if (resolved.error) return { error: resolved.error }
    const { ok, data } = await userReq(token, `material_items?project_id=eq.${resolved.project.id}&select=id,name,bought`, 'GET')
    if (!ok || !Array.isArray(data)) return { error: 'Could not look up the shopping list.' }
    const m = matchOne(data, 'name', args.name, 'shopping-list item')
    if (m.error) return { error: m.error }
    const upd = await userReq(token, `material_items?id=eq.${m.row.id}`, 'PATCH', { bought: args.bought })
    if (!upd.ok) return { error: BLOCKED }
    return {
      ok: true,
      message: `Marked “${m.row.name}” ${args.bought ? 'bought ✓' : 'not bought'} on “${resolved.project.name}.”`,
      result: { id: m.row.id, bought: args.bought },
    }
  }

  // ---- estimates ----
  if (tool === 'create_estimate') {
    const title = clean(args.title, 120)
    if (!title) return { error: 'The estimate needs a title.' }
    if (!Array.isArray(args.items) || args.items.length === 0) return { error: 'Add at least one line item.' }
    if (args.items.length > 50) return { error: 'Too many line items (max 50).' }
    const items = []
    for (const raw of args.items) {
      const description = clean(raw && raw.description, 200)
      if (!description) return { error: 'Every line item needs a description.' }
      const unitPrice = asNum(raw.unit_price)
      if (!Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 10000000) return { error: `Price for “${description}” is out of range.` }
      const qty = raw.qty != null ? asNum(raw.qty) : 1
      if (!Number.isFinite(qty) || qty <= 0 || qty > 100000) return { error: `Quantity for “${description}” is out of range.` }
      const kind = ['materials', 'labor', 'other'].includes(raw.kind) ? raw.kind : 'materials'
      items.push({ description, qty, unit_price: unitPrice, kind })
    }
    const taxRate = args.tax_rate != null ? asNum(args.tax_rate) : 0
    if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 30) return { error: 'Tax rate must be between 0 and 30%.' }
    const { ok, data } = await userReq(token, 'estimates', 'POST', {
      owner_id: uid,
      client_name: clean(args.client_name, 120) || null,
      client_phone: clean(args.client_phone, 40) || null,
      client_email: clean(args.client_email, 160) || null,
      title, items, tax_rate: taxRate, notes: clean(args.notes, 500) || null,
      status: 'draft',
    })
    if (!ok) return { error: BLOCKED }
    const row = Array.isArray(data) ? data[0] : data
    const subtotal = rc(estSubtotal(items))
    return {
      ok: true,
      message: `Created estimate “${title}” — ${items.length} line${items.length > 1 ? 's' : ''}, ${money(subtotal)} before tax.`,
      result: { id: row && row.id, title, subtotal },
    }
  }

  if (tool === 'set_estimate_status') {
    const status = String(args.status || '')
    if (!['sent', 'declined'].includes(status)) return { error: 'Status must be sent or declined. (To accept one, say “accept the estimate.”)' }
    const resolved = await resolveEstimate(token, args.title)
    if (resolved.error) return { error: resolved.error }
    const est = resolved.estimate
    if (est.status === 'accepted') return { error: `“${est.title}” was already accepted — it can’t be changed.` }
    const upd = await userReq(token, `estimates?id=eq.${est.id}`, 'PATCH', { status })
    if (!upd.ok) return { error: BLOCKED }
    return { ok: true, message: `Marked estimate “${est.title}” as ${status}.`, result: { id: est.id, status } }
  }

  if (tool === 'accept_estimate') {
    const resolved = await resolveEstimate(token, args.title)
    if (resolved.error) return { error: resolved.error }
    const est = resolved.estimate
    if (est.status === 'accepted') return { error: `“${est.title}” is already accepted.` }
    // Mirror acceptEstimate in the dashboard exactly: contract = PRE-TAX
    // subtotal (sales tax is the state's money, never profit); profit target =
    // the non-materials/non-labor lines.
    const items = Array.isArray(est.items) ? est.items : []
    const materials = items.filter((it) => it.kind === 'materials').reduce((s, it) => s + estItemAmount(it), 0)
    const labor = items.filter((it) => it.kind === 'labor').reduce((s, it) => s + estItemAmount(it), 0)
    const subtotal = estSubtotal(items)
    const profit = Math.max(subtotal - materials - labor, 0)
    const ins = await userReq(token, 'projects', 'POST', {
      owner_id: uid,
      name: est.title || (est.client_name ? `${est.client_name} — job` : 'New job'),
      client_name: est.client_name, client_phone: est.client_phone || null, client_email: est.client_email || null,
      budget: rc(subtotal), materials_budget: rc(materials), labor_budget: rc(labor),
      profit_target: rc(profit), stage: 'start',
    })
    if (!ins.ok) return { error: BLOCKED }
    const proj = Array.isArray(ins.data) ? ins.data[0] : ins.data
    const upd = await userReq(token, `estimates?id=eq.${est.id}`, 'PATCH', { status: 'accepted', project_id: proj ? proj.id : null })
    const note = upd.ok ? '' : ' (The job was created, but the estimate couldn’t be marked accepted — check the Estimates tab.)'
    return {
      ok: true,
      message: `Accepted “${est.title}” — created the job at ${money(rc(subtotal))} contract.${note}`,
      result: { estimate_id: est.id, project_id: proj && proj.id, contract: rc(subtotal) },
    }
  }

  // ---- crew ----
  if (tool === 'set_worker_rate') {
    const rate = asNum(args.hourly_rate)
    if (!Number.isFinite(rate) || rate < 0 || rate > 500) return { error: 'Hourly rate must be between $0 and $500.' }
    const resolved = await resolveWorker(token, uid, args.worker_name)
    if (resolved.error) return { error: resolved.error }
    const w = resolved.worker
    const upd = await userReq(token, `profiles?id=eq.${w.id}`, 'PATCH', { hourly_rate: rc(rate) })
    if (!upd.ok) return { error: BLOCKED }
    return { ok: true, message: `Set ${w.full_name}’s rate to ${money(rate)}/hr.`, result: { id: w.id, hourly_rate: rc(rate) } }
  }

  if (tool === 'assign_worker') {
    const resolvedWorkerR = await resolveWorker(token, uid, args.worker_name)
    if (resolvedWorkerR.error) return { error: resolvedWorkerR.error }
    const resolvedJobR = await resolveJob(token, args.job_name)
    if (resolvedJobR.error) return { error: resolvedJobR.error }
    const w = resolvedWorkerR.worker
    const p = resolvedJobR.project
    const { ok, status } = await userReq(token, 'project_workers', 'POST', { worker_id: w.id, project_id: p.id })
    // 409 = already assigned (unique violation) — same tolerance as the UI.
    if (!ok && status !== 409) return { error: BLOCKED }
    return {
      ok: true,
      message: status === 409
        ? `${w.full_name} is already assigned to “${p.name}.”`
        : `Assigned ${w.full_name} to “${p.name}” — they can clock in now.`,
      result: { worker_id: w.id, project_id: p.id },
    }
  }

  if (tool === 'decide_time_off') {
    const decision = String(args.decision || '')
    if (!['approve', 'deny'].includes(decision)) return { error: 'Decision must be approve or deny.' }
    const resolved = await resolveWorker(token, uid, args.worker_name)
    if (resolved.error) return { error: resolved.error }
    const w = resolved.worker
    const { ok, data } = await userReq(
      token,
      `time_off_requests?worker_id=eq.${w.id}&status=eq.pending&select=id,start_date,end_date&order=created_at.desc`,
      'GET'
    )
    if (!ok || !Array.isArray(data)) return { error: 'Could not look up time-off requests.' }
    if (data.length === 0) return { error: `${w.full_name} has no pending time-off requests.` }
    if (data.length > 1) return { error: `${w.full_name} has ${data.length} pending requests — decide them in the Workers tab.` }
    const reqRow = data[0]
    const status = decision === 'approve' ? 'approved' : 'denied'
    const upd = await userReq(token, `time_off_requests?id=eq.${reqRow.id}`, 'PATCH', { status, decided_at: new Date().toISOString() })
    if (!upd.ok) return { error: BLOCKED }
    return {
      ok: true,
      message: `${status === 'approved' ? 'Approved' : 'Denied'} ${w.full_name}’s time off (${reqRow.start_date} → ${reqRow.end_date}).`,
      result: { id: reqRow.id, status },
    }
  }

  if (tool === 'add_schedule_entry') {
    const resolvedWorkerR = await resolveWorker(token, uid, args.worker_name)
    if (resolvedWorkerR.error) return { error: resolvedWorkerR.error }
    const resolvedJobR = await resolveJob(token, args.job_name)
    if (resolvedJobR.error) return { error: resolvedJobR.error }
    if (!isDateKey(args.date)) return { error: 'Give the date as YYYY-MM-DD.' }
    const start = normTime(args.start_time)
    const end = normTime(args.end_time)
    if (!start || !end) return { error: 'Times must look like 08:00 and 16:00.' }
    if (end <= start) return { error: 'End time must be after the start time.' }
    const w = resolvedWorkerR.worker
    const p = resolvedJobR.project
    const { ok, data } = await userReq(token, 'schedule_entries', 'POST', {
      owner_id: uid, worker_id: w.id, project_id: p.id,
      task_description: clean(args.task_description, 200) || null,
      scheduled_date: args.date, start_time: start, end_time: end,
    })
    if (!ok) return { error: BLOCKED }
    const row = Array.isArray(data) ? data[0] : data
    return {
      ok: true,
      message: `Scheduled ${w.full_name} on “${p.name}” for ${args.date}, ${start}–${end}.`,
      result: { id: row && row.id, date: args.date },
    }
  }

  if (tool === 'record_paycheck') {
    const resolved = await resolveWorker(token, uid, args.worker_name)
    if (resolved.error) return { error: resolved.error }
    const w = resolved.worker
    const [entriesR, paidR] = await Promise.all([
      userReq(token, `time_entries?worker_id=eq.${w.id}&clocked_out_at=not.is.null&select=clocked_in_at,total_minutes,labor_cost&order=clocked_in_at.desc&limit=1000`, 'GET'),
      userReq(token, `paychecks?worker_id=eq.${w.id}&select=week_start`, 'GET'),
    ])
    if (!entriesR.ok || !Array.isArray(entriesR.data)) return { error: 'Could not look up clocked time.' }
    if (!paidR.ok || !Array.isArray(paidR.data)) return { error: 'Could not look up paychecks.' }
    const paid = new Set(paidR.data.map((r) => r.week_start))
    const byWeek = {}
    for (const t of entriesR.data) {
      const ws = weekStartOf(t.clocked_in_at, tz)
      if (!byWeek[ws]) byWeek[ws] = { minutes: 0, gross: 0 }
      byWeek[ws].minutes += t.total_minutes || 0
      byWeek[ws].gross += t.labor_cost || 0
    }
    let ws = isDateKey(args.week_start) ? snapToSunday(args.week_start) : null
    if (!ws) ws = Object.keys(byWeek).sort().reverse().find((k) => !paid.has(k)) || null
    if (!ws) return { error: `${w.full_name} has no unpaid weeks with clocked time.` }
    if (!byWeek[ws]) return { error: `${w.full_name} has no clocked time in the week starting ${ws}.` }
    if (paid.has(ws)) return { error: `A paycheck for ${w.full_name}, week of ${ws}, is already recorded.` }
    const gross = rc(byWeek[ws].gross)
    const { ok, data } = await userReq(token, 'paychecks', 'POST', {
      owner_id: uid, worker_id: w.id,
      week_start: ws, week_end: addDaysKey(ws, 6),
      total_minutes: byWeek[ws].minutes, gross_pay: gross,
      paid_at: new Date().toISOString(),
    })
    if (!ok) return { error: BLOCKED }
    const row = Array.isArray(data) ? data[0] : data
    return {
      ok: true,
      message: `Recorded ${w.full_name}’s paycheck for the week of ${ws}: ${(byWeek[ws].minutes / 60).toFixed(1)}h, ${money(gross)} gross.`,
      result: { id: row && row.id, week_start: ws, gross_pay: gross },
    }
  }

  if (tool === 'invite_worker') {
    const workerName = clean(args.worker_name, 120)
    if (!workerName) return { error: 'Whose invite is this? Give a name.' }
    const inviteToken = crypto.randomUUID()
    const { ok } = await userReq(token, 'worker_invites', 'POST', {
      owner_id: uid, token: inviteToken, worker_name: workerName,
    })
    if (!ok) return { error: BLOCKED }
    const link = `${appOrigin(ctx)}/?invite=${inviteToken}`
    return {
      ok: true,
      message: `Invite for ${workerName} is ready — text them this link to join your crew:\n${link}`,
      result: { worker_name: workerName, link },
    }
  }

  if (tool === 'remove_worker') {
    const resolved = await resolveWorker(token, uid, args.worker_name)
    if (resolved.error) return { error: resolved.error }
    const w = resolved.worker
    // Same mechanism as the Workers tab: unlink, don't delete. Hours stay intact.
    const upd = await userReq(token, `profiles?id=eq.${w.id}`, 'PATCH', { owner_id: null })
    if (!upd.ok) return { error: BLOCKED }
    return {
      ok: true,
      message: `Removed ${w.full_name} from your crew. Their logged hours stay intact, and they can re-link anytime by entering your email when they sign in.`,
      result: { id: w.id },
    }
  }

  // ---- permits, callbacks, compliance ----
  if (tool === 'add_permit') {
    const name = clean(args.name, 160)
    if (!name) return { error: 'Name the permit.' }
    const status = ['applied', 'approved', 'inspection', 'passed', 'failed'].includes(args.status) ? args.status : 'applied'
    const resolved = await resolveJob(token, args.job_name)
    if (resolved.error) return { error: resolved.error }
    const { ok, data } = await userReq(token, 'permits', 'POST', {
      owner_id: uid, project_id: resolved.project.id,
      name, status,
      permit_number: clean(args.permit_number, 80) || null,
      inspection_on: isDateKey(args.inspection_on) ? args.inspection_on : null,
      notes: clean(args.notes, 300) || null,
    })
    if (!ok) return { error: BLOCKED }
    const row = Array.isArray(data) ? data[0] : data
    return { ok: true, message: `Added permit “${name}” (${status}) on “${resolved.project.name}.”`, result: { id: row && row.id, status } }
  }

  if (tool === 'set_permit_status') {
    const status = String(args.status || '')
    if (!['applied', 'approved', 'inspection', 'passed', 'failed'].includes(status)) return { error: 'Status must be applied, approved, inspection, passed, or failed.' }
    const resolved = await resolveJob(token, args.job_name)
    if (resolved.error) return { error: resolved.error }
    const { ok, data } = await userReq(token, `permits?project_id=eq.${resolved.project.id}&select=id,name,status`, 'GET')
    if (!ok || !Array.isArray(data)) return { error: 'Could not look up permits.' }
    const m = matchOne(data, 'name', args.name, 'permit')
    if (m.error) return { error: m.error }
    const upd = await userReq(token, `permits?id=eq.${m.row.id}`, 'PATCH', { status })
    if (!upd.ok) return { error: BLOCKED }
    return { ok: true, message: `Permit “${m.row.name}” on “${resolved.project.name}” is now ${status}.`, result: { id: m.row.id, status } }
  }

  if (tool === 'add_warranty') {
    const description = clean(args.description, 300)
    if (!description) return { error: 'Describe the callback.' }
    let projectId = null
    let jobNote = ''
    if (args.job_name) {
      const resolved = await resolveJob(token, args.job_name)
      if (resolved.error) return { error: resolved.error }
      projectId = resolved.project.id
      jobNote = ` on “${resolved.project.name}”`
    }
    const { ok, data } = await userReq(token, 'warranties', 'POST', {
      owner_id: uid, project_id: projectId, description, status: 'open',
      due_on: isDateKey(args.due_on) ? args.due_on : null,
    })
    if (!ok) return { error: BLOCKED }
    const row = Array.isArray(data) ? data[0] : data
    return { ok: true, message: `Logged the callback${jobNote}: ${description}`, result: { id: row && row.id } }
  }

  if (tool === 'set_warranty_status') {
    const status = String(args.status || '')
    if (!['open', 'scheduled', 'closed'].includes(status)) return { error: 'Status must be open, scheduled, or closed.' }
    const { ok, data } = await userReq(token, 'warranties?select=id,description,status&order=created_at.desc&limit=200', 'GET')
    if (!ok || !Array.isArray(data)) return { error: 'Could not look up callbacks.' }
    const m = matchOne(data, 'description', args.description, 'callback')
    if (m.error) return { error: m.error }
    const upd = await userReq(token, `warranties?id=eq.${m.row.id}`, 'PATCH', { status })
    if (!upd.ok) return { error: BLOCKED }
    return { ok: true, message: `Callback “${m.row.description}” is now ${status}.`, result: { id: m.row.id, status } }
  }

  if (tool === 'add_compliance_item') {
    const kind = ['insurance', 'license', 'certification'].includes(args.kind) ? args.kind : null
    if (!kind) return { error: 'Kind must be insurance, license, or certification.' }
    const name = clean(args.name, 160)
    if (!name) return { error: 'Name the document.' }
    const { ok, data } = await userReq(token, 'compliance_items', 'POST', {
      owner_id: uid, kind, name,
      reference: clean(args.reference, 120) || null,
      expires_on: isDateKey(args.expires_on) ? args.expires_on : null,
      notes: clean(args.notes, 300) || null,
    })
    if (!ok) return { error: BLOCKED }
    const row = Array.isArray(data) ? data[0] : data
    return {
      ok: true,
      message: `Saved ${kind} “${name}”${isDateKey(args.expires_on) ? ` (expires ${args.expires_on})` : ''}.`,
      result: { id: row && row.id, kind },
    }
  }

  // ---- settings ----
  if (tool === 'update_settings') {
    const patch = {}
    if (args.company_name != null) {
      const cn = clean(args.company_name, 120)
      if (!cn) return { error: 'Company name can’t be empty.' }
      patch.company_name = cn
    }
    if (args.full_name != null) {
      const fn = clean(args.full_name, 120)
      if (!fn) return { error: 'Your name can’t be empty.' }
      patch.full_name = fn
    }
    if (Object.keys(patch).length === 0) return { error: 'Nothing to update — say what should change.' }
    const upd = await userReq(token, `profiles?id=eq.${uid}`, 'PATCH', patch)
    if (!upd.ok) return { error: BLOCKED }
    return { ok: true, message: 'Settings updated.', result: { changed: Object.keys(patch) } }
  }

  // ---- worker self-service (crew persona; every row is the worker's own) ----
  if (tool === 'clock_in') {
    const resolved = await resolveMyJob(token, args.job_name)
    if (resolved.error) return { error: resolved.error }
    // Same guard as the dashboard: never let a worker be clocked in twice.
    const open = await userReq(token, `time_entries?worker_id=eq.${uid}&clocked_out_at=is.null&select=id&limit=1`, 'GET')
    if (!open.ok || !Array.isArray(open.data)) return { error: 'Could not check your clock status. Try again.' }
    if (open.data.length > 0) return { error: 'You are already clocked in — clock out first.' }
    const clockInTime = new Date().toISOString()
    // Mirrors the dashboard's clock-in insert; no GPS from the assistant.
    const { ok, data } = await userReq(token, 'time_entries', 'POST', {
      client_id: crypto.randomUUID(),
      project_id: resolved.project.id,
      worker_id: uid,
      clocked_in_at: clockInTime,
      gps_lat: null,
      gps_lng: null,
    })
    if (!ok) {
      // A failed insert is ambiguous: a genuine RLS/assignment block, OR a
      // duplicate clock-in that lost the check-then-insert race (two taps) —
      // which the partial unique index on (worker_id) WHERE clocked_out_at IS
      // NULL turns into a 409. Re-check for an open entry: if one exists now,
      // they're already clocked in — say that instead of the misleading
      // "check with your boss" (which reads as "you're off the job").
      const recheck = await userReq(token, `time_entries?worker_id=eq.${uid}&clocked_out_at=is.null&select=id&limit=1`, 'GET')
      if (recheck.ok && Array.isArray(recheck.data) && recheck.data.length > 0) {
        return { error: 'You are already clocked in — clock out first.' }
      }
      return { error: 'Clock-in was blocked — check with your boss that you’re still on that job.' }
    }
    const row = Array.isArray(data) ? data[0] : data
    await notifyOwner(ctx, resolved.project.id, 'in', clockInTime)
    return {
      ok: true,
      message: `Clocked in on “${resolved.project.name}.” Have a good shift.`,
      result: { id: row && row.id, project: resolved.project.name },
    }
  }

  if (tool === 'clock_out') {
    const open = await userReq(
      token,
      `time_entries?worker_id=eq.${uid}&clocked_out_at=is.null&select=id,project_id,clocked_in_at&limit=1`,
      'GET'
    )
    if (!open.ok || !Array.isArray(open.data)) return { error: 'Could not check your clock status. Try again.' }
    if (open.data.length === 0) return { error: 'You’re not clocked in right now.' }
    const entry = open.data[0]
    const now = new Date()
    // Mirrors the dashboard's clock-out math (floor minutes, rate × hours).
    const totalMinutes = Math.floor((now - new Date(entry.clocked_in_at)) / 60000)
    const laborCost = rc((totalMinutes / 60) * ((ctx.profile && ctx.profile.hourly_rate) || 0))
    const upd = await userReq(token, `time_entries?id=eq.${entry.id}`, 'PATCH', {
      clocked_out_at: now.toISOString(),
      total_minutes: totalMinutes,
      labor_cost: laborCost,
    })
    if (!upd.ok) return { error: 'Could not save your clock-out. Try again in a moment.' }
    await notifyOwner(ctx, entry.project_id, 'out', now.toISOString())
    return {
      ok: true,
      message: `Clocked out — ${(totalMinutes / 60).toFixed(2)}h this shift (${money(laborCost)}).`,
      result: { id: entry.id, minutes: totalMinutes, pay: laborCost },
    }
  }

  if (tool === 'request_time_off') {
    if (!isDateKey(args.start_date)) return { error: 'Give the start date as YYYY-MM-DD.' }
    const endDate = args.end_date != null && args.end_date !== '' ? args.end_date : args.start_date
    if (!isDateKey(endDate)) return { error: 'Give the end date as YYYY-MM-DD.' }
    if (endDate < args.start_date) return { error: 'End date must be on or after the start date.' }
    if (!ctx.profile || !ctx.profile.owner_id) return { error: 'You’re not linked to a boss yet.' }
    // Shape must satisfy the worker INSERT policy (FIX-11): own worker_id,
    // their real owner_id, status pending.
    const { ok, data } = await userReq(token, 'time_off_requests', 'POST', {
      owner_id: ctx.profile.owner_id,
      worker_id: uid,
      start_date: args.start_date,
      end_date: endDate,
      reason: clean(args.reason, 300) || null,
      status: 'pending',
    })
    if (!ok) return { error: 'Could not send your request. Try again.' }
    const row = Array.isArray(data) ? data[0] : data
    const span = endDate !== args.start_date ? `${args.start_date} through ${endDate}` : args.start_date
    return {
      ok: true,
      message: `Time-off request sent to your boss for ${span}. You’ll see it as approved or denied once they decide.`,
      result: { id: row && row.id, start_date: args.start_date, end_date: endDate },
    }
  }

  return { error: 'Unknown or unsupported action.' }
}

const WRITE_TOOLS = new Set([
  'add_expense', 'create_job', 'update_job', 'set_job_stage',
  'add_time_entry', 'add_mileage', 'add_daily_log',
  'add_change_order', 'add_punch_item', 'set_punch_item', 'add_material_item', 'set_material_item',
  'create_invoice', 'mark_invoice_paid',
  'create_estimate', 'set_estimate_status', 'accept_estimate',
  'set_worker_rate', 'assign_worker', 'decide_time_off', 'add_schedule_entry', 'record_paycheck',
  'add_permit', 'set_permit_status', 'add_warranty', 'set_warranty_status', 'add_compliance_item',
  'update_settings', 'invite_worker', 'remove_worker',
])

// Crew persona — the ONLY tools a worker token can execute. add_expense is
// allowed but the handler forces it to book under the BOSS's tenant (owner_id =
// the worker's owner_id) and only to a job the worker is assigned to.
const WORKER_WRITE_TOOLS = new Set(['clock_in', 'clock_out', 'request_time_off', 'add_expense'])

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    return res.status(500).json({ error: 'Assistant not configured' })
  }

  const user = await getUser(req)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  const profile = await getProfile(user.id)
  if (!profile) return res.status(403).json({ error: 'No profile' })
  const isOwner = profile.role === 'owner'
  if (!isOwner && profile.role !== 'worker') {
    return res.status(403).json({ error: 'No access' })
  }
  if (!isOwner && !profile.owner_id) {
    return res.status(403).json({ error: 'You’re not linked to a boss yet.' })
  }

  if (!(await allowedRate(user.id, 60, 3600))) {
    return res.status(429).json({ error: 'Too many actions — slow down a moment.' })
  }

  const body = req.body || {}
  const tool = typeof body.tool === 'string' ? body.tool : ''
  const args = body.args && typeof body.args === 'object' ? body.args : {}
  // Per-role whitelist: an owner token can never run a worker tool, and a
  // worker token can never run an owner tool — regardless of what was proposed.
  const allowed = isOwner ? WRITE_TOOLS : WORKER_WRITE_TOOLS
  if (!allowed.has(tool)) return res.status(400).json({ error: 'Not an executable action.' })

  // Client timezone offset in minutes (Date.getTimezoneOffset), clamped.
  const tz = Number.isFinite(body.tz) ? Math.max(-840, Math.min(840, body.tz)) : 0

  // Audit rows always land in the OWNER's tenant, whoever the actor is.
  const ownerScope = isOwner ? user.id : profile.owner_id
  const ctx = { uid: user.id, token: user.token, tz, origin: req.headers.origin, profile }

  let outcome
  try {
    outcome = await runTool(tool, args, ctx)
  } catch (e) {
    console.error('assistant-execute error:', e)
    await logAction(user.id, profile.role, ownerScope, tool, args, 'failed', { error: 'exception' })
    return res.status(502).json({ error: 'Could not complete that action.' })
  }

  if (outcome.error) {
    await logAction(user.id, profile.role, ownerScope, tool, args, 'failed', { error: outcome.error })
    return res.status(400).json({ error: outcome.error })
  }

  await logAction(user.id, profile.role, ownerScope, tool, args, 'executed', outcome.result || null)
  return res.json({ ok: true, message: outcome.message })
}
