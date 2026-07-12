// JobTally in-app AI assistant — the "propose" endpoint.
//
// Safety model (the whole point):
//   1. RLS-BOUND. Read tools execute against PostgREST using the CALLER'S OWN
//      JWT (apikey = anon), so the assistant can never see or touch anything the
//      user couldn't already reach in the UI. No new privilege surface.
//   2. CONFIRM-BEFORE-WRITE. Read tools run inline and feed back to the model.
//      A WRITE tool is NOT executed here — we return {type:'confirm', ...} and
//      the frontend shows a plain-English "About to: ___" card. Nothing mutates
//      until the user taps Confirm, which calls /api/assistant-execute.
//   3. WHITELISTED TOOLS. The model only gets this fixed menu with validated
//      params — never free-form SQL.
//   4. AUDITED. Every executed WRITE is logged to assistant_actions (in the
//      execute endpoint).
//
// Two personas: owners get the full toolset; workers (crew) get a small
// self-scoped toolset (own hours/schedule/jobs + clock in/out + time off).
const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY
const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY
const MODEL = 'claude-haiku-4-5-20251001'

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
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${uid}&select=id,role,owner_id,company_name,full_name`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    )
    if (!r.ok) return null
    const rows = await r.json()
    return rows && rows[0] ? rows[0] : null
  } catch { return null }
}

// Fail-closed rate limit on this paid (Anthropic) endpoint.
async function allowedRate(uid, max, windowSecs) {
  if (!SUPABASE_URL || !SERVICE_KEY) return false
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rate_limit_hit`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_user: uid, p_bucket: 'assistant', p_max: max, p_window_secs: windowSecs }),
    })
    if (!r.ok) return false
    return (await r.json()) === true
  } catch { return false }
}

