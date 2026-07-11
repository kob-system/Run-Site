-- ============================================================
-- FIX-DATABASE-20-allow-owner-unlink.sql
-- Fixes: owner's "Remove" worker button fails in production.
-- Run ONCE in Supabase → SQL Editor, AFTER FIX-DATABASE-19.
-- Idempotent / safe to re-run.
--
-- Root cause: a policy/trigger conflict between two migrations.
--   • FIX-8 added the RLS policy "owner can update their workers" whose
--     WITH CHECK explicitly permits owner_id → NULL, because "Remove
--     worker" is a soft-unlink (profiles.owner_id → null) that preserves
--     the worker's account and logged hours.
--   • FIX-14/15's lock_profile_identity() trigger later made owner_id
--     blanket-immutable ("owner_id is immutable"), which also blocks the
--     legitimate unlink. The app's removeWorker() has failed ever since
--     FIX-15 was applied.
--
-- Fix: allow exactly ONE extra transition — the row's CURRENT employer
-- (auth.uid() = old.owner_id) may set owner_id to NULL. Everything else
-- stays locked: a worker can't detach themselves, nobody can reassign a
-- worker to a different owner, and null → value (first-time linking)
-- still works as before. Re-linking after removal is null → value, so it
-- keeps working too. service_role stays exempt.
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

  -- owner_id: immutable once set, EXCEPT the current employer unlinking
  -- their own worker (value -> null by auth.uid() = old.owner_id). This is
  -- the owner-side "Remove worker" soft-unlink that FIX-8's RLS policy
  -- already permits. Workers still cannot detach themselves, and nobody
  -- can move a worker to a different owner.
  if old.owner_id is not null and new.owner_id is distinct from old.owner_id then
    if not (new.owner_id is null and auth.uid() = old.owner_id) then
      raise exception 'owner_id is immutable';
    end if;
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

-- Trigger already exists and points at this function; recreate defensively
-- in case an earlier migration was never applied on this database.
drop trigger if exists trg_lock_profile_identity on public.profiles;
create trigger trg_lock_profile_identity
  before update on public.profiles
  for each row execute function public.lock_profile_identity();

-- ------------------------------------------------------------
-- VERIFY (run after applying):
--   -- In the app as a logged-in OWNER: "Remove" on a crew member must
--   --   succeed (worker disappears from the crew list, stays gone after
--   --   refresh, and their past hours on jobs are untouched).
--   -- As a logged-in WORKER, this must still ERROR:
--   --   update public.profiles set owner_id = null where id = auth.uid();
--   -- Role/email/created_at immutability and the hourly_rate employer-only
--   --   rule are unchanged from FIX-15.
-- ============================================================
