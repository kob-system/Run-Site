// Creates a Stripe Checkout Session (subscription mode) for the AUTHENTICATED
// owner. The client only sends the plan name ('monthly' | 'yearly'); the actual
// price ids live in server env vars so they can't be tampered with. The owner's
// Supabase id rides along as client_reference_id AND on the subscription
// metadata, so the webhook can map the Stripe customer back to the account.
//
// No Stripe SDK — we call the REST API with fetch + form-encoding, matching the
// rest of api/ (notify-owner, scan-receipt) and keeping the bundle dependency-free.
const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY
const PRICES = {
  monthly: process.env.STRIPE_PRICE_MONTHLY,
  yearly: process.env.STRIPE_PRICE_YEARLY,
}
const APP_URL = process.env.APP_URL || 'https://www.getjobtally.com'

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

async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  })
  if (!r.ok) throw new Error('Supabase lookup failed: ' + r.status)
  return r.json()
}

async function stripe(path, params) {
  const r = await fetch('https://api.stripe.com/v1/' + path, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + STRIPE_SECRET,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params),
  })
  const data = await r.json()
  if (!r.ok) throw new Error((data && data.error && data.error.message) || 'Stripe error ' + r.status)
  return data
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  if (!STRIPE_SECRET || !SUPABASE_URL || !SERVICE_KEY) {
    return res.status(500).json({ error: 'Billing not configured' })
  }

  const user = await getUser(req)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  const plan = req.body && req.body.plan
  const priceId = PRICES[plan]
  if (!priceId) return res.status(400).json({ error: 'Unknown plan' })

  // Optional referral tag (e.g. a partner's link ?ref=josh). Only slugs on the
  // known-partner allowlist are honored, so a random or spoofed ?ref= can't
  // manufacture a commission-eligible attribution. Add partners here as they
  // sign on. Stamped onto the subscription + session metadata for payout.
  // 'josh' pays a commission. 'fb' is a channel tag, not a partner — it tells us
  // which Facebook group work actually converted, so the 20-min/day is measurable.
  const VALID_REFERRERS = ['josh', 'fb']
  const rawRef = req.body && req.body.ref
  const cleanRef =
    typeof rawRef === 'string'
      ? rawRef.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32)
      : ''
  const ref = VALID_REFERRERS.includes(cleanRef) ? cleanRef : ''

  try {
    // Look up this owner's existing subscription row (if any). It decides three
    // things: reuse the Stripe customer on a re-subscribe (no duplicate
    // customer); block a duplicate checkout when a plan is already live; and
    // and block a duplicate checkout when a plan is already live.
    let existingCustomer = null
    let rows
    try {
      rows = await sbGet(
        `subscriptions?owner_id=eq.${encodeURIComponent(user.id)}&select=stripe_customer_id,stripe_subscription_id,status`
      )
    } catch (readErr) {
      // A read FAILURE is not the same as "no prior subscription." Swallowing it
      // and falling through would let a genuine infra/RLS error mint a duplicate
      // Stripe customer AND grant a fresh 30-day trial to a returning subscriber
      // (trial farming). The subscriptions table exists in prod, so this path is
      // a real error — fail closed and ask the owner to retry.
      console.error('create-checkout-session: subscription read failed:', readErr)
      return res.status(503).json({ error: 'Could not verify your billing status. Please try again.' })
    }
    const row = rows && rows[0]
    if (row) {
      if (row.stripe_customer_id) existingCustomer = row.stripe_customer_id
      // 'comp' is a grandfathered/free grant — block checkout too, so a comp'd
      // owner can't start a paid subscription that the webhook would upsert on
      // top of (and silently overwrite) their comp status.
      if (['active', 'trialing', 'past_due', 'comp'].includes(row.status)) {
        return res.status(409).json({
          error: 'You already have an active subscription — use Manage billing to change your plan.',
        })
      }
    }

    const params = {
      mode: 'subscription',
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': '1',
      client_reference_id: user.id,
      'subscription_data[metadata][owner_id]': user.id,
      'metadata[owner_id]': user.id,
      allow_promotion_codes: 'true',
      success_url: `${APP_URL}/?billing=success`,
      cancel_url: `${APP_URL}/?billing=cancel`,
    }
    // NO TRIAL. Removed 2026-08-20 on JP's call: the free tier IS the trial now.
    //
    // The old shape was a 30-day card trial — enter a card at signup, get billed
    // on day 31. That is gone because "one active job, free, forever" replaces it
    // and is a better offer in every direction: no card at the door, no clock
    // that can expire mid-job, and the contractor gets to watch the app work on
    // his OWN numbers before he ever pays. Trying it IS the sale.
    //
    // So by the time anyone reaches this checkout they have already had the
    // product for free, for as long as they wanted, and are here because they
    // want to run a SECOND job at the same time. Handing them another 30 free
    // days at that point delays real revenue by a month and muddies the pitch
    // ("free forever" and "30 days free" cannot both be the headline).
    //
    // Stacking both was considered and rejected — it meant a customer could be
    // 60+ days in before a single dollar moved.
    //
    // The prior-subscription flag this used to need is gone with it. Reusing the
    // stored stripe_customer_id (above) is what still prevents duplicate Stripe
    // customers on a re-subscribe; that is unrelated to trials.
    //
    // ⚠️ If you ever re-add a trial here, the landing page, /pricing, /faq and
    // their JSON-LD FAQ schema all have to change back with it. They currently
    // promise "no card, one job free forever" and nothing about a trial.
    if (ref) {
      // On the subscription so it persists for the life of the plan (used for
      // recurring commission), and on the session for immediate visibility.
      params['subscription_data[metadata][referrer]'] = ref
      params['metadata[referrer]'] = ref
    }
    if (existingCustomer) params.customer = existingCustomer
    else if (user.email) params.customer_email = user.email

    const session = await stripe('checkout/sessions', params)
    return res.json({ url: session.url })
  } catch (err) {
    console.error('create-checkout-session error:', err)
    return res.status(502).json({ error: 'Could not start checkout' })
  }
}
