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
// Owner-first MVP: crew access is a later phase and is refused here for now.
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

// ---- Read tools (execute inline, under the user's RLS) --------------------
async function findProjects(userToken, jobName) {
  const q = jobName
    ? `projects?select=*&name=ilike.*${encodeURIComponent(String(jobName).replace(/[%*]/g, ''))}*&order=created_at.desc`
    : `projects?select=*&order=created_at.desc&limit=25`
  return userGet(userToken, q)
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

async function execRead(name, args, userToken) {
  switch (name) {
    case 'list_job_profits':
      return listJobProfits(userToken)
    case 'list_jobs': {
      const rows = await findProjects(userToken, null)
      return (rows || []).map((p) => ({
        job: p.name, contract_price: num(p.budget), stage: p.stage || null,
      }))
    }
    case 'get_job_profit': {
      const rows = await findProjects(userToken, args && args.job_name)
      if (!rows || !rows.length) return { error: 'No job found matching that name.' }
      if (rows.length > 1) {
        return {
          ambiguous: true,
          matches: rows.slice(0, 8).map((p) => p.name),
          note: 'Multiple jobs match — ask which one.',
        }
      }
      return jobProfit(userToken, rows[0])
    }
    case 'get_ar_summary': {
      const inv = await userGet(
        userToken,
        `invoices?select=label,amount,status,project_id&status=eq.unpaid`
      )
      const total = (inv || []).reduce((s, r) => s + num(r.amount), 0)
      return {
        total_owed: total,
        open_invoices: (inv || []).map((r) => ({ label: r.label || 'Invoice', amount: num(r.amount) })),
        count: (inv || []).length,
      }
    }
    default:
      return { error: 'Unknown read tool.' }
  }
}

// ---- Tool schemas exposed to the model ------------------------------------
const READ_TOOLS = [
  {
    name: 'list_job_profits',
    description:
      'Profit for ALL jobs at once, already ranked highest-profit-first. Use this for ANY question that compares or ranks jobs by money — "most/least profitable job", "rank my jobs", "which jobs are losing money / bleeding", "best job". Returns each job with contract price, total spent, and profit so far. Never rank jobs from separate single lookups — use this so the order is consistent.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_jobs',
    description: "List the owner's jobs with contract price and stage. Use to find the exact job name before other tools.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_job_profit',
    description: 'Get contract price, money spent (materials/labor/other), and profit so far for one job.',
    input_schema: {
      type: 'object',
      properties: { job_name: { type: 'string', description: 'Name (or part of the name) of the job.' } },
      required: ['job_name'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_ar_summary',
    description: 'Summarize what clients still owe: total of unpaid invoices and the open invoices.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
]

const WRITE_TOOLS = [
  {
    name: 'add_expense',
    description: 'Add a material/expense cost to a job. WRITE — the owner will confirm before it saves.',
    input_schema: {
      type: 'object',
      properties: {
        job_name: { type: 'string' },
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
    description: 'Create a new job. WRITE — the owner will confirm before it saves.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        client_name: { type: 'string' },
        contract_price: { type: 'number', description: 'What the client pays, if known.' },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
]

const WRITE_NAMES = new Set(WRITE_TOOLS.map((t) => t.name))

// Plain-English confirm text, derived server-side (not trusted from the model).
function summarize(tool, a) {
  const money = (n) => '$' + Number(num(n)).toFixed(2)
  if (tool === 'add_expense') {
    const cat = a.category && a.category !== 'materials' ? ` ${a.category}` : ''
    return `Add a ${money(a.amount)}${cat} expense${a.store ? ` from ${a.store}` : ''} to “${a.job_name}”.`
  }
  if (tool === 'create_job') {
    return `Create a new job “${a.name}”${a.client_name ? ` for ${a.client_name}` : ''}${a.contract_price ? ` — contract ${money(a.contract_price)}` : ''}.`
  }
  return 'Make a change in JobTally.'
}

async function callClaude(system, messages) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 600,
      system,
      tools: [...READ_TOOLS, ...WRITE_TOOLS],
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
  if (profile.role !== 'owner') {
    return res.json({ type: 'reply', reply: "The assistant is available for owners right now — crew access is coming soon." })
  }

  // 30 assistant turns/hour/user — plenty for real use, a hard stop on a loop.
  if (!(await allowedRate(user.id, 30, 3600))) {
    return res.status(429).json({ error: 'One moment — too many assistant requests. Try again shortly.' })
  }

  const body = req.body || {}
  const userMessage = typeof body.message === 'string' ? body.message.trim() : ''
  // Prior turns (optional), passed straight through from the client. Kept small.
  const history = Array.isArray(body.history) ? body.history.slice(-8) : []
  if (!userMessage) return res.status(400).json({ error: 'Empty message' })
  if (userMessage.length > 2000) return res.status(413).json({ error: 'Message too long' })

  const who = profile.full_name || 'the owner'
  const company = profile.company_name ? ` at ${profile.company_name}` : ''
  const system =
    `You are the JobTally assistant for ${who}${company}, a contractor business owner. ` +
    `Help them get quick answers and take actions about their jobs, expenses, and money. ` +
    `Replies are read on a phone: keep them short and plain, no markdown tables. Money is USD. ` +
    `Use the read tools to look things up — never invent job names or numbers. ` +
    `contract_price is the job's REVENUE (what the client pays), NOT profit. ` +
    `Profit so far = contract price minus everything spent (materials + labor + other). Never call the contract price "profit." ` +
    `To compare or rank jobs by money (most/least profitable, which are bleeding), call list_job_profits — it returns every job already ranked, so report that order exactly and never re-rank from memory. ` +
    `For anything that CHANGES data (add an expense, create a job), call the matching write tool: ` +
    `the app shows the owner a confirm card before it saves, so don't ask for confirmation yourself. ` +
    `If a required detail is missing (amount, which job), ask one short question instead of guessing.`

  const messages = [...history, { role: 'user', content: userMessage }]

  try {
    // Up to 4 tool round-trips (read tools chain); a write short-circuits out.
    for (let i = 0; i < 4; i++) {
      const data = await callClaude(system, messages)
      const blocks = Array.isArray(data.content) ? data.content : []

      if (data.stop_reason === 'tool_use') {
        const toolUses = blocks.filter((b) => b.type === 'tool_use')

        // If the model wants to WRITE, stop and ask the user to confirm. MVP
        // handles one write per turn.
        const writes = toolUses.filter((b) => WRITE_NAMES.has(b.name))
        const write = writes[0]
        if (write) {
          const base = summarize(write.name, write.input || {})
          // MVP does one write per turn — if the model queued more, tell the
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
          try { out = await execRead(t.name, t.input || {}, user.token) }
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
