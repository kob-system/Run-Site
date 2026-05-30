-- ============================================================================
-- Run-Site — Row Level Security (RLS) lockdown
-- ----------------------------------------------------------------------------
-- WHAT THIS DOES (plain English):
--   Turns on the database's per-row "keycard" so every contractor company can
--   ONLY see and change its OWN data. Without this, anyone holding the public
--   anon key can read/write every company's jobs, receipts, and crew.
--
-- HOW TO APPLY:
--   Supabase Dashboard -> SQL Editor -> New query -> paste ALL of this -> Run.
--   Safe to run more than once (it drops & recreates its own policies).
--
-- TENANT MODEL (read straight from the app code):
--   * profiles.id == the Supabase Auth user id (set at signup).
--   * Owners (role='owner') have owner_id = NULL; their profiles.id IS the
--     company/tenant id.
--   * Workers (role='worker') have owner_id = their boss's profiles.id.
--   * projects.owner_id / receipts.owner_id / schedule_entries.owner_id all
--     equal the owning company's tenant id.
--   * time_entries & project_workers carry worker_id + project_id (no owner_id),
--     so they are scoped through the project's owner.
-- ============================================================================

-- 1) Helper: the tenant (company) id for the currently logged-in user.
create or replace function public.current_tenant_id()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select coalesce(p.owner_id, p.id)
  from public.profiles p
  where p.id = auth.uid()
$$;

-- 2) Helper: let a NOT-yet-logged-in worker find their boss by email during
--    signup, WITHOUT exposing the whole profiles table to the public.
create or replace function public.find_owner_id(owner_email text)
returns uuid
language sql stable security definer
set search_path = public
as $$
  select id from public.profiles
  where email = owner_email and role = 'owner'
  limit 1
$$;

grant execute on function public.current_tenant_id() to authenticated;
grant execute on function public.find_owner_id(text) to anon, authenticated;

-- 3) Turn RLS ON (deny-by-default once the policies below exist).
alter table public.profiles         enable row level security;
alter table public.projects         enable row level security;
alter table public.receipts         enable row level security;
alter table public.time_entries     enable row level security;
alter table public.schedule_entries enable row level security;
alter table public.project_workers  enable row level security;

-- ============================ profiles ======================================
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or id = public.current_tenant_id()        -- my boss (if I'm a worker)
    or owner_id = public.current_tenant_id()  -- people in my company
  );

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert to authenticated
  with check ( id = auth.uid() );             -- you may only create your own row

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using ( id = auth.uid() or owner_id = public.current_tenant_id() )
  with check ( id = auth.uid() or owner_id = public.current_tenant_id() );

-- ============================ projects ======================================
-- Owners get full access to their jobs; workers in the same company can read &
-- update (the app bumps labor_spent on clock-out).
drop policy if exists projects_rw on public.projects;
create policy projects_rw on public.projects
  for all to authenticated
  using ( owner_id = public.current_tenant_id() )
  with check ( owner_id = public.current_tenant_id() );

-- ============================ receipts ======================================
drop policy if exists receipts_rw on public.receipts;
create policy receipts_rw on public.receipts
  for all to authenticated
  using ( owner_id = public.current_tenant_id() )
  with check ( owner_id = public.current_tenant_id() );

-- ========================== time_entries ====================================
-- A worker manages their own entries; the company owner sees/manages entries
-- tied to their projects.
drop policy if exists time_entries_rw on public.time_entries;
create policy time_entries_rw on public.time_entries
  for all to authenticated
  using (
    worker_id = auth.uid()
    or exists (
      select 1 from public.projects pr
      where pr.id = time_entries.project_id
        and pr.owner_id = public.current_tenant_id()
    )
  )
  with check (
    worker_id = auth.uid()
    or exists (
      select 1 from public.projects pr
      where pr.id = time_entries.project_id
        and pr.owner_id = public.current_tenant_id()
    )
  );

-- ========================= schedule_entries =================================
drop policy if exists schedule_rw on public.schedule_entries;
create policy schedule_rw on public.schedule_entries
  for all to authenticated
  using ( owner_id = public.current_tenant_id() or worker_id = auth.uid() )
  with check ( owner_id = public.current_tenant_id() or worker_id = auth.uid() );

-- ========================= project_workers ==================================
-- Owner assigns crew to their projects; a worker can read their own links.
drop policy if exists project_workers_rw on public.project_workers;
create policy project_workers_rw on public.project_workers
  for all to authenticated
  using (
    worker_id = auth.uid()
    or exists (
      select 1 from public.projects pr
      where pr.id = project_workers.project_id
        and pr.owner_id = public.current_tenant_id()
    )
  )
  with check (
    exists (
      select 1 from public.projects pr
      where pr.id = project_workers.project_id
        and pr.owner_id = public.current_tenant_id()
    )
  );

-- ============================================================================
-- STILL TO DO (not covered by the table RLS above):
--   * Receipt photos: the "receipts" Storage bucket is currently PUBLIC, so a
--     photo URL is viewable by anyone who has the link. Locking that down means
--     making the bucket private + switching the app to signed URLs. Separate job.
--   * Worker write scope on projects is company-wide (RLS can't limit columns),
--     so a worker could in theory change a job's budget, not just labor_spent.
--     Fine for cross-company safety; tighten later with a DB trigger if desired.
-- ============================================================================
