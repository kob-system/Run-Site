-- ============================================================
-- RUN-SITE — DATABASE FIX MIGRATION #4 (audit hardening)
-- Run ONCE in Supabase → SQL Editor, AFTER FIX-DATABASE.sql, -2, -3.
-- Safe to re-run (idempotent). Fixes audit findings #3, #4, #5, #6.
-- Pairs with the app changes on branch claude/night-hardening-0530.
-- ============================================================


-- ------------------------------------------------------------
-- #5 — RLS HELPER FUNCTIONS (commit the previously-uncommitted
-- "RLS recursion patch" so the DB is reproducible from source).
-- SECURITY DEFINER + pinned search_path lets a policy check
-- ownership/assignment WITHOUT recursing through other tables'
-- policies. These match what the app's existing -2/-3 migrations
-- already rely on; create-or-replace is a no-op if identical.
-- ------------------------------------------------------------
create or replace function public.is_owner_of_project(p_project_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.projects
    where id = p_project_id and owner_id = auth.uid()
  );
$$;

create or replace function public.is_worker_on_project(p_project_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.project_workers
    where project_id = p_project_id and worker_id = auth.uid()
  );
$$;

grant execute on function public.is_owner_of_project(uuid) to authenticated;
grant execute on function public.is_worker_on_project(uuid) to authenticated;


-- ------------------------------------------------------------
-- #4 — BIND WORKER time_entries WRITES TO ASSIGNMENT.
-- The old "worker_manages_own_time_entries" used `for all using
-- (worker_id = auth.uid())`, which let any worker INSERT a time
-- entry against ANOTHER company's project_id (cross-tenant cost
-- tampering). Replace it with per-command policies that also
-- require the worker to be assigned to the project on writes.
-- ------------------------------------------------------------
drop policy if exists "worker_manages_own_time_entries" on public.time_entries;

drop policy if exists "worker_select_own_time_entries" on public.time_entries;
create policy "worker_select_own_time_entries" on public.time_entries
  for select using (worker_id = auth.uid());

drop policy if exists "worker_insert_own_time_entries" on public.time_entries;
create policy "worker_insert_own_time_entries" on public.time_entries
  for insert with check (
    worker_id = auth.uid()
    and project_id in (
      select project_id from public.project_workers where worker_id = auth.uid()
    )
  );

drop policy if exists "worker_update_own_time_entries" on public.time_entries;
create policy "worker_update_own_time_entries" on public.time_entries
  for update using (worker_id = auth.uid())
  with check (
    worker_id = auth.uid()
    and project_id in (
      select project_id from public.project_workers where worker_id = auth.uid()
    )
  );

drop policy if exists "worker_delete_own_time_entries" on public.time_entries;
create policy "worker_delete_own_time_entries" on public.time_entries
  for delete using (worker_id = auth.uid());


-- ------------------------------------------------------------
-- #3 — IDEMPOTENT TIME-ENTRY SYNC.
-- The app stamps each entry with a client-generated UUID and syncs via
-- upsert(on_conflict = client_id), so a retried/replayed/duplicated sync
-- UPDATES the same row instead of inserting a second (double-paid) shift.
-- The unique index MUST be non-partial: Postgres ON CONFLICT (used by
-- upsert) cannot target a PARTIAL index. NULLs are distinct in a unique
-- index, so any legacy rows without a client_id coexist fine.
-- ------------------------------------------------------------
alter table public.time_entries
  add column if not exists client_id uuid;

-- Drop first so a re-run replaces any earlier (e.g. partial) index of this name,
-- then create the non-partial unique index. (Assumes no duplicate non-null
-- client_ids exist — always true for a fresh DB and for app-written rows.)
drop index if exists public.uq_time_entries_client_id;
create unique index if not exists uq_time_entries_client_id
  on public.time_entries(client_id);


-- ------------------------------------------------------------
-- #6 — PRIVATE RECEIPT PHOTOS.
-- The receipts bucket was PUBLIC with a read-to-everyone policy,
-- exposing every contractor's receipt images to the open internet.
-- Make it private and restrict reads to the authenticated uploader
-- (path is `<uploader-uid>/<file>`). The app now views images via
-- short-lived signed URLs, so this does not break receipt viewing.
-- ------------------------------------------------------------
update storage.buckets set public = false where id = 'receipts';

drop policy if exists "receipts_public_read" on storage.objects;
drop policy if exists "receipts_authed_read" on storage.objects;
create policy "receipts_authed_read" on storage.objects
  for select using (
    bucket_id = 'receipts'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================
-- DONE. After running:
--  • a worker can no longer write time to a job they're not on,
--  • duplicate offline syncs can't create a second shift,
--  • receipt photos are private (viewed via signed URLs),
--  • the RLS helper functions are now versioned in source.
-- Re-run all migrations on a scratch project to confirm a clean
-- provision before relying on this in production.
-- ============================================================
