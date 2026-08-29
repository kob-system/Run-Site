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
import { alertOwner } from './_alert'
import { send, shell, money, stamp as fmtDate, esc, APP_URL } from './_email'

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
  // Stripe sends one `t` and ONE OR MORE `v1` signatures (one per active signing
  // secret). During a secret rotation both the old and new secret produce a v1;
  // collect them all and accept if ANY matches, so rotation doesn't 400 events.
  let t = null
  const v1s = []
  for (const piece of sigHeader.split(',')) {
    const i = piece.indexOf('=')
    if (i <= 0) continue
    const key = piece.slice(0, i)
    const val = piece.slice(i + 1)
    if (key === 't') t = val
    else if (key === 'v1') v1s.push(val)
  }
  if (!t || v1s.length === 0) return null

  // Reject events older than 5 minutes to blunt replay.
  const ageSec = Math.floor(Date.now() / 1000) - Number(t)
  if (!Number.isFinite(ageSec) || Math.abs(ageSec) > 300) return null

  const expected = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(`${t}.${rawBody}`, 'utf8')
    .digest('hex')
  const a = Buffer.from(expected)
  const matched = v1s.some((v1) => {
    const b = Buffer.from(v1)
    return a.length === b.length && crypto.timingSafeEqual(a, b)
  })
  if (!matched) return null

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

// Has this event id already been fully processed + recorded? Used as a
// best-effort fast-path to skip redundant re-processing of redelivered events.
async function alreadyProcessed(id) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/billing_events?id=eq.${encodeURIComponent(id)}&select=id`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
  )
  if (!r.ok) throw new Error('billing_events read failed: ' + r.status)
  const rows = await r.json()
  return Array.isArray(rows) && rows.length > 0
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

// The guard field (last_event_at) for an owner's current subscription row.
// Best-effort: on any read error we return null and let the write proceed.
async function existingSub(ownerId) {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/subscriptions?owner_id=eq.${encodeURIComponent(ownerId)}&select=last_event_at`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    )
    if (!r.ok) return null
    const rows = await r.json()
    return (Array.isArray(rows) && rows[0]) || null
  } catch { return null }
}

