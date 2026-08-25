-- ============================================================
-- RUN THIS ONCE, IN THE SUPABASE SQL EDITOR
-- ============================================================
-- Built 2026-08-24. Two separate problems, one paste. Safe to re-run.
--
--   PART 1 — unbreak the free tier. FIX-DATABASE-30 was never run, so a new
--            signup CANNOT create a job while the pricing page promises
--            "one job free, forever". Every visitor the flyers, the demo and
--            the SEO pages send has been converting to nothing.
--
--   PART 2 — put your account on the founder allow-list, so /?metrics=1
--            renders and Sal can read it every Sunday.
--
-- HOW TO RUN IT:
--   supabase.com  →  the JobTally project  →  SQL Editor  →  New query
--   →  paste this whole file  →  Run.
--
-- Nothing here deletes anything. Both parts are idempotent.
-- ============================================================


-- ============================================================
-- PART 0 — LOOK FIRST. Run this by itself if you want to see the state
--          before changing anything. It writes nothing.
-- ============================================================

-- Which of your two emails actually has an account?
select id, email, created_at
from public.profiles
where lower(email) in ('jpkobrossi@hotmail.com', 'kobrossisystems@gmail.com');

-- Is anyone on the founder allow-list right now?
select count(*) as admins_currently_seeded from public.app_admins;

-- Does the free-tier function exist yet? Zero rows here = FIX-DATABASE-30
-- has never been run, which is the bug.
select proname
from pg_proc
where proname in ('active_real_jobs', 'can_open_new_project');


-- ============================================================
-- PART 1 — THE FREE TIER
-- ============================================================
-- Do NOT retype this. Open the real file and paste its contents here:
--
--     C:\Users\Jpkob\Desktop\run-site\FIX-DATABASE-30-free-tier.sql
--
-- It is 149 lines and it is the authoritative version. Copying it by hand
-- into this file would create a second copy that drifts from the original,
-- which is a mistake this project has already made once, with a rendered PDF
-- that drifted from its source.
--
-- After it runs, verify from anywhere with no login at all:
--
--   the RPC  active_real_jobs  must STOP returning 404 PGRST202.
--
-- While it still 404s, the free tier is broken no matter what the site says.
-- ============================================================


-- ============================================================
-- PART 2 — THE FOUNDER ALLOW-LIST
-- ============================================================
-- FIX-DATABASE-24 seeded app_admins by email, hardcoded to
-- 'jpkobrossi@hotmail.com' (line ~215). If you signed up for JobTally with
-- kobrossisystems@gmail.com instead, that INSERT matched nothing and silently
-- did nothing — which is exactly why /?metrics=1 renders blank.
--
-- This covers BOTH addresses. Whichever one actually has a profile gets added;
-- the other simply matches nothing. Re-running is harmless.

insert into public.app_admins (user_id)
select id
from public.profiles
where lower(email) in ('jpkobrossi@hotmail.com', 'kobrossisystems@gmail.com')
on conflict (user_id) do nothing;

-- Confirm it worked. You want at least one row back.
select p.email, a.created_at as admin_since
from public.app_admins a
join public.profiles p on p.id = a.user_id;


-- ============================================================
-- AFTER YOU RUN IT
-- ============================================================
-- 1. Sign in at https://www.getjobtally.com/login with the account that came
--    back above, in the WORK Chrome window (Profile 1 — the blue one).
--    Tick "stay signed in" if it is offered.
--
-- 2. Open  https://www.getjobtally.com/?metrics=1
--    You should now see subs_active, subs_trialing, subs_past_due,
--    subs_canceled, owners_total, owners_with_job, owners_with_receipt.
--
--    That is the first time anyone will have looked at whether JobTally has
--    a single paying customer.
--
-- 3. Leave that Chrome profile signed in. Sal reads that page every Sunday at
--    15:05 and never needs the password again.
--
-- 4. If subs_active is above zero, check the referral position in the private
--    brain (work/ks-digital/LEDGER.md). There is a partner arrangement that
--    may already be owed money, and its paperwork is still unsent.
-- ============================================================
