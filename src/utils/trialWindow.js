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

// ── FREE FOREVER, ONE ACTIVE JOB (2026-08-11) ───────────────────────────────
//
// THE RULE: anyone can run ONE active job, free, forever. Finish it and they
// can start another. Two at once is what the subscription buys.
//
// This moved the paywall. It used to sit at the FRONT DOOR — no subscription,
// no dashboard. Now everyone gets in and the wall is at the SECOND JOB. A
// contractor won't pay $150/mo for something he's never watched work on his own
// numbers, and a real job runs 2–6 weeks, so a 30-day clock expired mid-job on
// exactly the person it was supposed to convince.
//
// ⚠️ MUST STAY IN LOCKSTEP WITH FIX-DATABASE-30 (the RLS policies on
// public.projects). The client decides what to render; the DB decides what it
// will accept. If these disagree, the user gets a button that throws.
//
// ⚠️ ROLLOUT ORDER MATTERS: run the SQL FIRST, then ship this. SQL alone is
// invisible (the old client still stops non-subscribers at the door, so nobody
// can reach the newly-allowed insert). This client alone would let people into
// the dashboard with nothing enforcing the one-job limit.
export const FREE_ACTIVE_JOBS = 1

// Can they start ANOTHER job right now?
// Mirrors the INSERT policy: has_app_access(uid) OR active_real_jobs(uid) = 0.
// `activeJobs` must exclude the seeded sample job and anything at stage 'end',
// exactly as active_real_jobs() does.
export function canStartJob({ paid, activeJobs }) {
  if (paid) return true
  return (activeJobs || 0) < FREE_ACTIVE_JOBS
}

// Is this owner living on the free tier right now (in the app, not paying)?
// Used for copy, never for enforcement.
export function isOnFreeTier({ paid, activeJobs }) {
  return !paid && (activeJobs || 0) <= FREE_ACTIVE_JOBS
}

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
