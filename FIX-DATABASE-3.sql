-- ============================================================
-- RUN-SITE — DATABASE FIX MIGRATION #3
-- Run this ONCE in Supabase → SQL Editor, AFTER FIX-DATABASE.sql,
-- the RLS recursion patch, and FIX-DATABASE-2.sql.
-- Safe to re-run (idempotent).
--
-- WHY: The owner dashboard now lets an owner correct mistakes —
-- delete a bad receipt, delete or fix a wrong time entry, and
-- reopen/edit a completed job. Under the locked-down RLS rules the
-- owner could only SELECT time_entries on their projects, not
-- UPDATE or DELETE them. This adds owner UPDATE + DELETE policies
-- for time_entries scoped to projects the owner actually owns.
--
-- (Receipts and projects already allow owner update/delete from the
-- earlier migrations, so only time_entries needs patching here.)
-- ============================================================

-- Owner can DELETE time entries on their own projects.
drop policy if exists "owner can delete time entries on own projects" on public.time_entries;
create policy "owner can delete time entries on own projects"
  on public.time_entries
  for delete
  using (public.is_owner_of_project(project_id));

-- Owner can UPDATE time entries on their own projects (for corrections).
drop policy if exists "owner can update time entries on own projects" on public.time_entries;
create policy "owner can update time entries on own projects"
  on public.time_entries
  for update
  using (public.is_owner_of_project(project_id))
  with check (public.is_owner_of_project(project_id));

-- ============================================================
-- DONE. The owner can now delete/fix time entries on their jobs,
-- and labor totals recompute live from the remaining entries.
-- ============================================================
