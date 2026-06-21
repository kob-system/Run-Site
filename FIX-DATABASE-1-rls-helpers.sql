-- ============================================================
-- FIX-DATABASE-1-rls-helpers.sql
-- RLS recursion helper functions, committed to source.
--
-- WHY THIS FILE EXISTS:
-- is_owner_of_project / is_worker_on_project are referenced by the RLS
-- policies and SECURITY DEFINER RPCs in FIX-DATABASE-2, -3, and -8, but their
-- definitions previously lived ONLY in the live database (created during an
-- ad-hoc "RLS recursion patch" that was never committed). Consequences:
--   1) A fresh re-provision from these .sql files would FAIL — FIX-3/FIX-8
--      create policies that call functions that don't exist yet.
--   2) The live security could not be reproduced or audited from source.
--
-- RUN ORDER: this must run BEFORE FIX-DATABASE-2 / -3 / -8.
-- On the EXISTING prod database these functions already exist; create-or-replace
-- with the SAME signature (pid uuid) is idempotent and safe to re-run.
--
-- WHY plpgsql (not sql): a `language sql` helper can be INLINED by the planner,
-- which drops SECURITY DEFINER and re-introduces the RLS recursion this patch
-- was meant to fix. plpgsql is never inlined, so the SECURITY DEFINER boundary
-- and the locked search_path always hold.
-- ============================================================

create or replace function public.is_owner_of_project(pid uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
begin
  return exists (
    select 1 from public.projects p
    where p.id = pid and p.owner_id = auth.uid()
  );
end;
$$;

create or replace function public.is_worker_on_project(pid uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
begin
  return exists (
    select 1 from public.project_workers pw
    where pw.project_id = pid and pw.worker_id = auth.uid()
  );
end;
$$;

revoke all on function public.is_owner_of_project(uuid) from public;
grant execute on function public.is_owner_of_project(uuid) to authenticated;

revoke all on function public.is_worker_on_project(uuid) from public;
grant execute on function public.is_worker_on_project(uuid) to authenticated;

-- ------------------------------------------------------------
-- VERIFY the LIVE functions match this form (run after applying).
-- Expect: lang = 'plpgsql' (NOT 'sql'), prosecdef = true,
-- and proconfig containing a search_path entry, for BOTH rows.
-- ------------------------------------------------------------
-- select proname, prosecdef,
--        (select lanname from pg_language l where l.oid = p.prolang) as lang,
--        proconfig
-- from pg_proc p
-- where proname in ('is_owner_of_project','is_worker_on_project');