// Apply a normalized row, but DROP it if a newer event already updated this
// owner's subscription. Stripe does not guarantee delivery order, so a late
// `customer.subscription.deleted` for an old plan can arrive AFTER the owner
// has already resubscribed — without this guard it would clobber the fresh
// active row back to "canceled". We stamp each write with the source event's
// timestamp and refuse to apply an older event on top of a newer one.
async function applyRow(row, eventCreatedSec) {
  if (!row) return
  const stamp = Number.isFinite(eventCreatedSec)
    ? new Date(eventCreatedSec * 1000).toISOString()
    : null
  if (stamp) {
    const prev = await existingSub(row.owner_id)
    if (prev && prev.last_event_at && new Date(prev.last_event_at) > new Date(stamp)) {
      return // a newer event already applied; this one is stale
    }
    row.last_event_at = stamp
  }
  await upsertSubscription(row)
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

// ── Customer billing email ──────────────────────────────────────────────────
//
// Two letters, both driven off the Stripe INVOICE, which is the only object
// that knows what was actually charged:
//
//   invoice.payment_succeeded  -> the receipt. Fires on the first charge and
//                                 again on every renewal, so this one email is
//                                 both "you're subscribed" and "here's your
//                                 monthly receipt" — told apart by
//                                 billing_reason, so nobody gets two emails on
//                                 the same day for the same dollar.
//   invoice.payment_failed     -> the card didn't go through, here's the link
//                                 to fix it, and here is what does NOT happen.
//
// Stripe's own automatic receipts (Dashboard -> Settings -> Emails) are a
// separate, unbranded email. Turn ONE of the two on, not both.
//
// Never throws: send() swallows, and every caller is inside the handler's try.

// Who to email. The invoice usually carries it; the profiles row is the
// fallback, and the only source when Stripe has no email on the customer.
async function billingRecipient(invoice, ownerId) {
  const onInvoice = invoice && (invoice.customer_email || (invoice.customer_details && invoice.customer_details.email))
  if (onInvoice) return onInvoice
  if (!ownerId) return null
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(ownerId)}&select=email`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    )
    if (!r.ok) return null
    const rows = await r.json()
    return (rows && rows[0] && rows[0].email) || null
  } catch { return null }
}

// The subscription id, wherever this pinned API version keeps it.
function subIdOf(invoice) {
  return (
    invoice.subscription ||
    (invoice.parent &&
      invoice.parent.subscription_details &&
      invoice.parent.subscription_details.subscription) ||
    null
  )
}

function planLabel(invoice) {
  const line = invoice && invoice.lines && invoice.lines.data && invoice.lines.data[0]
  const priceId = line && ((line.price && line.price.id) || (line.pricing && line.pricing.price_details && line.pricing.price_details.price))
  const plan = planFor(priceId)
  if (plan === 'yearly') return 'JobTally, yearly'
  if (plan === 'monthly') return 'JobTally, monthly'
  return 'JobTally'
}

async function emailReceipt(invoice, ownerId) {
  const to = await billingRecipient(invoice, ownerId)
  if (!to) return
  const paid = invoice.amount_paid != null ? invoice.amount_paid : invoice.amount_due
  const first = invoice.billing_reason === 'subscription_create'
  const nextAt = invoice.lines && invoice.lines.data && invoice.lines.data[0] && invoice.lines.data[0].period && invoice.lines.data[0].period.end
  const link = invoice.hosted_invoice_url || invoice.invoice_pdf

  await send({
    to,
    subject: first
      ? 'You’re subscribed to JobTally'
      : `JobTally receipt — ${money(paid, invoice.currency)}`,
    html: shell({
      heading: first ? 'You’re subscribed. Run as many jobs as you want.' : 'Payment received. Thank you.',
      lead: first
        ? 'The one-job limit is off. Nothing else about your account changed, and everything already in it stayed exactly where it was.'
        : 'Nothing needed from you. This is your receipt for this period.',
      hero: money(paid, invoice.currency),
      heroLabel: first ? 'charged today' : 'charged',
      rows: [
        ['Plan', planLabel(invoice)],
        ['Paid on', fmtDate(invoice.status_transitions && invoice.status_transitions.paid_at) || fmtDate(invoice.created)],
        nextAt ? ['Next charge', fmtDate(nextAt)] : null,
        invoice.number ? ['Receipt no.', invoice.number] : null,
      ],
      cta: link ? 'View or print this receipt' : 'Open JobTally',
      ctaHref: link || APP_URL,
      foot:
        'Cancel any time from <strong>Manage billing</strong> inside the app. If you cancel you drop back to the free plan, one job at a time, and nothing is deleted. ' +
        'Reply to this email if a number here looks wrong.',
    }),
  })
}

async function emailPaymentFailed(invoice, ownerId) {
  const to = await billingRecipient(invoice, ownerId)
  if (!to) return
  const due = invoice.amount_due
  const link = invoice.hosted_invoice_url

  await send({
    to,
    subject: 'Your JobTally payment didn’t go through',
    html: shell({
      heading: 'Your card didn’t go through.',
      lead:
        'Usually an expired card or a bank block, and it takes about a minute to fix. <strong>Nothing has shut off.</strong> Your jobs, hours, receipts and invoices are all still there and your crew can still clock in.',
      hero: money(due, invoice.currency),
      heroLabel: 'still owed on this period',
      rows: [['Plan', planLabel(invoice)], ['Tried on', fmtDate(invoice.created)]],
      cta: link ? 'Update your card' : 'Open JobTally',
      ctaHref: link || APP_URL,
      foot:
        'Stripe retries this a few times over the next couple of weeks. If it never clears, the account drops to the free plan, one job at a time. It is not deleted and it is not locked. ' +
        'Reply here if you want a hand with it.',
    }),
  })
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

  // Idempotency is recorded AFTER the work succeeds, not before. Every write
  // below is an idempotent upsert keyed by owner_id, so re-processing a
  // redelivered event is harmless — whereas claiming the id up front means a
  // transient failure mid-process (Supabase/Stripe blip) returns 500, Stripe
  // retries, the retry sees the already-claimed id, short-circuits as a
  // "duplicate", and the subscription row is NEVER written: a paying customer
  // charged with no access. So: do the work, then record the event id.
  try {
    // Fast-path: if this exact event id was already fully processed, skip the
    // redundant Stripe fetch + upsert. Best-effort read; on error we just
    // process again (safe, idempotent).
    if (await alreadyProcessed(event.id)) {
      return res.json({ received: true, duplicate: true })
    }
  } catch { /* fall through and process — upserts are idempotent */ }

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
          await applyRow(row, event.created)
        }
        break
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const row = await rowFromSubscription(obj, null)
        if (row) {
          if (event.type === 'customer.subscription.deleted') row.status = 'canceled'
          await applyRow(row, event.created)
        }
        break
      }
      case 'invoice.payment_succeeded': {
        // The receipt. Also the ONLY "welcome to the paid plan" email: the
        // first invoice arrives in the same second as checkout.session.completed,
        // so a separate subscribe confirmation there would put two emails about
        // one payment in one inbox at once. billing_reason tells the two apart
        // inside the one letter.
        //
        // No DB write of its own, on purpose. This event carries no subscription
        // state we don't already get from customer.subscription.updated; it is
        // here purely to email a human.
        const paidSubId = subIdOf(obj)
        let paidOwnerId = null
        if (paidSubId) {
          try {
            const paidSub = await stripeGet('subscriptions/' + paidSubId)
            paidOwnerId = (paidSub.metadata && paidSub.metadata.owner_id) || null
          } catch { /* the invoice's own email address is enough to send on */ }
        }
        await emailReceipt(obj, paidOwnerId)
        break
      }
      case 'invoice.payment_failed': {
        // Reflect the dunning state; the subscription.updated event usually
        // covers this too, but handle it directly in case it arrives first.
        // On the pinned 2026-06-24.dahlia API the top-level invoice.subscription
        // field is gone — the ref lives at parent.subscription_details.subscription.
        // Read the new location first, fall back to legacy top-level.
        const subId =
          obj.subscription ||
          (obj.parent &&
            obj.parent.subscription_details &&
            obj.parent.subscription_details.subscription)
        let failedOwnerId = null
        if (subId) {
          const sub = await stripeGet('subscriptions/' + subId)
          const row = await rowFromSubscription(sub, null)
          failedOwnerId = row && row.owner_id
          await applyRow(row, event.created)
        }
        // Emailed AFTER the status write, so nobody is told their card failed by
        // an event that then blew up before recording anything.
        await emailPaymentFailed(obj, failedOwnerId)
        break
      }
      default:
        break // ignore everything else
    }
    // Record the event id ONLY now that the work committed. If claimEvent
    // itself fails, we still return 200: the write already succeeded, and a
    // Stripe retry would harmlessly re-run the same idempotent upsert.
    try { await claimEvent(event.id, event.type) } catch (e) {
      console.error('stripe-webhook: post-process claim failed (non-fatal):', e)
    }
    return res.json({ received: true })
  } catch (err) {
    console.error('stripe-webhook handler error:', event.type, err)
    // This is the highest-stakes failure in the app: Stripe took the money and
    // the subscription row did NOT get written, so a customer who just paid has
    // no access. Stripe will retry, and the upserts are idempotent, so this
    // usually self-heals — but JP has to know it happened, because the version
    // that does NOT self-heal looks identical from the outside.
    // Awaited, unlike every other alert: the function is about to return and a
    // Vercel lambda can be frozen the instant it does, killing an unawaited
    // send. _alert.js cannot throw, so this can't mask the 500.
    await alertOwner('stripe-webhook', `Subscription write FAILED for ${event.type}`, {
      event: event.type,
      event_id: event.id,
      error: (err && err.message) || String(err),
      impact: 'A customer may have paid and NOT have access. Stripe will retry; check Vercel logs and the subscriptions table.',
    })
    return res.status(500).end() // 500 => Stripe retries (work was NOT recorded)
  }
}
