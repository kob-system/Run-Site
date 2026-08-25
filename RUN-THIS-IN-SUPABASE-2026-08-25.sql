-- ============================================================
-- RUN THIS ONCE, IN THE SUPABASE SQL EDITOR
-- ============================================================
-- Generated 2026-08-25. This file is ASSEMBLED, not hand-written: every SQL
-- section below is the verbatim contents of its FIX-DATABASE-*.sql source,
-- concatenated by script. Nothing was retyped, so nothing can have drifted.
-- It SUPERSEDES RUN-THIS-IN-SUPABASE-2026-08-24.sql, which asked you to go
-- open another file and paste it in yourself. That is why it never got run.
--
-- Everything here is additive and idempotent. Nothing deletes anything.
-- Safe to re-run.
--
-- HOW TO RUN IT:
--   supabase.com -> the JobTally project -> SQL Editor -> New query
--   -> paste this whole file -> Run.
--
-- WHAT IS IN IT, and what is broken until you do:
--
--   PART 1  FIX-DATABASE-30  the free tier. VERIFIED MISSING on 2026-08-25:
--           the RPC active_real_jobs answers 404 PGRST202 in production right
--           now. A new signup CANNOT create a job while the pricing page
--           promises "one job free, forever". Every visitor the flyers, the
--           demo and the SEO pages send has been converting to nothing.
--
--   PART 2  FIX-DATABASE-31  one-tap crew join. VERIFIED MISSING: the column
--           worker_invites.revoked_at answers 400 in production. Joining still
--           works (both API endpoints select * on purpose), but the owner's
--           Workers tab silently shows ZERO open invite links, and the button
--           to kill a lost worker's link cannot save.
--
--   PART 3  FIX-DATABASE-32  who else is on my job. New, for Josh. Until it
--           runs, the crew list just does not render; nothing else changes.
--
--   PART 4  the founder allow-list, so /?metrics=1 renders for you.
--
-- ============================================================


-- ============================================================
-- PART 0 - LOOK FIRST. Writes nothing. Run it alone if you want to see the
--          state before changing it.
-- ============================================================

-- Zero rows here = the free tier has never been installed.
select proname from pg_proc
where proname in ('active_real_jobs', 'my_plan_status');

-- Zero rows here = FIX-DATABASE-31 has never run.
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'worker_invites'
  and column_name = 'revoked_at';

-- Which of the two emails actually has an account?
select id, email, created_at from public.profiles
where lower(email) in ('jpkobrossi@hotmail.com', 'kobrossisystems@gmail.com');



-- ============================================================
-- PART 1 - THE FREE TIER (FIX-DATABASE-30, verbatim)
-- ============================================================

-- ============================================================
-- FIX-DATABASE-30 — FREE FOREVER, ONE ACTIVE JOB
-- ============================================================
-- JP's call, 2026-08-11: "a free job forever — that way they can just finish
-- that job and start a new one."
--
-- THE PRODUCT RULE, in one line:
--   You can always run ONE active job, free, forever. Finish it and you can
--   start another. Want two at once? That's what the subscription is for.
--
-- Why this shape wins: a contractor will not pay $150/mo for something he has
-- never watched work on his own numbers. Trying it IS the sale. And unlike a
-- 30-day clock, a free job never expires out from under a guy whose job ran
-- long — the thing that made the old trial hurt is exactly that a real job
-- runs 2–6 weeks and the clock didn't care.
--
-- WHAT THIS DOES NOT TOUCH: the existing 30-day card trial (Stripe
-- trial_period_days=30 in api/create-checkout-session.js) is UNCHANGED. Free
-- tier sits *underneath* it. Someone who never subscribes still gets one job;
-- someone who subscribes gets everything. Both paths coexist.
--
-- WHERE THE GATE LIVES: RLS on public.projects INSERT/UPDATE — the same choke
-- point FIX-DATABASE-14 and -24 already used. Everything downstream (expenses,
-- time entries, receipts, invoices) hangs off a job, so gating jobs gates the
-- app without having to gate twenty tables.
--
-- ⚠️ MUST STAY IN LOCKSTEP WITH src/utils/trialWindow.js. The DB decides what
-- it will accept; the client only decides what to render. If they disagree the
-- user gets a button that throws.
-- ============================================================

-- ------------------------------------------------------------
-- 1) How many REAL, still-running jobs does this owner have?
--    - is_sample excluded: the seeded demo job (FIX-DATABASE-24) is a tutorial,
--      not their work, and it must never eat the free slot.
--    - stage 'end' excluded: a finished job is history. That exclusion is the
--      entire mechanic — finishing a job is what frees the slot.
-- ------------------------------------------------------------
create or replace function public.active_real_jobs(uid uuid)
returns integer
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select count(*)::int
  from public.projects p
  where p.owner_id = uid
    and coalesce(p.is_sample, false) = false
    and coalesce(p.stage, 'start') <> 'end';
