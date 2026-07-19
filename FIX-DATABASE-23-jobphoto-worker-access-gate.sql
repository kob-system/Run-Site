-- ============================================================
-- FIX-DATABASE-23 — let assigned crew insert job photos past the
--                   subscription "app access" gate
-- ============================================================
-- BUG (prod): even after the storage-RLS fix (FIX-22) and the worker
-- row policy (FIX-10), a crew member's INSERT into public.job_photos is
-- rejected by the RESTRICTIVE policy `job_photos_require_access_insert`,
-- whose CHECK is `has_app_access(auth.uid())`.
--
-- `has_app_access(uid)` returns true only when THAT uid is an OWNER with
-- a comp/active/trialing subscription (or a <7-day-old profile). A worker
-- is not an owner and has no subscription, so the gate returns false and
-- the insert 403s ("new row violates row-level security policy"). The
-- gate was written to stop LAPSED OWNERS from writing data; it never
-- accounted for assigned crew acting on a paid owner's job.
--
-- FIX: the gate passes when EITHER the acting user has app access OR the
-- row's owner_id has app access. On a worker insert, `owner_id` is forced
-- to equal the project's real owner by the permissive policy
-- `worker_insert_job_photos` (FIX-10), so a worker can only write under an
-- owner they're actually assigned to — and only while that owner's account
-- is in good standing. Owner inserts are unchanged (auth.uid() == owner_id
-- both resolve to the owner, so has_app_access(auth.uid()) still gates).
-- A lapsed owner is still blocked (neither branch passes).
--
-- Scope: ONLY job_photos — the sole worker-writable table behind this
-- gate. Do NOT touch invoices/estimates/change_orders/etc. (owner-only).
--
-- Safe / idempotent. Apply in Supabase SQL editor or via the mgmt API.
-- No app code change needed.
-- ------------------------------------------------------------

drop policy if exists "job_photos_require_access_insert" on public.job_photos;
create policy "job_photos_require_access_insert" on public.job_photos
  as restrictive
  for insert
  with check (
    has_app_access(auth.uid())
    or has_app_access(owner_id)
  );

-- VERIFY:
--   select policyname, permissive, cmd, with_check from pg_policies
--   where schemaname='public' and tablename='job_photos'
--     and policyname='job_photos_require_access_insert';
-- ============================================================
