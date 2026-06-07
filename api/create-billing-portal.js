// Opens the Stripe Billing Portal for the AUTHENTICATED owner so they can update
// their card, switch monthly<->yearly, view invoices, or cancel — all self-serve,
// so JP never touches a customer's card. Requires that the owner already has a
// Stripe customer id (i.e. they've subscribed at least once).
const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY
const APP_URL = process.env.APP_URL || 'https://runsite-pearl.vercel.app'

async function getUserId(req) {
  const auth = req.headers.authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token || !SUPABASE_URL || !SERVICE_KEY) return null
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` },
    })
    if (!r.ok) return null
    const u = await r.json()
    return u && u.id ? u.id : null
  } catch { return null }
}

async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  })
  if (!r.ok) throw new Error('Supabase lookup failed: ' + r.status)
  return r.json()
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  if (!STRIPE_SECRET || !SUPABASE_URL || !SERVICE_KEY) {
    return res.status(500).json({ error: 'Billing not configured' })
  }

  const uid = await getUserId(req)
  if (!uid) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const rows = await sbGet(
      `subscriptions?owner_id=eq.${encodeURIComponent(uid)}&select=stripe_customer_id`
    )
    const customer = rows && rows[0] && rows[0].stripe_customer_id
    if (!customer) return res.status(400).json({ error: 'No subscription to manage yet' })

    const r = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + STRIPE_SECRET,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ customer, return_url: `${APP_URL}/?billing=portal-return` }),
    })
    const data = await r.json()
    if (!r.ok) throw new Error((data && data.error && data.error.message) || 'Stripe error')
    return res.json({ url: data.url })
  } catch (err) {
    console.error('create-billing-portal error:', err)
    return res.status(502).json({ error: 'Could not open billing portal' })
  }
}
