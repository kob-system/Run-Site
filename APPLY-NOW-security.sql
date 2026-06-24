-- =====================================================================
-- APPLY-NOW-security.sql  —  Run-Site prod security hardening (consolidated)
-- By Tess (QA & security). Verified line-by-line against the repo's
-- FIX-DATABASE-*.sql files. NOTHING here was run against prod by me.
--
-- HOW TO RUN (JP — owner-only, you hold the Supabase creds):
--   1. Supabase dashboard -> SQL Editor -> New query.
--   2. Paste this ENTIRE file and click RUN. It is idempotent / safe to
--      re-run, and the blocks are ordered so dependencies are satisfied
--      top-to-bottom. If anything errors, STOP and send me the error.
--   3. Scroll to BLOCK V (the last block). It returns two result grids.
--      Copy BOTH grids' output and paste them back to me — I confirm
--      pass/fail line by line.
--
-- RUN ORDER / WHY THIS ORDER:
--   BLOCK 1 (CRITICAL) closes the live cross-tenant receipt-photo leak
--     FIRST — it makes the bucket private, drops the rogue UI-created
--     public-read + loose-upload policies, and installs the correct
--     own-folder read + tenant-scoped write policies. This is the one
--     that gates a real contractor uploading a receipt.
--   BLOCK 2-4 are the other security/integrity fixes not confirmed
--     applied on prod (worker time-entry write scoping, server-authoritative
--     payroll, owner crew-management policies, API rate limiting).
--   BLOCK V is read-back verification only (no writes).
--
-- NOTE ON FEATURE-TABLE RLS: the owner-scoped RLS on the feature tables
--   (mileage, paychecks, daily_logs, change_orders, job_photos, invoices,
--   estimates, punch_items, material_items, job_documents, compliance_items,
--   permits, warranties) lives in FIX-DATABASE-5/6/7. Those files also
--   CREATE the tables, so they are NOT inlined here to avoid column drift.
--   If BLOCK V shows any of those tables missing or RLS off, run
--   FIX-DATABASE-5, -6, -7 as-is, in that order, then re-run BLOCK V.
-- =====================================================================


-- =====================================================================
-- 🚨 BLOCK 1 — CRITICAL: CLOSE THE CROSS-TENANT RECEIPT-PHOTO LEAK
-- (from FIX-DATABASE-4 #6 + FIX-DATABASE-12)
-- This is THE fix. Everything below this block is secondary.
-- =====================================================================

-- 1a. Bucket must be PRIVATE (a public bucket exposes every receipt via CDN URL).
update storage.buckets set public = false where id = 'receipts';

-- 1b. Drop EVERY loose / legacy / rogue receipts policy (repo-created AND the two
--     someone hand-added in the Supabase UI that created the live leak).
drop policy if exists "receipts_public_read"                     on storage.objects;
drop policy if exists "Receipt photos are publicly viewable"     on storage.objects;  -- the cross-tenant READ leak
drop policy if exists "Authenticated users can upload receipts"  on storage.objects;  -- the loose WRITE hole
drop policy if exists "auth_upload_receipts"                     on storage.objects;
drop policy if exists "auth_upload_own_folder"                   on storage.objects;
drop policy if exists "receipts_authed_read"                     on storage.objects;
drop policy if exists "receipts_tenant_scoped_upload"            on storage.objects;

-- 1c. Correct READ policy: a user may read ONLY files under their own uid folder.
create policy "receipts_authed_read" on storage.objects
  for select using (
    bucket_id = 'receipts'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 1d. Correct WRITE policy: a user may write only into their own folder (owner case)
--     OR into the folder of an owner whose project they're assigned to (worker case).
create policy "receipts_tenant_scoped_upload" on storage.objects
  for insert with check (
    bucket_id = 'receipts'
    and auth.role() = 'authenticated'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1
        from public.project_workers pw
        join public.projects p on p.id = pw.project_id
        where pw.worker_id = auth.uid()
          and p.owner_id::text = (storage.foldername(name))[1]
      )
    )
  );


