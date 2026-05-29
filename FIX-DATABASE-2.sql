-- ============================================================
-- RUN-SITE — DATABASE FIX MIGRATION #2
-- Run this ONCE in Supabase → SQL Editor, AFTER FIX-DATABASE.sql
-- and the RLS recursion patch have already been applied.
-- Safe to re-run (idempotent).
--
-- WHY: After locking down RLS, only a project's OWNER can update
-- the projects table. But labor cost is added when a WORKER clocks
-- out — and workers no longer have permission to update projects,
-- so labor_spent silently stopped updating. This adds a controlled
-- SECURITY DEFINER function that performs ONLY the labor_spent
-- increment, after verifying the caller is the owner of, or a
-- worker assigned to, that project.
-- ============================================================

create or replace function public.add_labor_cost(p_project_id uuid, p_cost numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Caller must be the owner of, or an assigned worker on, this project.
  -- (These helper functions were created in the RLS recursion patch.)
  if not (public.is_owner_of_project(p_project_id)
          or public.is_worker_on_project(p_project_id)) then
    raise exception 'Not authorized to add labor cost to this project';
  end if;

  update public.projects
    set labor_spent = coalesce(labor_spent, 0) + coalesce(p_cost, 0)
    where id = p_project_id;
end;
$$;

-- Allow logged-in users to call it (the function itself enforces the
-- per-project authorization check above).
grant execute on function public.add_labor_cost(uuid, numeric) to authenticated;

-- ============================================================
-- DONE. After running this, a worker clocking out will correctly
-- increment the job's labor_spent again.
-- ============================================================
