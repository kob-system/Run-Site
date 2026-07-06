-- ============================================================
-- FIX-DATABASE-15-profile-column-lock.sql
-- Closes two "self-service" profile-column holes found in the 2026-07-06
-- deep audit. Run ONCE in Supabase → SQL Editor, AFTER FIX-DATABASE-14.
-- Idempotent / safe to re-run.
--
-- Root cause (shared): the `update_own_profile` RLS policy allows an
-- authenticated user to UPDATE any column of their own profile row, and the
-- FIX-14 identity-lock trigger only froze role / owner_id / email. Two
-- billing/money-relevant columns were left writable:
--
--   1. created_at  → has_app_access() grants a 7-day free window off
--      profiles.created_at. A lapsed owner could reset created_at to now()
--      from the browser console and get the whole app free, forever.
--      (CRITICAL — the repo is public, so the schema + gate are readable.)
--
--   2. hourly_rate → the payroll trigger recomputes labor_cost from the
--      server-held profiles.hourly_rate ("never trust the client"). But a
--      worker can PATCH their OWN hourly_rate directly via PostgREST, then
--      clock a shift → inflated labor_cost flows into the owner's job costs.
--      (HIGH — payroll fraud. The owner still legitimately sets a worker's
--      rate; only the worker editing their OWN row is blocked.)
--
-- Both are fixed by extending lock_profile_identity(). service_role
-- (migrations / webhook / admin) stays exempt so grandfathering + owner
-- rate-setting keep working.
-- ============================================================

create or replace function public.lock_profile_identity()
returns trigger
language plpgsql
as $$
begin
  -- Migrations / server (webhook, admin scripts) may do anything.
  if current_user = 'service_role' then
    return new;
  end if;

  -- Identity columns: immutable once set (null -> value still allowed so
  -- first-time linking works; value -> other-value is blocked).
  if old.role is not null and new.role is distinct from old.role then
    raise exception 'role is immutable';
  end if;
  if old.owner_id is not null and new.owner_id is distinct from old.owner_id then
    raise exception 'owner_id is immutable';
  end if;
  if old.email is not null and lower(new.email) is distinct from lower(old.email) then
    raise exception 'email is immutable';
  end if;

  -- Billing anchor: created_at drives the free-window in has_app_access().
  -- Nobody but service_role may ever change it.
  if old.created_at is not null and new.created_at is distinct from old.created_at then
    raise exception 'created_at is immutable';
  end if;

  -- Pay rate: only the EMPLOYER (owner updating a worker's row, where
  -- auth.uid() <> this row's id) or service_role may change hourly_rate. A
  -- worker editing their OWN row cannot touch it. Guard on a real change so
  -- normal self-updates (name, phone, etc.) are unaffected.
  if new.hourly_rate is distinct from old.hourly_rate
     and auth.uid() = new.id then
    raise exception 'hourly_rate can only be set by your employer';
  end if;

  return new;
end;
$$;

-- Trigger already exists from FIX-14 and points at this function; recreate
-- defensively in case FIX-14 was never applied on this database.
drop trigger if exists trg_lock_profile_identity on public.profiles;
create trigger trg_lock_profile_identity
  before update on public.profiles
  for each row execute function public.lock_profile_identity();

-- Defense in depth: revoke the column-level UPDATE grant on created_at from
-- ordinary authenticated users. Nothing legitimate writes it except
-- service_role. Wrapped so a grant-model quirk can't fail the whole migration.
do $$
begin
  begin
    revoke update (created_at) on public.profiles from authenticated;
  exception when others then
    raise notice 'created_at column revoke skipped: %', sqlerrm;
  end;
end $$;

-- ------------------------------------------------------------
-- VERIFY (run after applying):
--   -- As a NON-service role (e.g. in the app as a logged-in owner), this must ERROR:
--   --   update public.profiles set created_at = now() where id = auth.uid();
--   -- As a logged-in worker, this must ERROR:
--   --   update public.profiles set hourly_rate = 999 where id = auth.uid();
--   -- Owner updating THEIR worker's hourly_rate must still succeed.
--   select tgname from pg_trigger
--   where tgrelid = 'public.profiles'::regclass and tgname = 'trg_lock_profile_identity';
-- ============================================================
