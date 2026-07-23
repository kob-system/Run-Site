// Single source of truth for the trial model on the client.
//
// THE MODEL (as of 2026-07-24): 30-day free trial, CARD REQUIRED at signup.
// A new owner goes to Stripe Checkout, enters a card, and Stripe returns the
// subscription as status='trialing' with current_period_end 30 days out. No
// charge lands until the trial ends; they can cancel any time before that from
// Manage billing and pay nothing.
//
// LEGACY: before the cutover, new accounts got a 30-day no-card window computed
// off profiles.created_at — no Stripe row at all. Those accounts are
// grandfathered: they keep the window until it runs out naturally. This whole
// legacy path is self-expiring — legacyFreeDaysLeft() can never return a
// number after CARD_REQUIRED_SINCE + 30 days (2026-08-23), at which point the
// constants below and their callers can be deleted.
//
// These MUST stay in lockstep with public.has_app_access (FIX-DATABASE-24):
// the client decides what to render, the DB decides what it will accept.

export const LEGACY_FREE_WINDOW_DAYS = 30

// Accounts created before this instant are grandfathered onto the no-card
// window. MUST match c_cutover in public.has_app_access.
export const CARD_REQUIRED_SINCE = Date.parse('2026-07-24T00:00:00Z')

// Days remaining in a grandfathered no-card window, or null if the account
// isn't grandfathered (or its window is gone). Never returns 0 — a spent
// window is null, so callers can't render "0 days left" at someone who is
// already paywalled.
export function legacyFreeDaysLeft(profile) {
  if (!profile || !profile.created_at) return null
  const created = Date.parse(profile.created_at)
  if (!created || created >= CARD_REQUIRED_SINCE) return null
  const msLeft = created + LEGACY_FREE_WINDOW_DAYS * 86400000 - Date.now()
  return msLeft > 0 ? Math.max(1, Math.ceil(msLeft / 86400000)) : null
}