-- =====================================================================
-- BLOCK 2 — WORKER time_entries WRITE SCOPING  (from FIX-DATABASE-4 #4)
-- Stops a worker inserting/updating a time entry against another
-- company's project_id (cross-tenant cost tampering).
-- =====================================================================
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


-- =====================================================================
-- BLOCK 3 — SERVER-AUTHORITATIVE PAYROLL + OWNER CREW MGMT
-- (from FIX-DATABASE-8-payroll-trigger + FIX-DATABASE-8-owner-time-and-worker-mgmt)
-- Recomputes total_minutes/labor_cost server-side (so a tampered phone
-- can't inflate pay), and lets an owner add time / edit rate / unlink crew.
-- NOTE: BLOCK 3b uses public.is_owner_of_project(...) which must already
-- exist in the live DB (RLS helper from the earlier recursion patch).
-- =====================================================================

-- 3a. Server-side recompute trigger on time_entries.
create or replace function public.compute_time_entry_pay()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  rate numeric;
begin
  if new.clocked_out_at is null then
    new.total_minutes := null;
    new.labor_cost := null;
    return new;
  end if;

  if new.clocked_in_at is null or new.clocked_out_at <= new.clocked_in_at then
    new.total_minutes := 0;
    new.labor_cost := 0;
    return new;
  end if;

  select hourly_rate into rate
  from public.profiles
  where id = new.worker_id;

  new.total_minutes := floor(extract(epoch from (new.clocked_out_at - new.clocked_in_at)) / 60)::int;
  new.labor_cost    := round((new.total_minutes::numeric / 60) * coalesce(rate, 0), 2);
  return new;
end;
$$;

drop trigger if exists trg_compute_time_entry_pay on public.time_entries;
create trigger trg_compute_time_entry_pay
  before insert or update on public.time_entries
  for each row execute function public.compute_time_entry_pay();

-- 3b. Owner can INSERT time entries on their own projects (manual "Add Time").
drop policy if exists "owner can insert time entries on own projects" on public.time_entries;
create policy "owner can insert time entries on own projects"
  on public.time_entries
  for insert
  with check (public.is_owner_of_project(project_id));

-- 3c. Owner can UPDATE the profiles of workers that belong to them
--     (edit rate / soft-unlink a worker; can never reassign to another owner).
drop policy if exists "owner can update their workers" on public.profiles;
create policy "owner can update their workers"
  on public.profiles
  for update
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid() or owner_id is null);


-- =====================================================================
-- BLOCK 4 — API RATE LIMITING  (from FIX-DATABASE-13)
-- Caps per-user calls to the paid Anthropic scan + Resend notify endpoints
-- so a single logged-in user can't burn budget / spam an owner.
-- =====================================================================
create table if not exists public.rate_limits (
  user_id      uuid        not null,
  bucket       text        not null,
  window_start timestamptz not null default now(),
  count        int         not null default 0,
  primary key (user_id, bucket)
);

alter table public.rate_limits enable row level security;

create or replace function public.rate_limit_hit(
  p_user        uuid,
  p_bucket      text,
  p_max         int,
  p_window_secs int
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now   timestamptz := now();
  v_count int;
begin
  insert into public.rate_limits (user_id, bucket, window_start, count)
  values (p_user, p_bucket, v_now, 1)
  on conflict (user_id, bucket) do update
    set count = case
                  when public.rate_limits.window_start < v_now - make_interval(secs => p_window_secs)
                  then 1
                  else public.rate_limits.count + 1
                end,
        window_start = case
                  when public.rate_limits.window_start < v_now - make_interval(secs => p_window_secs)
                  then v_now
                  else public.rate_limits.window_start
                end
  returning count into v_count;

  return v_count <= p_max;
end;
$$;

revoke all on function public.rate_limit_hit(uuid, text, int, int) from public;
grant execute on function public.rate_limit_hit(uuid, text, int, int) to service_role;


-- =====================================================================
-- ✅ BLOCK V — READ-BACK VERIFICATION (read-only; copy BOTH grids back to Tess)
-- =====================================================================

-- V1. Receipts bucket MUST be private.
--     PASS = one row, public = false.   FAIL = public = true (re-run BLOCK 1).
select id, public as bucket_is_public
from storage.buckets
where id = 'receipts';

-- V2. Storage policies on the receipts bucket.
--     PASS = exactly TWO rows:
--        receipts_authed_read           | SELECT
--        receipts_tenant_scoped_upload  | INSERT
--     FAIL = ANY row named "Receipt photos are publicly viewable"
--            or "Authenticated users can upload receipts" still present,
--            or a SELECT policy with roles = {public}.
select policyname, cmd, roles
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
order by policyname;

-- V3. (Bonus) Confirm RLS helper functions + payroll trigger exist and
--     RLS is on for the money tables. PASS = 2 helper rows, trigger present,
--     all relrowsecurity = true.
select proname from pg_proc
where proname in ('is_owner_of_project','is_worker_on_project')
order by proname;

select tgname from pg_trigger where tgname = 'trg_compute_time_entry_pay';

select relname, relrowsecurity
from pg_class
where relname in ('receipts','time_entries','projects','profiles','project_workers','job_photos')
order by relname;

-- =====================================================================
-- END. Send BLOCK V output back to Tess for sign-off.
-- =====================================================================
