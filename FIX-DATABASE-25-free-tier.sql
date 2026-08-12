-- ============================================================
-- FIX-DATABASE-25 — FREE FOREVER, ONE ACTIVE JOB
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
