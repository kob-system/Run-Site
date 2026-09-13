-- ============================================================
-- FIX-DATABASE-38: the free job gets every feature
-- ============================================================
-- THE PROMISE (public/pricing, src/pages/Landing.js):
--   "You get all of JobTally for one flat price, and your first job is free,
--    forever, with no card."
-- The only thing a subscription buys is a SECOND open job at the same time.
--
-- GAP 1, read from the live database 2026-09-13:
--   Fourteen RESTRICTIVE policies on seven tables still gate every save on
--   has_app_access(), which is the PAID question (comp, a live active/trialing
--   Stripe subscription, or a pre-2026-07-24 account inside its old 30 days).
--   They date from FIX-17 / FIX-23, when the app was trial-only, and FIX-30
--   (free forever, one job) never touched them:
--
--     change_orders  daily_logs  estimates  invoices
--     job_photos     material_items  punch_items        (insert + update each)
--
--   So an owner who signed up free after the cutover can create his one job
--   (FIX-30 lets him) and then cannot add an extra, a daily log, an estimate,
--   an invoice, a photo, a shopping item or a fix-it item. The app says
--   "Failed to add extra". The promise breaks on his first tap. The same wall
--   stops his crew adding a job photo (that check asked has_app_access of the
--   crew member OR the owner, and neither is paid).
--
-- GAP 2, found while proving the job gate is airtight:
--   The FIX-30 projects policies count open jobs BEFORE the write lands
--   (active_real_jobs is STABLE and sees the pre-statement snapshot). With one
--   job open, a free owner could still:
--     - reopen a finished job        (UPDATE stage 'end' -> 'mid': 1 <= 1, allowed)
--     - flip is_sample true -> false (same arithmetic; a sample job is not
--                                     counted, so this un-hides a second job)
--   and two INSERTs racing each other both see 0. The app never did the second
--   and third, but the reopen is one tap on the stage picker. Once the free job
--   can do everything, the job count is the ONLY gate, so it has to be exact.
--
-- ------------------------------------------------------------
-- WHY A NEW FUNCTION, NOT A CHANGED has_app_access():
--   has_app_access() answers "is this account paid?" and three things depend
--   on exactly that meaning:
--     - projects_require_access_insert: has_app_access(uid) OR active_real_jobs(uid) = 0
--       If free accounts returned true, this would let a free owner open
--       unlimited jobs. The job limit would vanish.
--     - my_plan_status().paid / can_start_job, which the dashboard renders.
--     - the 30-day grandfather window and the Stripe trial, unchanged here.
--   So has_app_access() stays byte-for-byte as it is, and the seven tables
--   ask a new, narrower question instead:
--
--     plan_allows_writes(uid) = has_app_access(uid) OR active_real_jobs(uid) <= 1
--
--   "Paid, or within the free plan." That is the same line FIX-30 already draws
--   for editing a job (projects_require_access_update uses <= 1), now applied
--   to everything that hangs off a job. A free owner with his one job open, or
--   none, can use every feature. An owner whose subscription lapsed with three
--   jobs open is refused until he finishes down to one (finishing is always
--   allowed), exactly as he already is on the projects table today.
--
-- WHY owner_id AND NOT auth.uid() IN THE NEW CHECKS:
--   For an owner they are the same value: every permissive policy on these
--   tables already forces owner_id = auth.uid(). For a crew member they are
--   not: a crew member owns no jobs, so plan_allows_writes(<crew id>) would be
--   vacuously true and "auth.uid() OR owner_id" would wave every crew write
--   through. owner_id asks about the account whose job it is, which is the
--   question that matters. Crew job photos still pass through the existing
--   worker_insert_job_photos policy (owner_id = crew_job_owner(project_id),
--   FIX-37), so for crew owner_id is always the boss.
--
-- WHERE THE ONE-JOB LIMIT LIVES AFTER THIS (all in the database):
--   1. projects_require_access_insert / _update   (FIX-30, UNCHANGED)
--   2. NEW trigger projects_free_job_limit, BEFORE INSERT OR UPDATE OF
--      stage, is_sample, owner_id. It counts the owner's OTHER open real jobs
--      under a per-owner advisory lock, so it cannot be raced, and it catches
--      every way a row can ENTER the open set: a new job, a reopened job, or
--      an owner change. is_sample becomes fixed at creation, and an owner can
--      hold one sample job, so the sample flag can't hide a job either.
--   Normal edits of an open job (rename, budgets, labor_spent from the time
--   entry trigger, materials_spent from receipts) never enter that branch:
--   the row was already open, so nothing new is being opened.
--   Service role / SQL editor / cron carry no auth.uid() and skip it, the same
--   way they already bypass RLS.
--
-- WHAT DOES NOT CHANGE:
--   has_app_access(), active_real_jobs(), my_plan_status(), both projects
--   policies, every permissive policy, FIX-37's crew lockdown, receipts and
--   time_entries (never gated), the Stripe checkout, trial and webhook path.
--
-- CHECKED BEFORE WRITING (live, 2026-09-13): unpaid owners with more than one
-- open real job = 0. Nobody is pushed over the line by this.
--
-- ROLLOUT: run this FIRST (or with the merge). The matching app change only
-- adds a plain-English message before a refused reopen; it is safe to ship
-- before or after, but the free job stays broken until this runs.
--
-- Transactional: all of it lands or none of it does. Idempotent: every
-- function is create-or-replace, every policy and the trigger drop-if-exists.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 0. Refuse to run on a database FIX-30 never reached. Without
--    active_real_jobs() the new function would not even compile, but a clear
--    message beats a confusing one.
-- ------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.has_app_access(uuid)') is null
     or to_regprocedure('public.active_real_jobs(uuid)') is null then
    raise exception 'FIX-DATABASE-38 needs FIX-DATABASE-30 first (has_app_access / active_real_jobs missing)';
  end if;
