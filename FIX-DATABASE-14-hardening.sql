-- ============================================================
-- FIX-DATABASE-14-hardening.sql
-- Post-launch security hardening (addresses the 2026-07-06 audit).
-- Run ONCE in Supabase → SQL Editor, AFTER FIX-DATABASE-1..13.
-- Idempotent / safe to re-run.
--
-- Covers:
--   A. has_app_access() + server-side paywall enforcement on projects
--      (closes the "techie edits the client to bypass billing" hole — the
--       DB itself now refuses job writes without access).
--   B. profiles identity lockdown + unique email (blocks the profile
--      role/email/owner_id hijack from the audit).
--   C. add_labor_cost() input clamp.
--
-- Access model (mirrors src/App.js): an owner has access if they are inside
-- the 7-day no-card free window from signup, OR have an active/trialing/comp
-- subscription that hasn't lapsed.
-- ============================================================

-- ------------------------------------------------------------
-- A. has_app_access(uid) — SECURITY DEFINER so it can read subscriptions +
-- profiles regardless of the caller's own RLS. plpgsql (never inlined) so the
-- SECURITY DEFINER boundary + locked search_path always hold.
-- ------------------------------------------------------------
create or replace function public.has_app_access(uid uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_created timestamptz;
begin
  -- Active / trialing / complimentary subscription that hasn't lapsed.
  if exists (
    select 1 from public.subscriptions s
    where s.owner_id = uid
      and s.status in ('active', 'trialing', 'comp')
      and (s.current_period_end is null or s.current_period_end > now())
  ) then
    return true;
  end if;

  -- Otherwise, still inside the 7-day no-card free window from signup.
  select p.created_at into v_created from public.profiles p where p.id = uid;
  if v_created is not null and v_created > now() - interval '7 days' then
    return true;
  end if;

  return false;
end;
$$;

revoke all on function public.has_app_access(uuid) from public;
grant execute on function public.has_app_access(uuid) to authenticated;

-- Gate WRITES to projects (jobs) — the choke point the whole app hangs off.
-- RESTRICTIVE = AND-ed with the existing owner policy, so it only *tightens*:
-- a lapsed owner keeps read access to their data but cannot create or edit
-- jobs. The Stripe webhook uses the service role, which bypasses RLS entirely,
-- so billing writes are unaffected. Projects are owner-only (workers just get
-- SELECT), so this cannot break worker clock-in.
drop policy if exists "projects_require_access_insert" on public.projects;
create policy "projects_require_access_insert" on public.projects
  as restrictive for insert
  with check (public.has_app_access(auth.uid()));

drop policy if exists "projects_require_access_update" on public.projects;
create policy "projects_require_access_update" on public.projects
  as restrictive for update
  using (public.has_app_access(auth.uid()))
  with check (public.has_app_access(auth.uid()));

-- ------------------------------------------------------------
-- B. profiles identity lockdown.
-- update_own_profile currently lets a user rewrite their own role / email /
-- owner_id, enabling the roster self-link + onboarding-hijack from the audit.
-- This trigger makes those three columns immutable once set (null -> value is
-- still allowed, so first-time linking works; value -> other-value is blocked).
-- service_role (admin / migrations) is exempt.
-- ------------------------------------------------------------
create or replace function public.lock_profile_identity()
returns trigger
language plpgsql
as $$
begin
  if current_user = 'service_role' then
    return new;
  end if;
  if old.role is not null and new.role is distinct from old.role then
    raise exception 'role is immutable';
  end if;
  if old.owner_id is not null and new.owner_id is distinct from old.owner_id then
    raise exception 'owner_id is immutable';
  end if;
  if old.email is not null and lower(new.email) is distinct from lower(old.email) then
    raise exception 'email is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_lock_profile_identity on public.profiles;
create trigger trg_lock_profile_identity
  before update on public.profiles
  for each row execute function public.lock_profile_identity();

-- Defense in depth: one profile per email. Tolerant create — if legacy
-- duplicate emails exist it just logs a notice instead of failing the whole
-- migration (dedupe those rows, then re-run this block).
do $$
begin
  begin
    create unique index if not exists profiles_email_unique
      on public.profiles (lower(email)) where email is not null;
  exception when others then
    raise notice 'profiles_email_unique NOT created (duplicate emails?) — dedupe then re-run this block';
  end;
end $$;

-- ------------------------------------------------------------
-- C. add_labor_cost clamp — reject negative / absurd amounts. A single
-- clock-out labor increment above $100k is not legitimate.
-- ------------------------------------------------------------
create or replace function public.add_labor_cost(p_project_id uuid, p_cost numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_owner_of_project(p_project_id)
          or public.is_worker_on_project(p_project_id)) then
    raise exception 'Not authorized to add labor cost to this project';
  end if;

  if p_cost is null or p_cost < 0 or p_cost > 100000 then
    raise exception 'Invalid labor cost: %', p_cost;
  end if;

  update public.projects
    set labor_spent = coalesce(labor_spent, 0) + p_cost
    where id = p_project_id;
end;
$$;

grant execute on function public.add_labor_cost(uuid, numeric) to authenticated;

-- ------------------------------------------------------------
-- VERIFY (run after applying):
--   -- helper present, security definer, plpgsql:
--   select proname, prosecdef, (select lanname from pg_language l where l.oid=p.prolang) lang
--   from pg_proc p where proname in ('has_app_access','lock_profile_identity');
--   -- restrictive gates on projects:
--   select policyname, cmd, permissive from pg_policies
--   where tablename='projects' and policyname like 'projects_require_access%';
--   -- trigger present:
--   select tgname from pg_trigger where tgrelid='public.profiles'::regclass and tgname='trg_lock_profile_identity';
-- ============================================================
