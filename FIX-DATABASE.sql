-- ============================================================
-- RUN-SITE — DATABASE FIX MIGRATION
-- Run this ONCE in Supabase → SQL Editor → New query → paste all → Run.
-- Safe to re-run (idempotent). Fixes: security (RLS), missing
-- schedule_entries table, missing receipts.category column,
-- storage bucket for receipt photos, and performance indexes.
-- Does NOT add money-math triggers (React handles that today;
-- adding triggers without removing React math would double-count).
-- ============================================================

-- ------------------------------------------------------------
-- 1. MISSING COLUMN: receipts.category
-- Code writes category ('materials' | 'other') on every receipt.
-- ------------------------------------------------------------
alter table public.receipts
  add column if not exists category text not null default 'materials';

-- ------------------------------------------------------------
-- 2. MISSING TABLE: schedule_entries
-- Foreign keys are REQUIRED so the app's profiles(full_name) and
-- projects(name) joins resolve in PostgREST.
-- ------------------------------------------------------------
create table if not exists public.schedule_entries (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid references public.profiles(id) on delete cascade,
  worker_id        uuid references public.profiles(id) on delete cascade,
  project_id       uuid references public.projects(id) on delete cascade,
  task_description text,
  scheduled_date   date,
  start_time       time,
  end_time         time,
  notes            text,
  created_at       timestamptz default now()
);

-- ------------------------------------------------------------
-- 3. STORAGE BUCKET for receipt photos
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', true)
on conflict (id) do nothing;

-- ------------------------------------------------------------
-- 4. ENABLE RLS on every table (no-op if already enabled)
-- ------------------------------------------------------------
alter table public.profiles         enable row level security;
alter table public.projects         enable row level security;
alter table public.project_workers  enable row level security;
alter table public.receipts         enable row level security;
alter table public.time_entries     enable row level security;
alter table public.schedule_entries enable row level security;

-- ------------------------------------------------------------
-- 5. DROP ALL EXISTING (insecure using(true)) POLICIES
-- Iterates every policy on these tables so we start clean.
-- ------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('profiles','projects','project_workers',
                        'receipts','time_entries','schedule_entries')
  loop
    execute format('drop policy if exists %I on %I.%I',
                   r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- ------------------------------------------------------------
-- 6. CORRECT POLICIES — each owner sees only their own data,
-- workers see only what they're assigned.
-- ------------------------------------------------------------

-- PROFILES
create policy "owner_sees_own_profile"   on public.profiles for select using (auth.uid() = id);
create policy "owner_sees_their_workers" on public.profiles for select using (owner_id = auth.uid());
create policy "insert_own_profile"       on public.profiles for insert with check (auth.uid() = id);
create policy "update_own_profile"       on public.profiles for update using (auth.uid() = id);

-- PROJECTS
create policy "owner_manages_projects" on public.projects for all using (owner_id = auth.uid());
create policy "worker_sees_assigned_projects" on public.projects for select using (
  id in (select project_id from public.project_workers where worker_id = auth.uid())
);

-- PROJECT_WORKERS
create policy "owner_manages_project_workers" on public.project_workers for all using (
  project_id in (select id from public.projects where owner_id = auth.uid())
);
create policy "worker_sees_own_assignments" on public.project_workers for select using (worker_id = auth.uid());

-- RECEIPTS
create policy "owner_manages_receipts" on public.receipts for all using (
  project_id in (select id from public.projects where owner_id = auth.uid())
);
create policy "worker_inserts_receipts" on public.receipts for insert with check (
  project_id in (select project_id from public.project_workers where worker_id = auth.uid())
);

-- TIME_ENTRIES
create policy "owner_sees_all_time_entries" on public.time_entries for select using (
  project_id in (select id from public.projects where owner_id = auth.uid())
);
create policy "worker_manages_own_time_entries" on public.time_entries for all using (worker_id = auth.uid());

-- SCHEDULE_ENTRIES
create policy "owner_manages_schedule" on public.schedule_entries for all using (owner_id = auth.uid());
create policy "worker_sees_own_schedule" on public.schedule_entries for select using (worker_id = auth.uid());

-- ------------------------------------------------------------
-- 7. STORAGE POLICIES for the receipts bucket
-- ------------------------------------------------------------
drop policy if exists "auth_upload_receipts"  on storage.objects;
drop policy if exists "receipts_public_read"  on storage.objects;
create policy "auth_upload_receipts" on storage.objects for insert
  with check (bucket_id = 'receipts' and auth.role() = 'authenticated');
create policy "receipts_public_read" on storage.objects for select
  using (bucket_id = 'receipts');

-- ------------------------------------------------------------
-- 8. PERFORMANCE INDEXES
-- ------------------------------------------------------------
create index if not exists idx_projects_owner_id        on public.projects(owner_id);
create index if not exists idx_receipts_project_id       on public.receipts(project_id);
create index if not exists idx_time_entries_project_id   on public.time_entries(project_id);
create index if not exists idx_time_entries_worker_id    on public.time_entries(worker_id);
create index if not exists idx_project_workers_worker_id on public.project_workers(worker_id);
create index if not exists idx_profiles_owner_id         on public.profiles(owner_id);
create index if not exists idx_schedule_worker_id        on public.schedule_entries(worker_id);
create index if not exists idx_schedule_project_id       on public.schedule_entries(project_id);

-- ============================================================
-- DONE. After running: hard-refresh the app (Ctrl+Shift+R).
-- Test: add a receipt (category saves), schedule a worker
-- (no error), and confirm you can only see your own data.
-- ============================================================