$$;

revoke all on function public.active_real_jobs(uuid) from public;
grant execute on function public.active_real_jobs(uuid) to authenticated;

-- ------------------------------------------------------------
-- 2) INSERT — a free owner may create a job only with an empty slot.
--
--    active_real_jobs() is STABLE, so inside this statement it sees the
--    snapshot from before the new row: 0 active jobs => allowed => now 1.
--    An owner already running one gets 1, which is not 0, so it's refused.
--
--    KNOWN EDGE: a single multi-row INSERT could slip more than one job past
--    this, because every row sees the same pre-statement count. The app only
--    ever inserts one job at a time (OwnerDashboard + assistant create_job), so
--    this is theoretical — but if bulk job import is ever built, gate it there
--    too rather than assuming this policy caught it.
-- ------------------------------------------------------------
drop policy if exists "projects_require_access_insert" on public.projects;
create policy "projects_require_access_insert" on public.projects
  as restrictive for insert
  with check (
    public.has_app_access(auth.uid())
    or public.active_real_jobs(auth.uid()) = 0
  );

-- ------------------------------------------------------------
-- 3) UPDATE — a free owner may fully edit their one job, and may ALWAYS
--    finish a job no matter how many they have.
--
--    USING is deliberately `true` here: the pre-existing owner-only policy
--    already restricts these rows to their owner, and this restrictive policy
--    does its real work in WITH CHECK, against the resulting row. Gating in
--    USING instead would deadlock the case below.
--
--    THE DEADLOCK THIS AVOIDS: an owner whose subscription lapses while three
--    jobs are open has 3 > 1, so edits are refused — including the edit that
--    marks a job finished. He could never get himself down to the free tier and
--    would sit permanently locked out of his own data with no way forward.
--    `stage = 'end'` is the escape hatch: **finishing a job is always allowed.**
--    It only ever de-escalates, so it can't be used to sneak edits in.
-- ------------------------------------------------------------
drop policy if exists "projects_require_access_update" on public.projects;
create policy "projects_require_access_update" on public.projects
  as restrictive for update
  using (true)
  with check (
    public.has_app_access(auth.uid())
    or public.active_real_jobs(auth.uid()) <= 1
    or stage = 'end'
  );

-- ------------------------------------------------------------
-- 4) Read it back the way the client needs it, in one round trip.
--    Returns what the UI has to render: are they paid, how many jobs are
--    running, and can they start another right now.
-- ------------------------------------------------------------
create or replace function public.my_plan_status()
returns table (
  paid boolean,
  active_jobs integer,
  free_slots integer,
  can_start_job boolean
)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select
    public.has_app_access(auth.uid())                            as paid,
    public.active_real_jobs(auth.uid())                          as active_jobs,
    1                                                            as free_slots,
    public.has_app_access(auth.uid())
      or public.active_real_jobs(auth.uid()) = 0                 as can_start_job;
$$;

revoke all on function public.my_plan_status() from public;
grant execute on function public.my_plan_status() to authenticated;

-- ============================================================
-- VERIFY AFTER RUNNING (paste into the Supabase SQL editor):
--
--   select * from public.my_plan_status();
--
--   -- policies are in place and restrictive:
--   select polname, polcmd, polpermissive
--   from pg_policy
--   where polrelid = 'public.projects'::regclass
--     and polname like 'projects_require_access%';
--
-- THEN TEST WITH A REAL NON-SUBSCRIBED ACCOUNT, in this order:
--   1. 0 jobs  -> create one          => succeeds
--   2. 1 job   -> edit it             => succeeds
--   3. 1 job   -> create a second     => REFUSED  (this is the whole feature)
--   4. mark job 1 finished            => succeeds
--   5. create a second                => succeeds
--   6. a lapsed owner with 3 open     => edits refused, finishing allowed
-- ============================================================


-- ============================================================
-- PART 2 - ONE-TAP CREW JOIN (FIX-DATABASE-31, verbatim)
-- ============================================================

-- ============================================================
-- FIX-DATABASE-31 — one-tap crew join
-- ============================================================
-- Additive and idempotent. Safe to run before or after the deploy; the
-- app degrades to the old email+password invite flow without it.
--
-- WHY
-- The worker invite used to hand a crew member a signup form: name, email,
-- a password he had to invent, and — with email confirmation on — an inbox
-- round trip before he could sign in for the first time. Crews don't finish
-- that, and Josh's didn't. api/join-invite.js replaces the whole thing with
-- one tap: the invite row already holds the name and the pay rate the owner
-- typed, so the server builds the account and hands the browser a session.
--
-- WHAT THAT CHANGES ABOUT THIS TABLE
-- Those accounts have no password and no reachable email, so "reset your
-- password" is not a recovery path for them. The invite LINK is the
-- credential instead — re-opening it signs the same worker back in. That is
-- the right trade for a framer with a cracked phone screen, but it means a
-- spent link is no longer harmless, so the owner needs a way to kill one.
-- That is the column below.
-- ------------------------------------------------------------