end $$;

-- ------------------------------------------------------------
-- 1. "Paid, or within the free plan."
--    The 1 is FREE_ACTIVE_JOBS in src/utils/trialWindow.js. Keep in lockstep.
--    uid null => false: has_app_access(null) is false but active_real_jobs(null)
--    is 0, so without the guard a null owner_id would read as "within plan".
-- ------------------------------------------------------------
create or replace function public.plan_allows_writes(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select uid is not null
     and (public.has_app_access(uid) or public.active_real_jobs(uid) <= 1);
$$;

revoke all on function public.plan_allows_writes(uuid) from public, anon;
grant execute on function public.plan_allows_writes(uuid) to authenticated, service_role;

-- ------------------------------------------------------------
-- 2. The seven tables ask the new question. Same policy names, same
--    RESTRICTIVE shape, same insert/update split as the live ones; only the
--    expression changes (see the ROLLBACK block for the exact old text).
-- ------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'change_orders', 'daily_logs', 'estimates', 'invoices',
    'job_photos', 'material_items', 'punch_items'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_require_access_insert', t);
    execute format(
      'create policy %I on public.%I as restrictive for insert '
      || 'with check (public.plan_allows_writes(owner_id))',
      t || '_require_access_insert', t);

    execute format('drop policy if exists %I on public.%I', t || '_require_access_update', t);
    execute format(
      'create policy %I on public.%I as restrictive for update '
      || 'using (public.plan_allows_writes(owner_id)) '
      || 'with check (public.plan_allows_writes(owner_id))',
      t || '_require_access_update', t);
  end loop;
end $$;

-- ------------------------------------------------------------
-- 3. The one-open-job limit, counted AFTER the write instead of before it.
--
--    SECURITY DEFINER so the count sees every one of the owner's jobs no
--    matter whose session fired it. plpgsql is VOLATILE, so under READ
--    COMMITTED the count takes a fresh snapshot after the lock is granted and
--    sees a racing insert that just committed.
--
--    errcode 42501 is the same code an RLS refusal returns, so every caller
--    that already handles "blocked" handles this the same way.
-- ------------------------------------------------------------
create or replace function public.enforce_free_job_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_open integer;
begin
  -- Trusted server paths (service role, SQL editor, cron) have no user and
  -- already bypass RLS. Only a signed-in user's write is counted.
  if auth.uid() is null then
    return new;
  end if;

  -- is_sample is set once, when the app seeds the demo job, and never again.
  -- Flipping it is the one move that hides a job from the count or un-hides
  -- one into it, so a user may not flip it at all. Nothing in the app does.
  if tg_op = 'UPDATE' and new.is_sample is distinct from old.is_sample then
    raise exception using
      errcode = '42501',
      message = 'A job cannot be switched to or from the sample job.',
      hint    = 'free_job_limit';
  end if;

  -- The sample job. One per owner (seedSampleJob only ever makes one, and
  -- only for an account with no jobs), so extra "samples" can't be used as
  -- uncounted real jobs.
  if coalesce(new.is_sample, false) then
    if tg_op = 'INSERT' then
      perform pg_advisory_xact_lock(hashtextextended('jobtally_free_job:' || coalesce(new.owner_id::text, ''), 0));
      if exists (
        select 1 from public.projects p
        where p.owner_id = new.owner_id
          and coalesce(p.is_sample, false)
          and p.id is distinct from new.id
      ) then
        raise exception using
          errcode = '42501',
          message = 'This account already has the sample job.',
          hint    = 'free_job_limit';
      end if;
    end if;
    return new;
  end if;

  -- Finishing a job is always allowed. It only ever frees the slot.
  if coalesce(new.stage, 'start') = 'end' then
    return new;
  end if;

  -- Already an open real job before this write, same owner: this is an edit
  -- (name, budgets, spent columns), not a job being opened. Not counted.
  if tg_op = 'UPDATE'
     and coalesce(old.stage, 'start') <> 'end'
     and old.owner_id is not distinct from new.owner_id then
    return new;
  end if;

  -- A job is being OPENED: a new one, a reopened one, or one moving owner.
  -- Paid accounts open as many as they like.
  if public.has_app_access(new.owner_id) then
    return new;
  end if;

  -- Serialize this owner's job-opening writes so two at once can't both see 0.
  perform pg_advisory_xact_lock(hashtextextended('jobtally_free_job:' || coalesce(new.owner_id::text, ''), 0));

  select count(*)::int into v_open
  from public.projects p
  where p.owner_id = new.owner_id
    and p.id is distinct from new.id
    and coalesce(p.is_sample, false) = false
    and coalesce(p.stage, 'start') <> 'end';

  -- 1 = FREE_ACTIVE_JOBS (src/utils/trialWindow.js).
  if v_open >= 1 then
    raise exception using
      errcode = '42501',
      message = 'Free plan: one open job at a time. Finish your open job to start or reopen another, or subscribe to run more.',
      hint    = 'free_job_limit';
  end if;

  return new;
end;
$$;

drop trigger if exists projects_free_job_limit on public.projects;
create trigger projects_free_job_limit
  before insert or update of stage, is_sample, owner_id on public.projects
  for each row execute function public.enforce_free_job_limit();

commit;

-- ============================================================
-- VERIFY (read-only). Paste into the Supabase SQL editor after it runs.
-- ============================================================
--
-- 1. Every child-table gate now asks plan_allows_writes(owner_id); none asks
--    has_app_access. Expect 14 rows on the seven tables with the new text,
--    plus the two projects rows UNCHANGED from FIX-30.
--
--   select c.relname, pol.polname, pol.polpermissive,
--          pg_get_expr(pol.polqual, pol.polrelid)      as using_expr,
--          pg_get_expr(pol.polwithcheck, pol.polrelid) as check_expr
--   from pg_policy pol
--   join pg_class c on c.oid = pol.polrelid
--   where c.relnamespace = 'public'::regnamespace
--     and pol.polname like '%\_require\_access\_%'
--   order by 1, 2;
--
-- 2. The trigger is there and enabled. Expect 1 row, tgenabled = 'O'.
--
--   select tgname, tgenabled, pg_get_triggerdef(oid)
--   from pg_trigger
--   where tgrelid = 'public.projects'::regclass
--     and tgname = 'projects_free_job_limit';
--
-- 3. Every owner, the way the database sees them. Expect every unpaid owner
--    with 0 or 1 open jobs to read can_write = true.
--
--   select pr.id, pr.created_at::date,
--          public.has_app_access(pr.id)     as paid,
--          public.active_real_jobs(pr.id)   as open_jobs,
--          public.plan_allows_writes(pr.id) as can_write
--   from public.profiles pr
--   where pr.role = 'owner'
--   order by pr.created_at desc;
--
-- 4. From outside, no login (30 seconds): POST {SUPABASE_URL}/rest/v1/rpc/plan_allows_writes
--    with the anon key and body {"uid":null}.
--      before this runs:  404 PGRST202 (function missing)
--      after:             401/403 permission denied (function exists, anon revoked)
--
-- ============================================================
-- BEHAVIOUR TEST (writes, but every block ROLLS BACK). Optional, and the
-- real proof is still JP on a phone with a free account. Replace
-- <FREE_OWNER> with an unpaid owner that has exactly one open real job and
-- <HIS_OPEN_JOB> / <HIS_FINISHED_JOB> with his project ids.
-- Run each block on its own; a refused statement aborts its block.
-- ============================================================
--
--   -- a) An extra on his one job: must SUCCEED (this is the bug being fixed).
--   begin;
--     select set_config('request.jwt.claims',
--       json_build_object('sub', '<FREE_OWNER>', 'role', 'authenticated')::text, true);
--     set local role authenticated;
--     insert into public.material_items (owner_id, project_id, name, qty)
--     values ('<FREE_OWNER>', '<HIS_OPEN_JOB>', 'fix-38 test', 1);
--   rollback;
--
--   -- b) A second job while one is open: must FAIL, "Free plan: one open job".
--   begin;
--     select set_config('request.jwt.claims',
--       json_build_object('sub', '<FREE_OWNER>', 'role', 'authenticated')::text, true);
--     set local role authenticated;
--     insert into public.projects (owner_id, name, stage)
--     values ('<FREE_OWNER>', 'fix-38 second job', 'start');
--   rollback;
--
--   -- c) Reopening a finished job while one is open: must FAIL (was the hole).
--   begin;
--     select set_config('request.jwt.claims',
--       json_build_object('sub', '<FREE_OWNER>', 'role', 'authenticated')::text, true);
--     set local role authenticated;
--     update public.projects set stage = 'mid', completed_at = null
--     where id = '<HIS_FINISHED_JOB>';
--   rollback;
--
--   -- d) Finishing his open job: must SUCCEED.
--   begin;
--     select set_config('request.jwt.claims',
--       json_build_object('sub', '<FREE_OWNER>', 'role', 'authenticated')::text, true);
--     set local role authenticated;
--     update public.projects set stage = 'end', completed_at = now()
--     where id = '<HIS_OPEN_JOB>';
--   rollback;
--
-- ============================================================
-- ROLLBACK: restores the exact live definitions read 2026-09-13.
-- Policies go back first, because they reference plan_allows_writes.
-- ============================================================
--
-- begin;
--
-- drop trigger if exists projects_free_job_limit on public.projects;
-- drop function if exists public.enforce_free_job_limit();
--
-- do $$
-- declare
--   t text;
-- begin
--   foreach t in array array[
--     'change_orders', 'daily_logs', 'estimates', 'invoices',
--     'material_items', 'punch_items'
--   ] loop
--     execute format('drop policy if exists %I on public.%I', t || '_require_access_insert', t);
--     execute format(
--       'create policy %I on public.%I as restrictive for insert '
--       || 'with check (has_app_access(auth.uid()))',
--       t || '_require_access_insert', t);
--     execute format('drop policy if exists %I on public.%I', t || '_require_access_update', t);
--     execute format(
--       'create policy %I on public.%I as restrictive for update '
--       || 'using (has_app_access(auth.uid())) '
--       || 'with check (has_app_access(auth.uid()))',
--       t || '_require_access_update', t);
--   end loop;
-- end $$;
--
-- -- job_photos was different on insert (FIX-23: crew OR owner).
-- drop policy if exists job_photos_require_access_insert on public.job_photos;
-- create policy job_photos_require_access_insert on public.job_photos
--   as restrictive for insert
--   with check (has_app_access(auth.uid()) or has_app_access(owner_id));
-- drop policy if exists job_photos_require_access_update on public.job_photos;
-- create policy job_photos_require_access_update on public.job_photos
--   as restrictive for update
--   using (has_app_access(auth.uid()))
--   with check (has_app_access(auth.uid()));
--
-- drop function if exists public.plan_allows_writes(uuid);
--
-- commit;
-- ============================================================
