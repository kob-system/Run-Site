// Mark a worker-invite token used once the invited worker has signed
// up. Best-effort: called right after signUp succeeds. Runs with the
// service-role key because the brand-new worker may not have a session
// yet (email-confirmation case). Idempotent — only flips an unused row.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { token, workerId } = req.body || {}
  if (!token) return res.status(400).json({ error: 'Missing token' })

  try {
    const base = process.env.REACT_APP_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY

    const url = `${base}/rest/v1/worker_invites` +
      `?token=eq.${encodeURIComponent(token)}` +
      `&used_at=is.null`

    const resp = await fetch(url, {
      method: 'PATCH',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({
        used_at: new Date().toISOString(),
        used_by: workerId || null
      })
    })

    if (!resp.ok) throw new Error('Claim failed')
    res.json({ ok: true })
  } catch (err) {
    console.error('claim-invite error:', err)
    // Non-fatal for the worker — they're already signed up + linked.
    res.status(500).json({ error: 'Claim failed' })
  }
}
