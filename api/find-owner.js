export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { ownerEmail } = req.body
  if (!ownerEmail) return res.status(400).json({ error: 'Missing ownerEmail' })

  try {
    // Service role key bypasses RLS — required because the worker is not
    // logged in yet when they sign up, so they can't read profiles directly.
    const url = `${process.env.REACT_APP_SUPABASE_URL}/rest/v1/profiles` +
      `?email=eq.${encodeURIComponent(ownerEmail)}` +
      `&role=eq.owner&select=id`

    const response = await fetch(url, {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
      }
    })

    if (!response.ok) throw new Error('Lookup failed')
    const rows = await response.json()

    // Only return the owner id — never any other profile fields.
    if (!rows.length) return res.json({ ownerId: null })
    res.json({ ownerId: rows[0].id })
  } catch (err) {
    console.error('find-owner error:', err)
    res.status(500).json({ error: 'Lookup failed' })
  }
}
