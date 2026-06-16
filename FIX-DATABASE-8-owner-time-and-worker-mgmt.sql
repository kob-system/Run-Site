-- ============================================================
-- RUN-SITE — DATABASE FIX MIGRATION #8
-- Run this ONCE in Supabase → SQL Editor, AFTER FIX-DATABASE-7.
-- Safe to re-run (idempotent).
--
-- WHY: Two owner-side features were added to the dashboard:
--   1) "+ Add Time" on a job — the owner manually logs a worker's
--      hours (start/end time → labor cost) for crew who don't clock
--      in via the worker app.
--   2) "Remove" a worker from the crew, and "Edit Rate" on a worker.
--
-- Under the locked-down RLS, neither was actually permitted:
--   • time_entries: owners had SELECT/UPDATE/DELETE (migration #3) but
--     NO INSERT — only workers could insert (worker_id = auth.uid()).
--   • profiles: only "update_own_profile" (auth.uid() = id) existed, so
--     an owner could not change a WORKER's row at all. (This silently
--     no-op'd the existing "Edit Rate" button — owners couldn't change
--     a worker's hourly_rate. This migration fixes that too.)
-- ============================================================

-- 1) Owner can INSERT time entries on their own projects (manual "Add Time").
--    Scoped via the same helper used by the owner update/delete policies.
drop policy if exists "owner can insert time entries on own projects" on public.time_entries;
create policy "owner can insert time entries on own projects"
  on public.time_entries
  for insert
  with check (public.is_owner_of_project(project_id));

-- 2) Owner can UPDATE the profiles of workers that belong to them.
--    USING restricts the rows an owner may touch to their own crew
--    (owner_id = auth.uid()). WITH CHECK permits the resulting row to
--    either stay theirs (rate edits) OR become detached (owner_id null)
--    — which is how "Remove worker" unlinks a worker without deleting
--    the account or cascade-wiping their logged hours. An owner can
--    never reassign a worker to a different owner.
drop policy if exists "owner can update their workers" on public.profiles;
create policy "owner can update their workers"
  on public.profiles
  for update
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid() or owner_id is null);

-- ============================================================
-- DONE. Owners can now: manually add a worker's time on a job,
-- edit a worker's hourly rate, and remove a worker from their crew
-- (soft-unlink — past hours on jobs are preserved).
-- ============================================================
