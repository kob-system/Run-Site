-- ============================================================
-- FIX-DATABASE-27-worker-lists.sql
-- Let the crew SEE (and check off) the shopping list and the fix-it list
-- for the jobs they are assigned to.
--
-- WHY THIS FILE EXISTS:
-- material_items and punch_items (FIX-DATABASE-7) carry exactly one policy:
--   for all using (owner_id = auth.uid())
-- So the owner types a shopping list and a punch list that literally nobody
-- else can read. The crew — the people who go to the supply house and fix the
-- items — get nothing. WorkerDashboard.js has zero references to either table
-- because there was never a readable surface to reference.
--
-- SHAPE (same pattern as FIX-DATABASE-16's worker_projects):
--   READS  -> SECURITY DEFINER views, hard-scoped by auth.uid() through
--             project_workers. A verified-JWT value the caller cannot forge.
--   WRITES -> SECURITY DEFINER functions, NOT the views. An updatable definer
--             view would let a worker UPDATE straight past the owner-only RLS
--             policy on the base table, including columns like owner_id and
--             project_id. The functions touch exactly one boolean column and
--             re-check assignment on every call.
--
-- Scope decision: the lists are scoped to the JOB, not to individual workers.
-- Anyone assigned to the job sees the job's lists. Per-worker visibility
-- checkboxes on a shopping list are the kind of hidden detail this app is
-- trying not to have.
--
-- RUN ORDER: after FIX-DATABASE-1 (is_worker_on_project) and -7 (the tables).
-- Idempotent — safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- READS
-- ------------------------------------------------------------

drop view if exists public.worker_material_items;
create view public.worker_material_items
with (security_invoker = off) as
  select
    mi.id,
    mi.project_id,
    mi.name,
    mi.qty,
    mi.bought,
    mi.created_at,
    p.name as project_name
  from public.material_items mi
  join public.projects p on p.id = mi.project_id
  where exists (
    select 1 from public.project_workers pw
    where pw.project_id = mi.project_id
      and pw.worker_id = auth.uid()
  );

drop view if exists public.worker_punch_items;
create view public.worker_punch_items
with (security_invoker = off) as
  select
    pi.id,
    pi.project_id,
    pi.description,
    pi.done,
    pi.created_at,
    p.name as project_name
  from public.punch_items pi
  join public.projects p on p.id = pi.project_id
  where exists (
    select 1 from public.project_workers pw
    where pw.project_id = pi.project_id
      and pw.worker_id = auth.uid()
  );

-- owner_id is deliberately NOT selected. The worker has no use for it and the
-- view must not become a directory of owner user-ids.

grant select on public.worker_material_items to authenticated;
grant select on public.worker_punch_items    to authenticated;

-- No INSERT/UPDATE/DELETE grant. These are read surfaces only; the writes
-- below are the sole path.

-- ------------------------------------------------------------
-- WRITES — one boolean each, assignment re-checked every call
-- ------------------------------------------------------------

create or replace function public.worker_set_material_bought(
  p_item_id uuid,
  p_bought  boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project_id uuid;
begin
  select project_id into v_project_id
  from public.material_items
  where id = p_item_id;

  if v_project_id is null then
    raise exception 'item not found' using errcode = 'no_data_found';
  end if;

  -- is_worker_on_project is itself SECURITY DEFINER and reads auth.uid(),
  -- so a worker can only ever mark items on a job they are assigned to.
  if not public.is_worker_on_project(v_project_id) then
    raise exception 'not assigned to this job' using errcode = 'insufficient_privilege';
  end if;

  update public.material_items
  set bought = coalesce(p_bought, false)
  where id = p_item_id;
end;
$$;

create or replace function public.worker_set_punch_done(
  p_item_id uuid,
  p_done    boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project_id uuid;
begin
  select project_id into v_project_id
  from public.punch_items
  where id = p_item_id;

  if v_project_id is null then
    raise exception 'item not found' using errcode = 'no_data_found';
  end if;

  if not public.is_worker_on_project(v_project_id) then
    raise exception 'not assigned to this job' using errcode = 'insufficient_privilege';
  end if;

  update public.punch_items
  set done = coalesce(p_done, false)
  where id = p_item_id;
end;
$$;

revoke all on function public.worker_set_material_bought(uuid, boolean) from public;
grant execute on function public.worker_set_material_bought(uuid, boolean) to authenticated;

revoke all on function public.worker_set_punch_done(uuid, boolean) from public;
grant execute on function public.worker_set_punch_done(uuid, boolean) to authenticated;

-- ------------------------------------------------------------
-- VERIFY (run after applying)
-- ------------------------------------------------------------
-- 1) Both views exist and are SECURITY DEFINER (reloptions shows
--    security_invoker=false, or the option is simply absent = definer):
--
-- select c.relname, c.reloptions
-- from pg_class c
-- join pg_namespace n on n.oid = c.relnamespace
-- where n.nspname = 'public'
--   and c.relname in ('worker_material_items','worker_punch_items');
--
-- 2) Both functions are definer with a locked search_path:
--
-- select proname, prosecdef, proconfig
-- from pg_proc
-- where proname in ('worker_set_material_bought','worker_set_punch_done');
--
-- 3) As a WORKER jwt: selecting the views returns only rows for jobs in
--    project_workers for that worker, and a direct
--    `update public.material_items set bought = true` still fails on RLS.
