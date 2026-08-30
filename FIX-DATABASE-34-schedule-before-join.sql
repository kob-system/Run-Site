-- ============================================================
-- FIX-DATABASE-34 — schedule a worker BEFORE he taps his link
-- ============================================================
-- JP, 2026-08-30: "The owner should be able to schedule the worker
-- before he uses the link. That way he can have it scheduled and then
-- send him a link."
--
-- THE PROBLEM
-- schedule_entries.worker_id is a foreign key to profiles(id), and a
-- profile only comes into existence when the new hire opens his invite
-- link and signs up. So a brand-new hire could not be put on a day at
-- all. The owner had to text the link, wait for the man to tap it, and
-- only then build his week — which is backwards from how a contractor
-- actually works: he plans Monday on Sunday night, then tells people.
--
-- THE FIX
-- A shift can now point at EITHER a joined worker (worker_id) or an
-- unclaimed invite (invite_id). When the invite is claimed, the shifts
-- booked against it are rewritten to the real profile and the invite_id
-- is cleared — see api/claim-invite.js. Nothing else in the app has to
-- know about the pending state after that moment.
--
-- WHY NOT PRE-CREATE A PROFILE INSTEAD
-- profiles.id is the auth user's id. There is no auth user until signup,
-- so a placeholder profile would either need a fake uuid (which then has
-- to be migrated anyway, with RLS holes in between) or a real auth user
-- created for someone who has not agreed to anything yet. Pointing the
-- shift at the invite is the smaller, reversible change.
--
-- Safe to run more than once.
-- ------------------------------------------------------------

-- ---------- 1. the column ----------
alter table public.schedule_entries
  add column if not exists invite_id uuid
    references public.worker_invites(id) on delete cascade;

create index if not exists idx_schedule_invite_id
  on public.schedule_entries(invite_id);

comment on column public.schedule_entries.invite_id is
  'Set instead of worker_id when this shift was booked for someone who has not claimed his invite yet. api/claim-invite.js swaps it for the real worker_id on claim.';

-- ---------- 2. exactly one target ----------
-- A shift belongs to one person. Booking it against both a profile and an
-- invite, or against neither, is a bug, not a state.
--
-- Added NOT VALID on purpose: worker_id has always been nullable, so a
-- historic row with no worker on it would otherwise abort this whole
-- migration. New and updated rows are checked from this moment on. The
-- DO block below tries to validate the back catalogue and REPORTS rather
-- than failing, so a bad old row is something you find out about instead
-- of something that stops the deploy.
alter table public.schedule_entries
  drop constraint if exists schedule_target_exactly_one;

alter table public.schedule_entries
  add constraint schedule_target_exactly_one
  check ((worker_id is not null) <> (invite_id is not null))
  not valid;

do $$
begin
  alter table public.schedule_entries validate constraint schedule_target_exactly_one;
  raise notice 'schedule_target_exactly_one: validated, every existing row has exactly one target.';
exception when others then
  raise notice 'schedule_target_exactly_one: left NOT VALID. Some existing rows have no worker_id. Find them with: select id, owner_id, project_id, scheduled_date from public.schedule_entries where worker_id is null and invite_id is null;';
end $$;

-- ---------- 3. RLS ----------
-- The owner policy is `owner_id = auth.uid()` for ALL, so inserting a
-- pending shift is already covered and needs no change.
--
-- The worker policy is `worker_id = auth.uid()`. A pending row has a null
-- worker_id, so no worker can see a shift booked against an invite — not
-- even the man it is for, until he joins and the row is rewritten to him.
-- That is the behaviour we want: nothing leaks to a half-joined account.
--
-- Restated here rather than changed, so the next person reading this file
-- does not have to go back to FIX-DATABASE.sql to confirm it is safe.

-- ---------- 4. prove it ran ----------
-- Expect one row: invite_id | uuid | YES
select column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema = 'public'
   and table_name   = 'schedule_entries'
   and column_name  = 'invite_id';