-- ---------- 1. worker_invites.revoked_at ----------
-- Set it and the link stops working in every flow: resolve-invite refuses it,
-- join-invite refuses it. Null (the default, and every existing row) means
-- "live", so nothing in the wild changes behaviour when this runs.
alter table public.worker_invites
  add column if not exists revoked_at timestamptz;

comment on column public.worker_invites.revoked_at is
  'Set when the owner kills this invite link. Because a claimed link doubles as the passwordless worker''s way back in, revoking is the only way to cut off a lost phone.';

-- The owner's Workers tab lists live invites and resolves "who has this link
-- already joined", both of which filter on these.
create index if not exists worker_invites_used_by_idx
  on public.worker_invites(used_by);
create index if not exists worker_invites_owner_created_idx
  on public.worker_invites(owner_id, created_at desc);

-- ---------- 2. Nothing else ----------
-- No RLS change is needed. The owner policy from FIX-DATABASE-11
-- ("owner_manages_invites", for all, owner_id = auth.uid()) already covers
-- writing revoked_at, and the worker still never touches this table directly —
-- resolve-invite and join-invite read it with the service-role key on behalf
-- of someone who has no session yet, which is the whole reason they exist.

-- ---------- Sanity ----------
-- select token, worker_name, used_at is not null as claimed, revoked_at
--   from public.worker_invites order by created_at desc limit 10;


-- ============================================================
-- PART 3 - WHO ELSE IS ON MY JOB (FIX-DATABASE-32, verbatim)
-- ============================================================

-- ============================================================
-- FIX-DATABASE-32 — who else is on my job
-- ============================================================
-- Additive and idempotent. Safe to run before or after the deploy; without it
-- the crew list simply does not render and nothing else changes.
--
-- WHY
-- Josh asked for it after watching his guys use the app: a framer opens
-- JobTally, sees the job and his own hours, and still has to text somebody to
-- find out who else is showing up. The owner has always been able to see the
-- assignment list. The crew never could.
--
-- WHY IT NEEDS A VIEW AND NOT A POLICY
-- FIX-DATABASE-15 deliberately took the workers' column-wide read of
-- public.profiles away, because that table carries email and hourly_rate — a
-- crew member must never be able to read what the guy next to him earns. So
-- this exposes exactly two columns, id and full_name, and nothing else, ever.
--
-- SECURITY DEFINER (security_invoker = off) so the join to profiles works with
-- the worker's read revoked. The view is hard-scoped by auth.uid(), a value
-- straight out of the verified JWT that the caller cannot forge: a worker sees
-- crewmates ONLY on jobs he is himself assigned to. Not his boss's other jobs,
-- not another company's, not a job he was taken off.
-- ------------------------------------------------------------

create or replace view public.worker_crewmates
with (security_invoker = off) as
  select pw.project_id,
         pr.id        as worker_id,
         pr.full_name
  from public.project_workers pw
  join public.profiles pr on pr.id = pw.worker_id
  where exists (
    select 1
    from public.project_workers me
    where me.project_id = pw.project_id
      and me.worker_id = auth.uid()
  );

comment on view public.worker_crewmates is
  'Names only, of the crew assigned to jobs the CALLER is also assigned to. No email, no pay rate. Definer-scoped by auth.uid().';

grant select on public.worker_crewmates to authenticated;

-- ---------- Sanity ----------
-- Run as a worker (not the service key) — should return only their own jobs:
--   select * from public.worker_crewmates order by project_id;


-- ============================================================
-- PART 4 - THE FOUNDER ALLOW-LIST
-- ============================================================
-- FIX-DATABASE-24 seeded app_admins by email, hardcoded to
-- 'jpkobrossi@hotmail.com'. If the JobTally account is under
-- kobrossisystems@gmail.com instead, that INSERT matched nothing and silently
-- did nothing, which is why /?metrics=1 renders blank. This covers BOTH.

insert into public.app_admins (user_id)
select id
from public.profiles
where lower(email) in ('jpkobrossi@hotmail.com', 'kobrossisystems@gmail.com')
on conflict (user_id) do nothing;


-- ============================================================
-- VERIFY - run these last. All three must come back clean.
-- ============================================================

-- 1. Free tier installed: expect TWO rows.
select proname from pg_proc
where proname in ('active_real_jobs', 'my_plan_status');

-- 2. Invite revoke installed: expect ONE row.
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'worker_invites'
  and column_name = 'revoked_at';

-- 3. Crew list installed: expect ONE row.
select table_name from information_schema.views
where table_schema = 'public' and table_name = 'worker_crewmates';

-- 4. Founder allow-list: expect at least one row.
select p.email, a.created_at as admin_since
from public.app_admins a
join public.profiles p on p.id = a.user_id;
