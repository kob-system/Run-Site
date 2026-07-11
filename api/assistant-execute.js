// JobTally assistant — the "execute" endpoint. Runs a WRITE the user already
// confirmed on the client. It does NOT trust that /api/assistant proposed it:
// the tool + args are re-validated here, and the write runs under the caller's
// OWN JWT (apikey = anon) so row-level security applies exactly as in the UI.
// Every attempt is recorded in assistant_actions (service role) — the audit
// trail — with status executed|failed.
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
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${uid}&select=id,role,owner_id`,
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

async function logAction(actorId, ownerScope, action, params, status, result) {
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
        actor_id: actorId, actor_role: 'owner', owner_scope: ownerScope,
        action, params, status, result,
      }),
    })
  } catch (e) { console.error('assistant-execute: audit log failed (non-fatal):', e) }
}

const asNum = (v) => (typeof v === 'number' ? v : parseFloat(v))
const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

// Resolve a job name to exactly one of the caller's projects (under their RLS).
async function resolveJob(userToken, jobName) {
  const safe = String(jobName).replace(/[%*]/g, '')
  const { ok, data } = await userReq(
    userToken,
    `projects?select=id,name&name=ilike.*${encodeURIComponent(safe)}*&order=created_at.desc`,
    'GET'
  )
  if (!ok || !Array.isArray(data)) return { error: 'Could not look up jobs.' }
  if (data.length === 0) return { error: `No job found matching “${jobName}”.` }
  if (data.length > 1) return { error: `More than one job matches “${jobName}”. Be more specific.` }
  return { project: data[0] }
}

// Validate + execute one write tool. Returns { ok, message, result } or { error }.
async function runTool(tool, args, uid, userToken) {
  if (tool === 'add_expense') {
    const amount = asNum(args.amount)
    if (!args.job_name || typeof args.job_name !== 'string') return { error: 'Missing job.' }
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) return { error: 'Amount must be between $0 and $100,000.' }
    const category = ['materials', 'labor', 'other'].includes(args.category) ? args.category : 'materials'
    const resolved = await resolveJob(userToken, args.job_name)
    if (resolved.error) return { error: resolved.error }
    const { ok, data } = await userReq(userToken, 'receipts', 'POST', {
      project_id: resolved.project.id,
      owner_id: uid,
      amount,
      category,
      store: clean(args.store, 120) || null,
      description: clean(args.description, 200) || null,
    })
    if (!ok) return { error: 'Save was blocked (check your subscription is active).' }
    const row = Array.isArray(data) ? data[0] : data
    return {
      ok: true,
      message: `Added a $${amount.toFixed(2)} ${category} expense to “${resolved.project.name}.”`,
      result: { id: row && row.id, project: resolved.project.name, amount, category },
    }
  }

  if (tool === 'create_job') {
    const name = clean(args.name, 120)
    if (!name) return { error: 'A job name is required.' }
    const contract = args.contract_price != null ? asNum(args.contract_price) : 0
    if (!Number.isFinite(contract) || contract < 0 || contract > 10000000) return { error: 'Contract price is out of range.' }
    // Seed the budget buckets so the Edit Job form (which reads
    // materials_budget/labor_budget/profit_target) can't recompute budget→$0
    // when the owner edits an unrelated field. profit_target holds the contract.
    const { ok, data } = await userReq(userToken, 'projects', 'POST', {
      owner_id: uid,
      name,
      client_name: clean(args.client_name, 120) || null,
      budget: contract,
      materials_budget: 0,
      labor_budget: 0,
      profit_target: contract,
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

  return { error: 'Unknown or unsupported action.' }
}

const WRITE_TOOLS = new Set(['add_expense', 'create_job'])

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    return res.status(500).json({ error: 'Assistant not configured' })
  }

  const user = await getUser(req)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  const profile = await getProfile(user.id)
  if (!profile) return res.status(403).json({ error: 'No profile' })
  if (profile.role !== 'owner') return res.status(403).json({ error: 'Owner-only for now' })

  if (!(await allowedRate(user.id, 60, 3600))) {
    return res.status(429).json({ error: 'Too many actions — slow down a moment.' })
  }

  const body = req.body || {}
  const tool = typeof body.tool === 'string' ? body.tool : ''
  const args = body.args && typeof body.args === 'object' ? body.args : {}
  if (!WRITE_TOOLS.has(tool)) return res.status(400).json({ error: 'Not an executable action.' })

  const ownerScope = user.id // owner actor → their own tenant

  let outcome
  try {
    outcome = await runTool(tool, args, user.id, user.token)
  } catch (e) {
    console.error('assistant-execute error:', e)
    await logAction(user.id, ownerScope, tool, args, 'failed', { error: 'exception' })
    return res.status(502).json({ error: 'Could not complete that action.' })
  }

  if (outcome.error) {
    await logAction(user.id, ownerScope, tool, args, 'failed', { error: outcome.error })
    return res.status(400).json({ error: outcome.error })
  }

  await logAction(user.id, ownerScope, tool, args, 'executed', outcome.result || null)
  return res.json({ ok: true, message: outcome.message })
}
