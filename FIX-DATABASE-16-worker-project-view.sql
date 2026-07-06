-- ============================================================
-- FIX-DATABASE-16-worker-project-view.sql
-- Stops workers from reading their employer's job financials.
--
-- Hole (2026-07-06 audit): worker_sees_assigned_projects grants workers SELECT
-- on the WHOLE projects row, and WorkerDashboard did `.from('projects')
-- .select('*')`. RLS can't restrict columns, so an assigned crew member could
-- read materials_budget / labor_budget / profit_target / labor_spent and the
-- client's phone/email for jobs they're on. Within-tenant, cross-role leak.
--
-- Fix: workers stop touching the base table. They read three SECURITY DEFINER
-- views, each hard-scoped to auth.uid(), that expose ONLY the columns the crew
-- UI needs (never budgets/margins/client contact beyond the site address they
-- need for directions). Owners are unaffected (owner_manages_projects covers
-- them).
--
-- APPLY ORDER (important — Part B removes the worker's base-table read, so it
-- MUST go live together with / after the WorkerDashboard deploy that reads the
-- views; otherwise the crew's job list goes empty):
--   1. Run Part A now (additive + safe).
--   2. Merge + deploy the WorkerDashboard change (PR #13).
--   3. Run Part B.
-- Idempotent / safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- PART A — the views (safe to apply anytime; additive).
-- SECURITY DEFINER (security_invoker=off) so the join to projects works even
-- after Part B removes the worker's base SELECT. Each view is hard-scoped by
-- auth.uid() (a verified-JWT value the caller cannot forge), so the definer
-- privilege can never read another user's rows.
-- ------------------------------------------------------------

-- Assigned, not-yet-finished jobs — safe columns only.
create or replace view public.worker_projects
with (security_invoker = off) as
  select p.id, p.name, p.owner_id, p.client_address, p.stage
  from public.projects p
  where p.stage is distinct from 'end'
    and exists (
      select 1 from public.project_workers pw
      where pw.project_id = p.id and pw.worker_id = auth.uid()
    );

-- The worker's OWN time entries + the job name (for shift history), no financials.
create or replace view public.worker_time_entries
with (security_invoker = off) as
  select te.id, te.client_id, te.project_id, te.worker_id,
         te.clocked_in_at, te.clocked_out_at, te.total_minutes,
         te.gps_lat, te.gps_lng, te.labor_cost,
         p.name as project_name
  from public.time_entries te
  left join public.projects p on p.id = te.project_id
  where te.worker_id = auth.uid();

-- The worker's OWN upcoming schedule + the job name.
create or replace view public.worker_schedule
with (security_invoker = off) as
  select s.*, p.name as project_name
  from public.schedule_entries s
  left join public.projects p on p.id = s.project_id
  where s.worker_id = auth.uid();

grant select on public.worker_projects       to authenticated;
grant select on public.worker_time_entries    to authenticated;
grant select on public.worker_schedule        to authenticated;

-- ------------------------------------------------------------
-- PART B — remove the worker's column-wide read of the base table.
-- RUN ONLY AFTER the WorkerDashboard deploy (PR #13) is live, or the crew's
-- job list will be empty. Uncomment and run as step 3.
-- ------------------------------------------------------------
-- drop policy if exists "worker_sees_assigned_projects" on public.projects;

-- ------------------------------------------------------------
-- VERIFY:
--   -- as a worker (in the app), these must return only their assigned jobs and
--   -- must NOT expose budget/profit columns:
--   select * from public.worker_projects;
--   -- after Part B, a worker's direct base read must return nothing:
--   select * from public.projects;   -- expect 0 rows for a worker
-- ============================================================