// PostgREST as the USER (RLS enforced). Read-only helper for the read tools.
async function userGet(userToken, path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${userToken}` },
  })
  if (!r.ok) throw new Error('lookup failed: ' + r.status)
  return r.json()
}

const num = (v) => (typeof v === 'number' ? v : parseFloat(v)) || 0
const pad2 = (n) => String(n).padStart(2, '0')

// Date keys in the OWNER'S timezone. `tz` = minutes from getTimezoneOffset()
// (positive west of UTC), sent by the frontend so "today" and week grouping
// match what the owner sees, not the server's UTC clock.
const dateKeyOf = (d) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
const todayKey = (tz) => dateKeyOf(new Date(Date.now() - (tz || 0) * 60000))
// Sunday-start week key, matching the dashboard's weekStartKey().
function weekStartOf(dateLike, tz) {
  const d = new Date(new Date(dateLike).getTime() - (tz || 0) * 60000)
  d.setUTCHours(0, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() - d.getUTCDay())
  return dateKeyOf(d)
}
function addDaysKey(key, days) {
  const d = new Date(key + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return dateKeyOf(d)
}

// ---- Read tools (execute inline, under the user's RLS) --------------------
const ilikeSafe = (s) => encodeURIComponent(String(s).replace(/[%*,()]/g, ''))

// Every word must appear in `field`, in any order — "Delgado basement" still
// finds "Basement Finish – Delgado Residence". Null when one word (plain
// substring match already covers it).
function wordFilter(field, needle) {
  const words = String(needle).trim().split(/\s+/).filter((w) => w.length > 1)
  if (words.length < 2) return null
  return `and=(${words.map((w) => `${field}.ilike.*${ilikeSafe(w)}*`).join(',')})`
}

async function findProjects(userToken, jobName) {
  if (!jobName) return userGet(userToken, `projects?select=*&order=created_at.desc&limit=25`)
  const rows = await userGet(userToken, `projects?select=*&name=ilike.*${ilikeSafe(jobName)}*&order=created_at.desc`)
  if (rows && rows.length) return rows
  const wf = wordFilter('name', jobName)
  return wf ? userGet(userToken, `projects?select=*&${wf}&order=created_at.desc`) : rows
}

// Resolve a job name to one project or an ambiguity/miss object.
async function readJob(userToken, jobName) {
  const rows = await findProjects(userToken, jobName)
  if (!rows || !rows.length) return { error: 'No job found matching that name.' }
  if (rows.length > 1) {
    return { ambiguous: true, matches: rows.slice(0, 8).map((p) => p.name), note: 'Multiple jobs match — ask which one.' }
  }
  return { project: rows[0] }
}

async function findWorkers(userToken, uid, workerName) {
  const base = `profiles?select=id,full_name,hourly_rate&owner_id=eq.${uid}&role=eq.worker`
  if (!workerName) return userGet(userToken, base)
  const rows = await userGet(userToken, `${base}&full_name=ilike.*${ilikeSafe(workerName)}*`)
  if (rows && rows.length) return rows
  const wf = wordFilter('full_name', workerName)
  return wf ? userGet(userToken, `${base}&${wf}`) : rows
}

// Worker-side job lookup. Workers have NO read on the base projects table
// (FIX-16 Part B) — only the hard-scoped worker_projects view (assigned,
// non-completed jobs).
async function findMyProjects(userToken, jobName) {
  const base = `worker_projects?select=id,name,client_address,stage`
  if (!jobName) return userGet(userToken, base)
  const rows = await userGet(userToken, `${base}&name=ilike.*${ilikeSafe(jobName)}*`)
  if (rows && rows.length) return rows
  const wf = wordFilter('name', jobName)
  return wf ? userGet(userToken, `${base}&${wf}`) : rows
}

async function jobProfit(userToken, p) {
  // Mirror the dashboard's fetchSpend exactly: materials/other from receipts,
  // labor from CLOCKED-OUT time_entries (labor_spent is a dead column), and
  // contract = base budget + APPROVED change orders. Anything else drifts from
  // what the owner sees on the Jobs tab.
  const [receipts, times, cos] = await Promise.all([
    userGet(userToken, `receipts?select=amount,category&project_id=eq.${p.id}`),
    userGet(userToken, `time_entries?select=labor_cost&project_id=eq.${p.id}&clocked_out_at=not.is.null`),
    userGet(userToken, `change_orders?select=amount,status&project_id=eq.${p.id}`),
  ])
  let materials = 0, other = 0
  for (const r of receipts || []) {
    if (r.category === 'materials') materials += num(r.amount)
    else other += num(r.amount)
  }
  const labor = (times || []).reduce((s, t) => s + num(t.labor_cost), 0)
  const approvedCO = (cos || []).reduce((s, c) => s + (c.status === 'approved' ? num(c.amount) : 0), 0)
  const contract = num(p.budget) + approvedCO
  const spend = materials + other + labor
  return {
    job: p.name,
    contract_price: contract,
    spent: { materials, labor, other, total: spend },
    profit_so_far: contract - spend,
    profit_target: num(p.profit_target),
    stage: p.stage || null,
  }
}

// Profit for EVERY job in one shot, ranked. This is the ground truth for any
// "which job is most/least profitable / bleeding" question — computing it
// server-side (4 bulk queries, grouped in memory) stops the model from
// eyeballing single lookups and contradicting its own ranking. Mirrors the
// dashboard's fetchSpend math exactly so the numbers match the Jobs tab.
async function listJobProfits(userToken) {
  const projects = await userGet(
    userToken,
    `projects?select=id,name,budget,profit_target,stage&order=created_at.desc&limit=50`
  )
  if (!projects || !projects.length) return { jobs: [], note: 'No jobs yet.' }
  const ids = projects.map((p) => p.id)
  const inList = `(${ids.join(',')})`
  const [receipts, times, cos] = await Promise.all([
    userGet(userToken, `receipts?select=project_id,amount,category&project_id=in.${inList}`),
    userGet(userToken, `time_entries?select=project_id,labor_cost&clocked_out_at=not.is.null&project_id=in.${inList}`),
    userGet(userToken, `change_orders?select=project_id,amount,status&project_id=in.${inList}`),
  ])
  const spend = {}
  for (const id of ids) spend[id] = { materials: 0, labor: 0, other: 0 }
  for (const r of receipts || []) {
    if (!spend[r.project_id]) continue
    if (r.category === 'materials') spend[r.project_id].materials += num(r.amount)
    else spend[r.project_id].other += num(r.amount)
  }
  for (const t of times || []) {
    if (spend[t.project_id]) spend[t.project_id].labor += num(t.labor_cost)
  }
  const co = {}
  for (const c of cos || []) {
    if (c.status === 'approved') co[c.project_id] = (co[c.project_id] || 0) + num(c.amount)
  }
  const jobs = projects.map((p) => {
    const s = spend[p.id] || { materials: 0, labor: 0, other: 0 }
    const spent = s.materials + s.labor + s.other
    const contract = num(p.budget) + (co[p.id] || 0)
    return {
      job: p.name,
      contract_price: contract,
      spent_total: spent,
      profit_so_far: contract - spent,
      stage: p.stage || null,
    }
  })
  jobs.sort((a, b) => b.profit_so_far - a.profit_so_far)
  return {
    jobs,
    note: 'Already ranked: highest profit_so_far first. profit_so_far = contract price minus everything spent. Use this order as-is.',
  }
}

// Estimate totals, mirroring the dashboard's estItemAmount/estSubtotal/estTotal.
const estItemAmount = (it) => (num(it.qty)) * (num(it.unit_price))
const estSubtotal = (items) => (items || []).reduce((s, it) => s + estItemAmount(it), 0)

async function execRead(name, args, ctx) {
  const { token: userToken, uid, tz } = ctx
  switch (name) {
    case 'list_job_profits':
      return listJobProfits(userToken)
    case 'list_jobs': {
      const rows = await findProjects(userToken, null)
      return (rows || []).map((p) => ({
        job: p.name, contract_price: num(p.budget), stage: p.stage || null,
        client: p.client_name || null,
      }))
    }
    case 'get_job_profit': {
      const j = await readJob(userToken, args && args.job_name)
      if (j.error || j.ambiguous) return j
      return jobProfit(userToken, j.project)
    }
    case 'get_ar_summary': {
      const inv = await userGet(
        userToken,
        `invoices?select=label,amount,status,project_id,projects(name)&status=eq.unpaid`
      )
      const total = (inv || []).reduce((s, r) => s + num(r.amount), 0)
      return {
        total_owed: total,
        open_invoices: (inv || []).map((r) => ({
          label: r.label || 'Invoice', amount: num(r.amount),
          job: r.projects ? r.projects.name : null,
        })),
        count: (inv || []).length,
      }
    }
    case 'list_workers': {
      const rows = await findWorkers(userToken, uid, null)
      return (rows || []).map((w) => ({ name: w.full_name, hourly_rate: num(w.hourly_rate) }))
    }
    case 'get_worker_hours': {
      const ws = args && args.worker_name ? await findWorkers(userToken, uid, args.worker_name) : []
      if (!ws.length) return { error: 'No crew member found by that name.' }
      if (ws.length > 1) return { ambiguous: true, matches: ws.map((w) => w.full_name) }
      const w = ws[0]
      const weekStart = args && /^\d{4}-\d{2}-\d{2}$/.test(args.week_start || '') ? args.week_start : weekStartOf(Date.now(), tz)
      const since = addDaysKey(weekStart, -1) // small buffer for tz edges; grouped below
      const entries = await userGet(
        userToken,
        `time_entries?select=clocked_in_at,total_minutes,labor_cost,project_id,projects(name)&worker_id=eq.${w.id}&clocked_out_at=not.is.null&clocked_in_at=gte.${since}&order=clocked_in_at.desc&limit=200`
      )
      const inWeek = (entries || []).filter((t) => weekStartOf(t.clocked_in_at, tz) === weekStart)
      const minutes = inWeek.reduce((s, t) => s + (t.total_minutes || 0), 0)
      const cost = inWeek.reduce((s, t) => s + num(t.labor_cost), 0)
      const byJob = {}
      for (const t of inWeek) {
        const jn = t.projects ? t.projects.name : 'Unknown job'
        byJob[jn] = (byJob[jn] || 0) + (t.total_minutes || 0)
      }
      return {
        worker: w.full_name, week_start: weekStart, hourly_rate: num(w.hourly_rate),
        hours: Math.round((minutes / 60) * 100) / 100, pay_earned: cost,
        by_job: Object.entries(byJob).map(([job, mins]) => ({ job, hours: Math.round((mins / 60) * 100) / 100 })),
      }
    }
    case 'get_payroll_summary': {
      // Owed vs paid per worker per week — mirrors the dashboard's fetchPayroll
      // (group clocked-out entries by Sunday-start week, subtract recorded paychecks).
      const workers = await findWorkers(userToken, uid, null)
      if (!workers.length) return { weeks: [], note: 'No crew members yet.' }
      const ids = workers.map((w) => w.id)
      const since = addDaysKey(todayKey(tz), -60)
      const [times, checks] = await Promise.all([
        userGet(userToken, `time_entries?select=worker_id,total_minutes,labor_cost,clocked_in_at&worker_id=in.(${ids.join(',')})&clocked_out_at=not.is.null&clocked_in_at=gte.${since}&limit=1000`),
        userGet(userToken, `paychecks?select=worker_id,week_start,gross_pay`),
      ])
      const nameOf = {}
      for (const w of workers) nameOf[w.id] = w.full_name
      const rows = {}
      for (const t of times || []) {
        const wsk = weekStartOf(t.clocked_in_at, tz)
        const key = t.worker_id + '|' + wsk
        if (!rows[key]) rows[key] = { worker: nameOf[t.worker_id] || 'Worker', week_start: wsk, minutes: 0, gross: 0, paid: false }
        rows[key].minutes += t.total_minutes || 0
        rows[key].gross += num(t.labor_cost)
      }
      for (const c of checks || []) {
        const key = c.worker_id + '|' + c.week_start
        if (rows[key]) rows[key].paid = true
      }
      const weeks = Object.values(rows)
        .map((r) => ({ ...r, hours: Math.round((r.minutes / 60) * 100) / 100 }))
        .sort((a, b) => b.week_start.localeCompare(a.week_start))
      const owed = weeks.filter((r) => !r.paid).reduce((s, r) => s + r.gross, 0)
      return { total_unpaid: owed, weeks: weeks.slice(0, 20) }
    }
    case 'list_invoices': {
      const status = args && ['unpaid', 'paid'].includes(args.status) ? args.status : null
      const q = `invoices?select=label,amount,status,issued_date,due_date,paid_at,projects(name)${status ? `&status=eq.${status}` : ''}&order=issued_date.desc&limit=40`
      const rows = await userGet(userToken, q)
      return (rows || []).map((r) => ({
        label: r.label || 'Invoice', amount: num(r.amount), status: r.status,
        job: r.projects ? r.projects.name : null,
        issued: r.issued_date || null, due: r.due_date || null, paid_at: r.paid_at || null,
      }))
    }
    case 'list_estimates': {
      const rows = await userGet(userToken, `estimates?select=title,client_name,status,items,tax_rate,created_at&order=created_at.desc&limit=25`)
      return (rows || []).map((e) => {
        const sub = estSubtotal(Array.isArray(e.items) ? e.items : [])
        return {
          title: e.title || '(untitled)', client: e.client_name || null, status: e.status,
          subtotal: Math.round(sub * 100) / 100,
          total_with_tax: Math.round((sub + (sub * num(e.tax_rate)) / 100) * 100) / 100,
        }
      })
    }
    case 'get_schedule': {
      const days = args && Number.isFinite(num(args.days_ahead)) && num(args.days_ahead) > 0 ? Math.min(num(args.days_ahead), 31) : 7
      const start = todayKey(tz)
      const end = addDaysKey(start, days)
      const rows = await userGet(
        userToken,
        `schedule_entries?select=scheduled_date,start_time,end_time,task_description,projects(name),profiles!schedule_entries_worker_id_fkey(full_name)&scheduled_date=gte.${start}&scheduled_date=lte.${end}&order=scheduled_date.asc&limit=100`
      )
      return (rows || []).map((s) => ({
        date: s.scheduled_date, start: s.start_time, end: s.end_time,
        task: s.task_description, job: s.projects ? s.projects.name : null,
        worker: s.profiles ? s.profiles.full_name : null,
      }))
    }
    case 'get_job_items': {
      const j = await readJob(userToken, args && args.job_name)
      if (j.error || j.ambiguous) return j
      const pid = j.project.id
      const topic = args && args.topic
      if (topic === 'daily_logs') {
        const rows = await userGet(userToken, `daily_logs?select=log_date,weather,note&project_id=eq.${pid}&order=log_date.desc&limit=14`)
        return { job: j.project.name, daily_logs: rows || [] }
      }
      if (topic === 'change_orders') {
        const rows = await userGet(userToken, `change_orders?select=description,amount,status&project_id=eq.${pid}&order=created_at.desc&limit=30`)
        return { job: j.project.name, change_orders: (rows || []).map((c) => ({ description: c.description, amount: num(c.amount), status: c.status })) }
      }
      if (topic === 'punch_list') {
        const rows = await userGet(userToken, `punch_items?select=description,done&project_id=eq.${pid}&limit=60`)
        return { job: j.project.name, punch_list: rows || [] }
      }
      if (topic === 'materials_list') {
        const rows = await userGet(userToken, `material_items?select=name,qty,bought&project_id=eq.${pid}&limit=60`)
        return { job: j.project.name, materials_list: rows || [] }
      }
      if (topic === 'permits') {
        const rows = await userGet(userToken, `permits?select=name,status,permit_number,inspection_on,notes&project_id=eq.${pid}&limit=30`)
        return { job: j.project.name, permits: rows || [] }
      }
      if (topic === 'mileage') {
        const rows = await userGet(userToken, `mileage_entries?select=trip_date,miles,rate,notes&project_id=eq.${pid}&order=trip_date.desc&limit=60`)
        const deduction = (rows || []).reduce((s, m) => s + num(m.miles) * num(m.rate), 0)
        return { job: j.project.name, trips: rows || [], total_deduction: Math.round(deduction * 100) / 100 }
      }
      if (topic === 'warranties') {
        const rows = await userGet(userToken, `warranties?select=description,status,due_on&project_id=eq.${pid}&limit=30`)
        return { job: j.project.name, warranties: rows || [] }
      }
      return { error: 'Unknown topic.' }
    }
    case 'list_compliance': {
      const [items, warr] = await Promise.all([
        userGet(userToken, `compliance_items?select=kind,name,reference,expires_on,notes&order=expires_on.asc.nullslast&limit=40`),
        userGet(userToken, `warranties?select=description,status,due_on,projects(name)&limit=40`),
      ])
      return {
        compliance: items || [],
        warranties: (warr || []).map((w) => ({ description: w.description, status: w.status, due_on: w.due_on, job: w.projects ? w.projects.name : null })),
      }
    }
    case 'list_time_off': {
      const rows = await userGet(userToken, `time_off_requests?select=start_date,end_date,status,worker_id&order=created_at.desc&limit=20`)
      const workers = await findWorkers(userToken, uid, null)
      const nameOf = {}
      for (const w of workers) nameOf[w.id] = w.full_name
      return (rows || []).map((r) => ({
        worker: nameOf[r.worker_id] || 'Worker', from: r.start_date, to: r.end_date, status: r.status,
      }))
    }
    // ---- Worker-side reads: everything below runs through the hard-scoped
    // worker_* views or the worker's own rows. No owner money data.
    case 'my_jobs': {
      const rows = await findMyProjects(userToken, null)
      return (rows || []).map((p) => ({ job: p.name, address: p.client_address || null, stage: p.stage || null }))
    }
    case 'clock_status': {
      const rows = await userGet(userToken, `time_entries?select=project_id,clocked_in_at&worker_id=eq.${uid}&clocked_out_at=is.null&limit=1`)
      if (!rows || !rows.length) return { clocked_in: false }
      const open = rows[0]
      let jobName = null
      try {
        const ps = await userGet(userToken, `worker_projects?select=id,name&id=eq.${open.project_id}`)
        jobName = ps && ps[0] ? ps[0].name : null
      } catch {}
      return { clocked_in: true, job: jobName, since: open.clocked_in_at }
    }
    case 'my_hours': {
      const weekStart = args && /^\d{4}-\d{2}-\d{2}$/.test(args.week_start || '') ? args.week_start : weekStartOf(Date.now(), tz)
      const since = addDaysKey(weekStart, -1) // tz-edge buffer; grouped below
      const entries = await userGet(
        userToken,
        `worker_time_entries?select=clocked_in_at,total_minutes,labor_cost,project_name&clocked_out_at=not.is.null&clocked_in_at=gte.${since}&order=clocked_in_at.desc&limit=200`
      )
      const inWeek = (entries || []).filter((t) => weekStartOf(t.clocked_in_at, tz) === weekStart)
      const minutes = inWeek.reduce((s, t) => s + (t.total_minutes || 0), 0)
      const pay = inWeek.reduce((s, t) => s + num(t.labor_cost), 0)
      const byJob = {}
      for (const t of inWeek) {
        const jn = t.project_name || 'Unknown job'
        byJob[jn] = (byJob[jn] || 0) + (t.total_minutes || 0)
      }
      return {
        week_start: weekStart,
        hours: Math.round((minutes / 60) * 100) / 100,
        pay_earned: pay,
        by_job: Object.entries(byJob).map(([job, mins]) => ({ job, hours: Math.round((mins / 60) * 100) / 100 })),
      }
    }
    case 'my_schedule': {
      const days = args && Number.isFinite(num(args.days_ahead)) && num(args.days_ahead) > 0 ? Math.min(num(args.days_ahead), 31) : 7
      const start = todayKey(tz)
      const end = addDaysKey(start, days)
      const rows = await userGet(
        userToken,
        `worker_schedule?select=scheduled_date,start_time,end_time,task_description,project_name&scheduled_date=gte.${start}&scheduled_date=lte.${end}&order=scheduled_date.asc&limit=100`
      )
      return (rows || []).map((s) => ({
        date: s.scheduled_date, start: s.start_time, end: s.end_time,
        task: s.task_description, job: s.project_name || null,
      }))
    }
    case 'my_time_off': {
      const rows = await userGet(userToken, `time_off_requests?select=start_date,end_date,reason,status&worker_id=eq.${uid}&order=created_at.desc&limit=20`)
      return (rows || []).map((r) => ({ from: r.start_date, to: r.end_date, reason: r.reason || null, status: r.status }))
    }
    default:
      return { error: 'Unknown read tool.' }
  }
}

// ---- Tool schemas exposed to the model ------------------------------------
const NO_ARGS = { type: 'object', properties: {}, additionalProperties: false }
const JOB_ARG = { job_name: { type: 'string', description: 'Name (or part of the name) of the job.' } }

const READ_TOOLS = [
  {
    name: 'list_job_profits',
    description:
      'Profit for ALL jobs at once, already ranked highest-profit-first. Use this for ANY question that compares or ranks jobs by money — "most/least profitable job", "rank my jobs", "which jobs are losing money / bleeding", "best job". Returns each job with contract price, total spent, and profit so far. Never rank jobs from separate single lookups — use this so the order is consistent.',
    input_schema: NO_ARGS,
  },
  {
    name: 'list_jobs',
    description: "List the owner's jobs with contract price, client, and stage. Use to find the exact job name before other tools.",
    input_schema: NO_ARGS,
  },
  {
    name: 'get_job_profit',
    description: 'Get contract price, money spent (materials/labor/other), and profit so far for one job.',
    input_schema: { type: 'object', properties: { ...JOB_ARG }, required: ['job_name'], additionalProperties: false },
  },
  {
    name: 'get_ar_summary',
    description: 'Summarize what clients still owe: total of unpaid invoices and the open invoices with their jobs.',
    input_schema: NO_ARGS,
  },
  {
    name: 'list_workers',
    description: 'List crew members with their hourly rates.',
    input_schema: NO_ARGS,
  },
  {
    name: 'get_worker_hours',
    description: "One crew member's clocked hours, pay earned, and per-job breakdown for a week (defaults to this week).",
    input_schema: {
      type: 'object',
      properties: {
        worker_name: { type: 'string' },
        week_start: { type: 'string', description: 'Optional Sunday week start, YYYY-MM-DD. Defaults to this week.' },
      },
      required: ['worker_name'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_payroll_summary',
    description: 'Weekly payroll: hours and gross pay per crew member per week (last ~8 weeks), marked paid or still owed. Use for "who do I owe / payroll this week".',
    input_schema: NO_ARGS,
  },
  {
    name: 'list_invoices',
    description: 'List invoices (label, amount, job, status, dates). Optionally filter by status.',
    input_schema: {
      type: 'object',
      properties: { status: { type: 'string', enum: ['unpaid', 'paid'] } },
      additionalProperties: false,
    },
  },
  {
    name: 'list_estimates',
    description: 'List estimates with client, status (draft/sent/accepted/declined), and totals.',
    input_schema: NO_ARGS,
  },
  {
    name: 'get_schedule',
    description: "The crew schedule for the next N days (default 7): who's on which job, when, doing what.",
    input_schema: {
      type: 'object',
      properties: { days_ahead: { type: 'number', description: '1–31, default 7.' } },
      additionalProperties: false,
    },
  },
  {
    name: 'get_job_items',
    description: "One job's records by topic: daily_logs, change_orders, punch_list, materials_list (shopping list), permits, mileage, or warranties.",
    input_schema: {
      type: 'object',
      properties: {
        ...JOB_ARG,
        topic: { type: 'string', enum: ['daily_logs', 'change_orders', 'punch_list', 'materials_list', 'permits', 'mileage', 'warranties'] },
      },
      required: ['job_name', 'topic'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_compliance',
    description: 'Business compliance items (insurance, licenses, certifications, expiry dates) plus warranty callbacks.',
    input_schema: NO_ARGS,
  },
  {
    name: 'list_time_off',
    description: 'Crew time-off requests and their status (pending/approved/denied).',
    input_schema: NO_ARGS,
  },
]

const WRITE_TOOLS = [
  {
    name: 'add_expense',
    description: 'Add a material/expense cost to a job. WRITE — the owner will confirm before it saves.',
    input_schema: {
      type: 'object',
      properties: {
        ...JOB_ARG,
        amount: { type: 'number', description: 'Dollar amount, e.g. 42.50' },
        store: { type: 'string', description: 'Where it was bought (optional).' },
        category: { type: 'string', enum: ['materials', 'labor', 'other'], description: 'Defaults to materials.' },
        description: { type: 'string', description: 'What it was (optional).' },
      },
      required: ['job_name', 'amount'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_job',
    description: 'Create a new job. WRITE — confirmed before saving.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        client_name: { type: 'string' },
        client_phone: { type: 'string' },
        client_email: { type: 'string' },
        client_address: { type: 'string' },
        contract_price: { type: 'number', description: 'What the client pays, if known.' },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_job',
    description: 'Update job details: rename, client info, or contract price. WRITE — confirmed before saving.',
    input_schema: {
      type: 'object',
      properties: {
        ...JOB_ARG,
        new_name: { type: 'string' },
        client_name: { type: 'string' },
        client_phone: { type: 'string' },
        client_email: { type: 'string' },
        client_address: { type: 'string' },
        contract_price: { type: 'number', description: 'New contract price (what the client pays).' },
      },
      required: ['job_name'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_job_stage',
    description: 'Move a job between stages: start → mid → end (end marks it complete), or reopen a completed job. WRITE — confirmed.',
    input_schema: {
      type: 'object',
      properties: {
        ...JOB_ARG,
        stage: { type: 'string', enum: ['start', 'mid', 'end', 'reopen'], description: '"end" = mark complete; "reopen" = un-complete back to mid.' },
      },
      required: ['job_name', 'stage'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_time_entry',
    description: "Log a crew member's hours on a job for a day (owner forgot to have them clock in). Pay is computed from their hourly rate. WRITE — confirmed.",
    input_schema: {
      type: 'object',
      properties: {
        ...JOB_ARG,
        worker_name: { type: 'string' },
        date: { type: 'string', description: 'YYYY-MM-DD.' },
        start_time: { type: 'string', description: 'HH:MM 24h. Default 08:00.' },
        end_time: { type: 'string', description: 'HH:MM 24h. Give this OR hours.' },
        hours: { type: 'number', description: 'Hours worked, if no end time given.' },
      },
      required: ['job_name', 'worker_name', 'date'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_mileage',
    description: 'Log a mileage trip for a job (tax deduction). WRITE — confirmed.',
    input_schema: {
      type: 'object',
      properties: {
        ...JOB_ARG,
        miles: { type: 'number' },
        trip_date: { type: 'string', description: 'YYYY-MM-DD, default today.' },
        rate: { type: 'number', description: 'Per-mile rate. Default 0.70 (IRS).' },
        notes: { type: 'string' },
      },
      required: ['job_name', 'miles'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_daily_log',
    description: "Add a daily log note to a job's diary (what happened on site, weather). WRITE — confirmed.",
    input_schema: {
      type: 'object',
      properties: {
        ...JOB_ARG,
        note: { type: 'string' },
        weather: { type: 'string' },
        log_date: { type: 'string', description: 'YYYY-MM-DD, default today.' },
      },
      required: ['job_name', 'note'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_change_order',
    description: 'Add a change order to a job (extra work / price change). Only APPROVED change orders count toward the contract price. WRITE — confirmed.',
    input_schema: {
      type: 'object',
      properties: {
        ...JOB_ARG,
        description: { type: 'string' },
        amount: { type: 'number', description: 'Dollar amount (can be negative for credits).' },
        status: { type: 'string', enum: ['approved', 'pending', 'declined'], description: 'Use approved when the client already agreed; else pending.' },
      },
      required: ['job_name', 'description', 'amount'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_punch_item',
    description: "Add a to-do to a job's punch list. WRITE — confirmed.",
    input_schema: {
      type: 'object',
      properties: { ...JOB_ARG, description: { type: 'string' } },
      required: ['job_name', 'description'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_punch_item',
    description: 'Check off (or un-check) a punch-list item on a job. WRITE — confirmed.',
    input_schema: {
      type: 'object',
      properties: {
        ...JOB_ARG,
        description: { type: 'string', description: 'The item text (or enough of it to match one item).' },
        done: { type: 'boolean' },
      },
      required: ['job_name', 'description', 'done'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_material_item',
    description: "Add an item to a job's materials shopping list. WRITE — confirmed.",
    input_schema: {
      type: 'object',
      properties: {
        ...JOB_ARG,
        name: { type: 'string' },
        qty: { type: 'string', description: 'Free-text quantity like "12" or "3 boxes" (optional).' },
      },
      required: ['job_name', 'name'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_material_item',
    description: 'Mark a materials-list item bought (or not bought). WRITE — confirmed.',
    input_schema: {
      type: 'object',
      properties: {
        ...JOB_ARG,
        name: { type: 'string', description: 'The item name (or enough to match one item).' },
        bought: { type: 'boolean' },
      },
      required: ['job_name', 'name', 'bought'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_invoice',
    description: 'Create an invoice on a job (what the client owes). WRITE — confirmed.',
    input_schema: {
      type: 'object',
      properties: {
        ...JOB_ARG,
        amount: { type: 'number' },
        label: { type: 'string', description: 'e.g. "Deposit", "Final payment". Default "Invoice".' },
        due_date: { type: 'string', description: 'YYYY-MM-DD (optional).' },
        notes: { type: 'string' },
      },
      required: ['job_name', 'amount'],
      additionalProperties: false,
    },
  },
  {
    name: 'mark_invoice_paid',
    description: 'Mark an unpaid invoice as paid. Identify it by job and/or label and/or amount. WRITE — confirmed.',
    input_schema: {
      type: 'object',
      properties: {
        job_name: { type: 'string' },
        label: { type: 'string' },
        amount: { type: 'number' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'create_estimate',
    description: 'Create a draft estimate with line items. Item kind: materials, labor, or other (markup/overhead). WRITE — confirmed.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        client_name: { type: 'string' },
        client_phone: { type: 'string' },
        client_email: { type: 'string' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              description: { type: 'string' },
              qty: { type: 'number' },
              unit_price: { type: 'number' },
              kind: { type: 'string', enum: ['materials', 'labor', 'other'] },
            },
            required: ['description', 'unit_price'],
            additionalProperties: false,
          },
        },
        tax_rate: { type: 'number', description: 'Percent, e.g. 8 for 8%.' },
        notes: { type: 'string' },
      },
      required: ['title', 'items'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_estimate_status',
    description: 'Mark an estimate sent or declined. WRITE — confirmed.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Estimate title (or enough to match one).' },
        status: { type: 'string', enum: ['sent', 'declined'] },
      },
      required: ['title', 'status'],
      additionalProperties: false,
    },
  },
  {
    name: 'accept_estimate',
    description: 'Accept an estimate and create a job from it (contract = pre-tax subtotal, budgets from item kinds). WRITE — confirmed.',
    input_schema: {
      type: 'object',
      properties: { title: { type: 'string', description: 'Estimate title (or enough to match one).' } },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_worker_rate',
    description: "Change a crew member's hourly pay rate. WRITE — confirmed.",
    input_schema: {
      type: 'object',
      properties: {
        worker_name: { type: 'string' },
        hourly_rate: { type: 'number' },
      },
      required: ['worker_name', 'hourly_rate'],
      additionalProperties: false,
    },
  },
  {
    name: 'assign_worker',
    description: 'Assign a crew member to a job so they can clock in on it. WRITE — confirmed.',
    input_schema: {
      type: 'object',
      properties: { worker_name: { type: 'string' }, ...JOB_ARG },
      required: ['worker_name', 'job_name'],
      additionalProperties: false,
    },
  },
  {
    name: 'decide_time_off',
    description: "Approve or deny a crew member's pending time-off request. WRITE — confirmed.",
    input_schema: {
      type: 'object',
      properties: {
        worker_name: { type: 'string' },
        decision: { type: 'string', enum: ['approve', 'deny'] },
      },
      required: ['worker_name', 'decision'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_schedule_entry',
    description: 'Schedule a crew member on a job for a date and time window. WRITE — confirmed.',
    input_schema: {
      type: 'object',
      properties: {
        worker_name: { type: 'string' },
        ...JOB_ARG,
        task_description: { type: 'string' },
        date: { type: 'string', description: 'YYYY-MM-DD.' },
        start_time: { type: 'string', description: 'HH:MM 24h.' },
        end_time: { type: 'string', description: 'HH:MM 24h.' },
      },
      required: ['worker_name', 'job_name', 'date', 'start_time', 'end_time'],
      additionalProperties: false,
    },
  },
  {
    name: 'record_paycheck',
    description: "Record a weekly paycheck as paid for a crew member (hours and gross computed from their clocked time that week). WRITE — confirmed.",
    input_schema: {
      type: 'object',
      properties: {
        worker_name: { type: 'string' },
        week_start: { type: 'string', description: 'Sunday week start YYYY-MM-DD. Default: the most recent unpaid week.' },
      },
      required: ['worker_name'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_permit',
    description: 'Add a permit to a job. WRITE — confirmed.',
    input_schema: {
      type: 'object',
      properties: {
        ...JOB_ARG,
        name: { type: 'string' },
        status: { type: 'string', enum: ['applied', 'approved', 'inspection', 'passed', 'failed'], description: 'Default applied.' },
        permit_number: { type: 'string' },
        inspection_on: { type: 'string', description: 'YYYY-MM-DD (optional).' },
        notes: { type: 'string' },
      },
      required: ['job_name', 'name'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_permit_status',
    description: "Update a permit's status on a job. WRITE — confirmed.",
    input_schema: {
      type: 'object',
      properties: {
        ...JOB_ARG,
        name: { type: 'string', description: 'Permit name (or enough to match one).' },
        status: { type: 'string', enum: ['applied', 'approved', 'inspection', 'passed', 'failed'] },
      },
      required: ['job_name', 'name', 'status'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_warranty',
    description: 'Add a warranty callback item (optionally tied to a job). WRITE — confirmed.',
    input_schema: {
      type: 'object',
      properties: {
        description: { type: 'string' },
        job_name: { type: 'string', description: 'Optional job to tie it to.' },
        due_on: { type: 'string', description: 'YYYY-MM-DD (optional).' },
      },
      required: ['description'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_warranty_status',
    description: 'Update a warranty callback: open, scheduled, or closed. WRITE — confirmed.',
    input_schema: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'The warranty text (or enough to match one).' },
        status: { type: 'string', enum: ['open', 'scheduled', 'closed'] },
      },
      required: ['description', 'status'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_compliance_item',
    description: 'Track an insurance policy, license, or certification with its expiry. WRITE — confirmed.',
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['insurance', 'license', 'certification'] },
        name: { type: 'string' },
        reference: { type: 'string', description: 'Policy/license number (optional).' },
        expires_on: { type: 'string', description: 'YYYY-MM-DD (optional).' },
        notes: { type: 'string' },
      },
      required: ['kind', 'name'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_settings',
    description: "Update the owner's company name or display name. WRITE — confirmed.",
    input_schema: {
      type: 'object',
      properties: {
        company_name: { type: 'string' },
        full_name: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'invite_worker',
    description: 'Create a one-time invite link for a new crew member (owner texts it to them). WRITE — confirmed.',
    input_schema: {
      type: 'object',
      properties: { worker_name: { type: 'string' } },
      required: ['worker_name'],
      additionalProperties: false,
    },
  },
  {
    name: 'remove_worker',
    description: 'Remove a crew member from the company (they keep their account but lose access to your jobs). WRITE — confirmed.',
    input_schema: {
      type: 'object',
      properties: { worker_name: { type: 'string' } },
      required: ['worker_name'],
      additionalProperties: false,
    },
  },
]

const WRITE_NAMES = new Set(WRITE_TOOLS.map((t) => t.name))

// ---- Worker (crew) toolset --------------------------------------------------
// Workers get ONLY these — never the owner tools. Reads run through the
// hard-scoped worker_* views; writes are the three things a crew member can
// already do in the UI (clock in, clock out, ask for time off).
const WORKER_READ_TOOLS = [
  {
    name: 'my_jobs',
    description: 'List the jobs this crew member is assigned to (name, address, stage). Use to find the exact job name before clocking in.',
    input_schema: NO_ARGS,
  },
  {
    name: 'clock_status',
    description: 'Whether the crew member is currently clocked in, on which job, and since when. Check this before clocking in or out.',
    input_schema: NO_ARGS,
  },
  {
    name: 'my_hours',
    description: "The crew member's own clocked hours, pay earned, and per-job breakdown for a week (defaults to this week).",
    input_schema: {
      type: 'object',
      properties: {
        week_start: { type: 'string', description: 'Optional Sunday week start, YYYY-MM-DD. Defaults to this week.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'my_schedule',
    description: "The crew member's own schedule for the next N days (default 7): which job, when, doing what.",
    input_schema: {
      type: 'object',
      properties: { days_ahead: { type: 'number', description: '1–31, default 7.' } },
      additionalProperties: false,
    },
  },
  {
    name: 'my_time_off',
    description: "The crew member's own time-off requests and their status (pending/approved/denied).",
    input_schema: NO_ARGS,
  },
]

const WORKER_WRITE_TOOLS = [
  {
    name: 'clock_in',
    description: 'Clock the crew member in on a job right now. WRITE — they confirm before it saves. Fails if they are already clocked in.',
    input_schema: {
      type: 'object',
      properties: { job_name: { type: 'string', description: 'Name (or part of the name) of the assigned job.' } },
      required: ['job_name'],
      additionalProperties: false,
    },
  },
  {
    name: 'clock_out',
    description: 'Clock the crew member out of their open shift right now (hours and pay computed from the clock-in time). WRITE — confirmed.',
    input_schema: NO_ARGS,
  },
  {
    name: 'request_time_off',
    description: 'Send the boss a time-off request for a date or date range. WRITE — confirmed.',
    input_schema: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: 'YYYY-MM-DD.' },
        end_date: { type: 'string', description: 'YYYY-MM-DD. Same as start_date for a single day.' },
        reason: { type: 'string', description: 'Optional short reason.' },
      },
      required: ['start_date', 'end_date'],
      additionalProperties: false,
    },
  },
]

const WORKER_WRITE_NAMES = new Set(WORKER_WRITE_TOOLS.map((t) => t.name))

// Plain-English confirm text, derived server-side (not trusted from the model).
function summarize(tool, a) {
  const money = (n) => '$' + Number(num(n)).toFixed(2)
  switch (tool) {
    case 'add_expense': {
      const cat = a.category && a.category !== 'materials' ? ` ${a.category}` : ''
      return `Add a ${money(a.amount)}${cat} expense${a.store ? ` from ${a.store}` : ''} to “${a.job_name}”.`
    }
    case 'create_job':
      return `Create a new job “${a.name}”${a.client_name ? ` for ${a.client_name}` : ''}${a.contract_price ? ` — contract ${money(a.contract_price)}` : ''}.`
    case 'update_job': {
      const parts = []
      if (a.new_name) parts.push(`rename it to “${a.new_name}”`)
      if (a.contract_price != null) parts.push(`set the contract price to ${money(a.contract_price)}`)
      if (a.client_name) parts.push(`set the client to ${a.client_name}`)
      if (a.client_phone) parts.push(`update the client phone`)
      if (a.client_email) parts.push(`update the client email`)
      if (a.client_address) parts.push(`update the client address`)
      return `Update “${a.job_name}”: ${parts.join(', ') || 'no changes'}.`
    }
    case 'set_job_stage':
      return a.stage === 'reopen'
        ? `Reopen the completed job “${a.job_name}”.`
        : a.stage === 'end'
          ? `Mark “${a.job_name}” COMPLETE.`
          : `Move “${a.job_name}” to the ${a.stage === 'start' ? 'Starting' : 'Mid-project'} stage.`
    case 'add_time_entry': {
      const span = a.end_time ? `${a.start_time || '08:00'}–${a.end_time}` : `${num(a.hours)} hour${num(a.hours) === 1 ? '' : 's'}`
      return `Log ${span} for ${a.worker_name} on “${a.job_name}” (${a.date}). Pay comes from their hourly rate.`
    }
    case 'add_mileage':
      return `Log ${num(a.miles)} miles${a.trip_date ? ` on ${a.trip_date}` : ' today'} for “${a.job_name}” at ${money(a.rate != null ? a.rate : 0.70)}/mile.`
    case 'add_daily_log':
      return `Add a daily log to “${a.job_name}”${a.log_date ? ` for ${a.log_date}` : ''}: “${String(a.note || '').slice(0, 80)}${String(a.note || '').length > 80 ? '…' : ''}”`
    case 'add_change_order':
      return `Add a ${a.status || 'approved'} change order to “${a.job_name}”: ${money(a.amount)} — ${a.description}.${(a.status || 'approved') === 'approved' ? ' This changes the contract price.' : ''}`
    case 'add_punch_item':
      return `Add to the punch list on “${a.job_name}”: “${a.description}”.`
    case 'set_punch_item':
      return `${a.done ? 'Check off' : 'Un-check'} the punch-list item matching “${a.description}” on “${a.job_name}”.`
    case 'add_material_item':
      return `Add “${a.name}”${a.qty ? ` (${a.qty})` : ''} to the materials list on “${a.job_name}”.`
    case 'set_material_item':
      return `Mark “${a.name}” as ${a.bought ? 'bought' : 'not bought'} on “${a.job_name}”.`
    case 'create_invoice':
      return `Create a ${money(a.amount)} invoice${a.label ? ` (“${a.label}”)` : ''} on “${a.job_name}”${a.due_date ? `, due ${a.due_date}` : ''}.`
    case 'mark_invoice_paid': {
      const bits = [a.label && `“${a.label}”`, a.amount != null && money(a.amount), a.job_name && `on “${a.job_name}”`].filter(Boolean)
      return `Mark the unpaid invoice ${bits.join(' ') || '(most recent match)'} as PAID.`
    }
    case 'create_estimate': {
      const sub = estSubtotal(a.items || [])
      return `Create a draft estimate “${a.title}”${a.client_name ? ` for ${a.client_name}` : ''} — ${(a.items || []).length} line item(s), subtotal ${money(sub)}${a.tax_rate ? ` + ${num(a.tax_rate)}% tax` : ''}.`
    }
    case 'set_estimate_status':
      return `Mark the estimate matching “${a.title}” as ${a.status.toUpperCase()}.`
    case 'accept_estimate':
      return `Accept the estimate matching “${a.title}” and create a job from it (contract = pre-tax subtotal).`
    case 'set_worker_rate':
      return `Change ${a.worker_name}'s hourly rate to ${money(a.hourly_rate)}/hr. Affects future clocked time, not past entries.`
    case 'assign_worker':
      return `Assign ${a.worker_name} to “${a.job_name}” so they can clock in on it.`
    case 'decide_time_off':
      return `${a.decision === 'approve' ? 'APPROVE' : 'DENY'} ${a.worker_name}'s pending time-off request.`
    case 'add_schedule_entry':
      return `Schedule ${a.worker_name} on “${a.job_name}” ${a.date} ${a.start_time}–${a.end_time}${a.task_description ? `: ${a.task_description}` : ''}.`
    case 'record_paycheck':
      return `Record ${a.worker_name}'s paycheck${a.week_start ? ` for the week of ${a.week_start}` : ' for their most recent unpaid week'} as PAID (hours and gross come from their clocked time).`
    case 'add_permit':
      return `Add permit “${a.name}” (${a.status || 'applied'}) to “${a.job_name}”.`
    case 'set_permit_status':
      return `Set permit “${a.name}” on “${a.job_name}” to ${a.status.toUpperCase()}.`
    case 'add_warranty':
      return `Add a warranty callback${a.job_name ? ` on “${a.job_name}”` : ''}: “${a.description}”${a.due_on ? `, due ${a.due_on}` : ''}.`
    case 'set_warranty_status':
      return `Set the warranty matching “${a.description}” to ${a.status.toUpperCase()}.`
    case 'add_compliance_item':
      return `Track ${a.kind} “${a.name}”${a.expires_on ? `, expires ${a.expires_on}` : ''}.`
    case 'update_settings': {
      const parts = []
      if (a.company_name) parts.push(`company name → “${a.company_name}”`)
      if (a.full_name) parts.push(`your name → “${a.full_name}”`)
      return `Update settings: ${parts.join(', ') || 'no changes'}.`
    }
    case 'invite_worker':
      return `Create an invite link for new crew member “${a.worker_name}” (you text it to them; they set a password and are linked to your company).`
    case 'remove_worker':
      return `REMOVE ${a.worker_name} from your crew. They lose access to your jobs (their past hours stay on record). This can't be undone from the app.`
    case 'clock_in':
      return `Clock you IN on “${a.job_name}” starting now.`
    case 'clock_out':
      return `Clock you OUT now — your hours and pay are computed from when you clocked in.`
    case 'request_time_off': {
      const span = a.end_date && a.end_date !== a.start_date ? `${a.start_date} through ${a.end_date}` : `${a.start_date}`
      return `Send your boss a time-off request for ${span}${a.reason ? ` — “${String(a.reason).slice(0, 60)}”` : ''}.`
    }
    default:
      return 'Make a change in JobTally.'
  }
}

