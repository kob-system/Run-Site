-- ============================================================
-- FIX-DATABASE-31 — one-tap crew join
-- ============================================================
-- Additive and idempotent. Safe to run before or after the deploy; the
-- app degrades to the old email+password invite flow without it.
--
-- WHY
-- The worker invite used to hand a crew member a signup form: name, email,
-- a password he had to invent, and — with email confirmation on — an inbox
-- round trip before he could sign in for the first time. Crews don't finish
-- that, and Josh's didn't. api/join-invite.js replaces the whole thing with
-- one tap: the invite row already holds the name and the pay rate the owner
-- typed, so the server builds the account and hands the browser a session.
--
-- WHAT THAT CHANGES ABOUT THIS TABLE
-- Those accounts have no password and no reachable email, so "reset your
-- password" is not a recovery path for them. The invite LINK is the
-- credential instead — re-opening it signs the same worker back in. That is
-- the right trade for a framer with a cracked phone screen, but it means a
-- spent link is no longer harmless, so the owner needs a way to kill one.
-- That is the column below.
-- ------------------------------------------------------------

-- ---------- 1. worker_invites.revoked_at ----------
-- Set it and the link stops working in every flow: resolve-invite refuses it,
-- join-invite refuses it. Null (the default, and every existing row) means
-- "live", so nothing in the wild changes behaviour when this runs.
alter table public.worker_invites
  add column if not exists revoked_at timestamptz;

comment on column public.worker_invites.revoked_at is
  'Set when the owner kills this invite link. Because a claimed link doubles as the passwordless worker''s way back in, revoking is the only way to cut off a lost phone.';

-- The owner's Workers tab lists live invites and resolves "who has this link
-- already joined", both of which filter on these.
create index if not exists worker_invites_used_by_idx
  on public.worker_invites(used_by);
create index if not exists worker_invites_owner_created_idx
  on public.worker_invites(owner_id, created_at desc);

-- ---------- 2. Nothing else ----------
-- No RLS change is needed. The owner policy from FIX-DATABASE-11
-- ("owner_manages_invites", for all, owner_id = auth.uid()) already covers
-- writing revoked_at, and the worker still never touches this table directly —
-- resolve-invite and join-invite read it with the service-role key on behalf
-- of someone who has no session yet, which is the whole reason they exist.

-- ---------- Sanity ----------
-- select token, worker_name, used_at is not null as claimed, revoked_at
--   from public.worker_invites order by created_at desc limit 10;
