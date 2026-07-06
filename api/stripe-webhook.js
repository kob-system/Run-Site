// Stripe subscription webhook. This is the ONLY writer of the subscriptions
// table. Hardening, in order:
//   1. Raw body (bodyParser disabled) — Stripe signs the exact bytes.
//   2. HMAC-SHA256 signature check against STRIPE_WEBHOOK_SECRET, with a 5-min
//      timestamp tolerance, using a timing-safe compare. Unsigned/forged calls
//      are rejected before any DB write — a client cannot fake "I paid".
//   3. Idempotency — every event id is inserted into billing_events first; a
//      redelivered event short-circuits, so we never double-apply.
// No Stripe SDK: signature verified with node:crypto, REST via fetch.
import crypto from 'crypto'

export const config = { api: { bodyParser: false } }

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET
const PRICE_MONTHLY = process.env.STRIPE_PRICE_MONTHLY
const PRICE_YEARLY = process.env.STRIPE_PRICE_YEARLY

async function readRawBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  return Buffer.concat(chunks).toString('utf8')
}

// Verify Stripe's `stripe-signature` header against the raw payload. Returns the
// parsed event on success, or null if the signature is missing/invalid/stale.
function verify(rawBody, sigHeader) {
  if (!sigHeader || !WEBHOOK_SECRET) return null
  const parts = {}
  for (const piece of sigHeader.split(',')) {
    const i = piece.indexOf('=')
    if (i > 0) parts[piece.slice(0, i)] = piece.slice(i + 1)
  }
  const t = parts.t
  const v1 = parts.v1
  if (!t || !v1) return null

  // Reject events older than 5 minutes to blunt replay.
  const ageSec = Math.floor(Date.now() / 1000) - Number(t)
  if (!Number.isFinite(ageSec) || Math.abs(ageSec) > 300) return null

  const expected = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(`${t}.${rawBody}`, 'utf8')
    .digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(v1)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null

  try { return JSON.parse(rawBody) } catch { return null }
}

async function stripeGet(path) {
  const r = await fetch('https://api.stripe.com/v1/' + path, {
    headers: { Authorization: 'Bearer ' + STRIPE_SECRET },
  })
  if (!r.ok) throw new Error('Stripe GET failed: ' + r.status)
  return r.json()
}

function planFor(priceId) {
  if (priceId && priceId === PRICE_MONTHLY) return 'monthly'
  if (priceId && priceId === PRICE_YEARLY) return 'yearly'
  return null
}

// First-write-wins idempotency. Returns true if THIS call claimed the event
// (i.e. it hasn't been processed before). A duplicate insert collides on the
// primary key -> 409 -> we report already-processed.
async function claimEvent(id, type) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/billing_events`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ id, type }),
  })
  if (r.status === 409) return false
  if (!r.ok) throw new Error('billing_events insert failed: ' + r.status)
  return true
}

async function upsertSubscription(row) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/subscriptions?on_conflict=owner_id`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(row),
  })
  if (!r.ok) throw new Error('subscriptions upsert failed: ' + r.status + ' ' + (await r.text()))
}

// Normalize a Stripe subscription object into our row shape.
async function rowFromSubscription(sub, ownerIdHint) {
  const ownerId = (sub.metadata && sub.metadata.owner_id) || ownerIdHint
  if (!ownerId) return null
  const item = sub.items && sub.items.data && sub.items.data[0]
  const priceId = item && item.price && item.price.id
  // current_period_end lives on the subscription in older API versions, but as
  // of 2025-03+ (this webhook is pinned to 2026-06-24.dahlia) it moved onto the
  // line item. Read the item first, fall back to the legacy top-level field.
  const periodEnd = (item && item.current_period_end) || sub.current_period_end
  return {
    owner_id: ownerId,
    stripe_customer_id: typeof sub.customer === 'string' ? sub.customer : (sub.customer && sub.customer.id) || null,
    stripe_subscription_id: sub.id || null,
    status: sub.status || null,
    plan: planFor(priceId),
    current_period_end: periodEnd
      ? new Date(periodEnd * 1000).toISOString()
      : null,
    updated_at: new Date().toISOString(),
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  if (!SUPABASE_URL || !SERVICE_KEY || !STRIPE_SECRET || !WEBHOOK_SECRET) {
    console.error('stripe-webhook: missing env config')
    return res.status(500).end()
  }

  let raw
  try { raw = await readRawBody(req) } catch { return res.status(400).end() }

  const event = verify(raw, req.headers['stripe-signature'])
  if (!event) return res.status(400).json({ error: 'Invalid signature' })

  // Idempotency gate — claim the event id before doing any work.
  try {
    const fresh = await claimEvent(event.id, event.type)
    if (!fresh) return res.json({ received: true, duplicate: true })
  } catch (e) {
    console.error('stripe-webhook idempotency error:', e)
    return res.status(500).end() // let Stripe retry rather than silently drop
  }

  try {
    const obj = event.data && event.data.object
    switch (event.type) {
      case 'checkout.session.completed': {
        // The session has the owner id (client_reference_id) and the new
        // subscription id; fetch the subscription for full status/period/plan.
        const ownerId = obj.client_reference_id || (obj.metadata && obj.metadata.owner_id)
        if (obj.subscription) {
          const sub = await stripeGet('subscriptions/' + obj.subscription)
          const row = await rowFromSubscription(sub, ownerId)
          if (row) await upsertSubscription(row)
        }
        break
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const row = await rowFromSubscription(obj, null)
        if (row) {
          if (event.type === 'customer.subscription.deleted') row.status = 'canceled'
          await upsertSubscription(row)
        }
        break
      }
      case 'invoice.payment_failed': {
        // Reflect the dunning state; the subscription.updated event usually
        // covers this too, but handle it directly in case it arrives first.
        if (obj.subscription) {
          const sub = await stripeGet('subscriptions/' + obj.subscription)
          const row = await rowFromSubscription(sub, null)
          if (row) await upsertSubscription(row)
        }
        break
      }
      default:
        break // ignore everything else
    }
    return res.json({ received: true })
  } catch (err) {
    console.error('stripe-webhook handler error:', event.type, err)
    return res.status(500).end() // 500 => Stripe retries
  }
}