async function callClaude(system, messages, tools) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1200,
      system,
      tools,
      messages,
    }),
  })
  const data = await r.json()
  if (!r.ok) {
    console.error('assistant: Anthropic error', r.status, data && data.error)
    const e = new Error('anthropic')
    e.status = r.status
    throw e
  }
  return data
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  if (!ANTHROPIC_KEY || !SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    console.error('assistant: missing env config')
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

  // 30 assistant turns/hour/user — plenty for real use, a hard stop on a loop.
  if (!(await allowedRate(user.id, 30, 3600))) {
    return res.status(429).json({ error: 'One moment — too many assistant requests. Try again shortly.' })
  }

  const body = req.body || {}
  const userMessage = typeof body.message === 'string' ? body.message.trim() : ''
  // Prior turns (optional), passed straight through from the client. Kept small.
  const history = Array.isArray(body.history) ? body.history.slice(-8) : []
  // Owner's timezone offset in minutes (getTimezoneOffset), so "today" and
  // week grouping match their clock, not the server's UTC.
  const tz = Number.isFinite(body.tz) ? Math.max(-840, Math.min(840, body.tz)) : 0
  if (!userMessage) return res.status(400).json({ error: 'Empty message' })
  if (userMessage.length > 2000) return res.status(413).json({ error: 'Message too long' })

  const who = profile.full_name || (isOwner ? 'the owner' : 'a crew member')
  const company = profile.company_name ? ` at ${profile.company_name}` : ''
  const ownerSystem =
    `You are the JobTally assistant for ${who}${company}, a contractor business owner. ` +
    `You can look anything up AND make changes for them — jobs, money, crew, schedule, estimates, invoices, permits, compliance. ` +
    `Today's date is ${todayKey(tz)} and yesterday was ${addDaysKey(todayKey(tz), -1)}. Work out relative dates ("yesterday", "last Friday") from today's date yourself — never ask the owner for a date you can compute. ` +
    `Replies are read on a phone: short and plain, no markdown tables. Money is USD.\n\n` +
    `HOW THE APP'S MONEY WORKS (never deviate):\n` +
    `- contract_price = the job's REVENUE (base contract + APPROVED change orders). It is NOT profit.\n` +
    `- Profit so far = contract price minus everything spent (material/other receipts + labor from clocked time). Never call the contract price "profit."\n` +
    `- To compare or rank jobs by money (most/least profitable, bleeding), call list_job_profits — it returns every job already ranked; report that order exactly, never re-rank from memory.\n` +
    `- Crew pay comes from clocked-out time entries (hours x their hourly rate), grouped into Sunday-start weeks; record_paycheck marks a week paid.\n` +
    `- Estimates: draft → sent → accepted/declined. Accepting one creates a job (contract = the PRE-TAX subtotal; sales tax is never profit). Item kinds: materials, labor, other (= markup/overhead, becomes the profit target).\n` +
    `- Unpaid invoices = what clients owe you (AR). Mileage default rate is $0.70/mile.\n` +
    `- Job stages: start → mid → end (end = complete). Only pending change orders don't affect the contract.\n\n` +
    `RULES:\n` +
    `- Use the read tools to look things up — never invent job names, worker names, or numbers.\n` +
    `- For anything that CHANGES data, call the matching write tool. The app shows the owner a confirm card before it saves, so don't ask "are you sure?" yourself — just call the tool.\n` +
    `- One change per message: if they ask for several changes at once, do the first and tell them to send the next after confirming.\n` +
    `- If a required detail is missing (amount, which job, which worker), ask ONE short question instead of guessing.\n` +
    `- If they ask how to do something in the app, offer to just do it for them right here.\n` +
    `- If a lookup says a name is ambiguous, ask which one they meant using the matches given.`

  const workerSystem =
    `You are the JobTally assistant for ${who}, a crew member${company}. ` +
    `You can look up THEIR OWN stuff — assigned jobs, clocked hours and pay, schedule, time-off requests — and do three things for them: clock in, clock out, and request time off. ` +
    `Today's date is ${todayKey(tz)} and yesterday was ${addDaysKey(todayKey(tz), -1)}. Work out relative dates ("tomorrow", "next Monday") from today's date yourself — never ask for a date you can compute. ` +
    `Replies are read on a phone on a jobsite: SHORT and plain, no markdown tables. Money is USD.\n\n` +
    `RULES:\n` +
    `- Use the read tools to look things up — never invent job names, hours, or pay numbers.\n` +
    `- Check clock_status before proposing clock_in or clock_out (can't clock in twice; can't clock out if not clocked in).\n` +
    `- For clock in/out or time off, call the matching write tool. The app shows them a confirm card before it saves, so don't ask "are you sure?" yourself — just call the tool.\n` +
    `- One change per message: if they ask for several at once, do the first and tell them to send the next after confirming.\n` +
    `- Their pay = their clocked hours × their hourly rate. You cannot see or discuss the business's money, other crew members' pay, or anything owner-side — if asked, say that's owner-only and they should ask their boss.\n` +
    `- If a required detail is missing (which job, which dates), ask ONE short question instead of guessing.\n` +
    `- If a lookup says a name is ambiguous, ask which one they meant using the matches given.`

  const system = isOwner ? ownerSystem : workerSystem
  const tools = isOwner ? [...READ_TOOLS, ...WRITE_TOOLS] : [...WORKER_READ_TOOLS, ...WORKER_WRITE_TOOLS]
  const writeNames = isOwner ? WRITE_NAMES : WORKER_WRITE_NAMES
  const messages = [...history, { role: 'user', content: userMessage }]
  const ctx = { token: user.token, uid: user.id, tz }

  try {
    // Up to 5 tool round-trips (read tools chain); a write short-circuits out.
    for (let i = 0; i < 5; i++) {
      const data = await callClaude(system, messages, tools)
      const blocks = Array.isArray(data.content) ? data.content : []

      if (data.stop_reason === 'tool_use') {
        const toolUses = blocks.filter((b) => b.type === 'tool_use')

        // If the model wants to WRITE, stop and ask the user to confirm.
        // One write per turn.
        const writes = toolUses.filter((b) => writeNames.has(b.name))
        const write = writes[0]
        if (write) {
          const base = summarize(write.name, write.input || {})
          // One write per turn — if the model queued more, tell the
          // owner so the extras aren't silently dropped.
          const more = writes.length > 1
            ? ' (One action at a time — after this saves, ask me for the next.)'
            : ''
          return res.json({
            type: 'confirm',
            tool: write.name,
            args: write.input || {},
            summary: base + more,
          })
        }

        // Otherwise execute the read tools and feed results back.
        messages.push({ role: 'assistant', content: blocks })
        const results = []
        for (const t of toolUses) {
          let out
          try { out = await execRead(t.name, t.input || {}, ctx) }
          catch (e) { out = { error: 'Could not complete that lookup.' } }
          results.push({ type: 'tool_result', tool_use_id: t.id, content: JSON.stringify(out) })
        }
        messages.push({ role: 'user', content: results })
        continue
      }

      // Plain text answer.
      const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('').trim()
      return res.json({ type: 'reply', reply: text || "I'm not sure how to help with that yet." })
    }
    return res.json({ type: 'reply', reply: "That took too many steps — try asking a simpler way." })
  } catch (err) {
    if (err && err.status === 429) return res.status(429).json({ error: 'The AI is busy — try again in a moment.' })
    console.error('assistant failed:', err)
    return res.status(502).json({ error: 'Assistant is unavailable right now.' })
  }
}
