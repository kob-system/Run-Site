-- ============================================================
-- FIX-DATABASE-17-hole-cleanup.sql
-- Closes the 5 leftover holes from the 2026-07-06 hole-hunts.
-- Run ONCE in Supabase → SQL Editor, AFTER FIX-DATABASE-1..16.
-- Idempotent / safe to re-run.
--
-- Covers (DB side):
--   A. Extend the paywall write-gate beyond `projects` to every other
--      owner-created table (estimates, invoices, change_orders, daily_logs,
--      job_photos, punch_items, material_items). Was: soft paywall — a lapsed
--      owner could still create estimates/invoices. Now the DB refuses writes
--      to ALL billable surfaces without access. Reads stay open (data-safe).
--   D. Tighten has_app_access(): a NULL current_period_end no longer grants
--      access forever for a paid status. `comp` (grandfathered/free-forever,
--      set only by admin/service role) still allows NULL by design; `active` /
--      `trialing` now REQUIRE a real future period_end (fail-closed, not open).
--   B. Add subscriptions.last_event_at to support the webhook's out-of-order
--      event guard (cancel -> fast-resubscribe race). The webhook code writes
--      it; this just adds the column.
--   C. Worker owner_id integrity: a worker profile's owner_id must reference a
--      real OWNER profile. Blocks attaching to a garbage / typo'd / non-owner
--      uuid on the client-trusted insert path (Login.js AND the App.js
--      metadata path both flow through this trigger). NOTE: signing up against
--      a *known real owner's* email without an invite remains by-design
--      (the find-owner flow) — this only rejects bogus targets.
-- ============================================================

-- ------------------------------------------------------------
-- D. has_app_access(uid) — fail-closed on NULL period_end for paid statuses.
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
  -- Complimentary (comp) = free forever, granted only by admin/service role;
  -- NULL period_end is intentional here.
  if exists (
    select 1 from public.subscriptions s
    where s.owner_id = uid
      and s.status = 'comp'
  ) then
    return true;
  end if;

  -- Paid statuses must have a REAL, unexpired period end. A NULL period_end on
  -- an active/trialing row is a data gap, not a licence to use the app forever.
  if exists (
    select 1 from public.subscriptions s
    where s.owner_id = uid
      and s.status in ('active', 'trialing')
      and s.current_period_end is not null
      and s.current_period_end > now()
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

-- ------------------------------------------------------------
-- A. Extend the RESTRICTIVE write-gate to every owner-created table.
-- RESTRICTIVE = AND-ed with the existing "owner_id = auth.uid()" policy, so it
-- only tightens: a lapsed owner keeps READ access to their data but cannot
-- create or edit any of it. All of these tables are owner-only (workers never
-- write them), so this cannot break worker clock-in. Idempotent via a loop.
-- ------------------------------------------------------------
do $$
declare
  t text;
  gated_tables text[] := array[
    'estimates', 'invoices', 'change_orders', 'daily_logs',
    'job_photos', 'punch_items', 'material_items'
  ];
begin
  foreach t in array gated_tables loop
    -- Only act if the table actually exists in this project.
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists %I on public.%I',
                     t || '_require_access_insert', t);
      execute format(
        'create policy %I on public.%I as restrictive for insert '
        || 'with check (public.has_app_access(auth.uid()))',
        t || '_require_access_insert', t);

      execute format('drop policy if exists %I on public.%I',
                     t || '_require_access_update', t);
      execute format(
        'create policy %I on public.%I as restrictive for update '
        || 'using (public.has_app_access(auth.uid())) '
        || 'with check (public.has_app_access(auth.uid()))',
        t || '_require_access_update', t);
    end if;
  end loop;
end $$;

-- ------------------------------------------------------------
-- B. subscriptions.last_event_at — the webhook uses this to drop stale,
-- out-of-order Stripe events (e.g. a late subscription.deleted arriving after
-- the owner already resubscribed). Column only; logic lives in the webhook.
-- ------------------------------------------------------------
alter table public.subscriptions
  add column if not exists last_event_at timestamptz;

-- ------------------------------------------------------------
-- C. Worker owner_id integrity — a worker's owner_id must point at a real
-- owner. Runs BEFORE the existing identity-lock trigger's concern (that one
-- freezes owner_id once set; this one validates it at first set). service_role
-- (admin / migrations / server claim) is exempt.
-- ------------------------------------------------------------
create or replace function public.validate_worker_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if current_user = 'service_role' then
    return new;
  end if;
  -- Only workers link to an owner; owners have owner_id null.
  if new.role = 'worker' and new.owner_id is not null then
    if new.owner_id = new.id then
      raise exception 'a worker cannot be their own owner';
    end if;
    if not exists (
      select 1 from public.profiles p
      where p.id = new.owner_id and p.role = 'owner'
    ) then
      raise exception 'owner_id must reference a real owner account';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_worker_owner on public.profiles;
create trigger trg_validate_worker_owner
  before insert or update on public.profiles
  for each row execute function public.validate_worker_owner();

-- ------------------------------------------------------------
-- VERIFY (run after applying):
--   -- new/updated write-gates present on all billable tables:
--   select tablename, count(*) from pg_policies
--   where policyname like '%_require_access_%' group by tablename order by tablename;
--   -- last_event_at column exists:
--   select column_name from information_schema.columns
--   where table_name='subscriptions' and column_name='last_event_at';
--   -- worker-owner trigger present:
--   select tgname from pg_trigger where tgrelid='public.profiles'::regclass
--   and tgname='trg_validate_worker_owner';
--   -- has_app_access still lets comp through, blocks null-period paid:
--   select proname, prosecdef from pg_proc where proname='has_app_access';
-- ============================================================
