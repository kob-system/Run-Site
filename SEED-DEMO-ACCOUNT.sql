-- SEED THE SHOOT DEMO ACCOUNT — Capital Ridge Contracting
-- Built 2026-09-04 for the 09/06 video shoot.
--
-- HOW TO RUN — either way, the whole file goes in at once:
--   • no browser:  node ~/the-sky/bin/sql.mjs SEED-DEMO-ACCOUNT.sql
--   • dashboard:   paste into the Supabase SQL editor and Run
--
-- BEFORE RUNNING, two things must already be true:
--   1. The demo owner account exists (signed up at getjobtally.com).
--   2. One worker has tapped his invite link on the second phone, so a real
--      crew profile exists. api/join-invite.js is the only thing that can make
--      one, so it cannot be faked here. Without it, the jobs and receipts still
--      land and only the hours are skipped — fix the profile, re-run the file.
--
-- EDIT EXACTLY ONE LINE: the email on the next statement. Nothing else.
-- Re-running the whole file is safe: it clears its own three jobs first, so a
-- second run does not put six jobs on the Jobs list an hour before the shoot.

select set_config('seed.owner_email', 'REPLACE_ME@example.com', false);

do $seed$
declare
  v_owner_email text := current_setting('seed.owner_email');
  v_worker_name text := 'Dave Molinari';

  v_owner   uuid;
  v_worker  uuid;
  v_deck    uuid;
  v_bath    uuid;
  v_kitchen uuid;
  d date := current_date;
  v_names text[] := array['Fielding Ave bathroom','Miller Road deck','Ontario St kitchen'];
begin
  select id into v_owner from auth.users where lower(email) = lower(v_owner_email);
  if v_owner is null then
    raise exception 'No account for %. Sign up at getjobtally.com first.', v_owner_email;
  end if;

  -- 1 ── COMP THE SUBSCRIPTION ------------------------------------------------
  -- has_app_access() returns true on status='comp' with no Stripe row and no
  -- card. This is what lets three jobs be open at once. Zero dollars.
  -- Written as exists/update/insert rather than ON CONFLICT because nothing has
  -- ever proved there is a unique constraint on subscriptions.owner_id, and a
  -- missing constraint turns ON CONFLICT into a hard error mid-shoot.
  if exists (select 1 from public.subscriptions where owner_id = v_owner) then
    update public.subscriptions
       set status = 'comp', plan = 'comp',
           current_period_end = now() + interval '10 years'
     where owner_id = v_owner;
  else
    insert into public.subscriptions (owner_id, status, plan, current_period_end)
    values (v_owner, 'comp', 'comp', now() + interval '10 years');
  end if;

  -- 2 ── CLEAR THE SAMPLE JOB, AND ANY EARLIER RUN OF THIS FILE ---------------
  -- A fresh account draws a kitchen remodel wearing an "EXAMPLE — NOT YOUR JOB"
  -- badge. It must not appear on camera. Children go first in case the foreign
  -- keys do not cascade.
  delete from public.time_entries
   where project_id in (select id from public.projects
                         where owner_id = v_owner
                           and (coalesce(is_sample,false) or name = any(v_names)));
  delete from public.project_workers
   where project_id in (select id from public.projects
                         where owner_id = v_owner
                           and (coalesce(is_sample,false) or name = any(v_names)));
  delete from public.receipts
   where project_id in (select id from public.projects
                         where owner_id = v_owner
                           and (coalesce(is_sample,false) or name = any(v_names)));
  delete from public.projects
   where owner_id = v_owner
     and (coalesce(is_sample,false) or name = any(v_names));

  -- 3 ── THE THREE JOBS -------------------------------------------------------
  -- budget = materials + labor + profit, computed the same way the app does it.

  -- 3a. FINISHED AND PROFITABLE. stage='end' so it does not count as active.
  insert into public.projects
    (owner_id, name, client_name, client_phone, client_email, client_address,
     budget, materials_budget, labor_budget, profit_target, stage, completed_at)
  values
    (v_owner, 'Fielding Ave bathroom', 'Ruth Delaney', '5185550188',
     'rdelaney.home@gmail.com', '42 Fielding Ave, Menands NY 12204',
     9400, 3200, 3600, 2600, 'end', (d - 9)::timestamptz)
  returning id into v_bath;

  -- 3b. THE HERO JOB. Everything in the video happens here.
  insert into public.projects
    (owner_id, name, client_name, client_phone, client_email, client_address,
     budget, materials_budget, labor_budget, profit_target, stage)
  values
    (v_owner, 'Miller Road deck', 'Gary Petrucci', '5185550142',
     'gpetrucci@outlook.com', '118 Miller Rd, Latham NY 12110',
     15500, 6500, 5200, 3800, 'mid')
  returning id into v_deck;

  -- 3c. BARELY STARTED, so the Jobs list looks like a business.
  insert into public.projects
    (owner_id, name, client_name, client_phone, client_email, client_address,
     budget, materials_budget, labor_budget, profit_target, stage)
  values
    (v_owner, 'Ontario St kitchen', 'Marisol Vega', '5185550171',
     'm.vega77@gmail.com', '9 Ontario St, Cohoes NY 12047',
     26500, 11000, 9500, 6000, 'start')
  returning id into v_kitchen;

  -- 4 ── RECEIPTS -------------------------------------------------------------
  -- The deck's three receipts total EXACTLY 5,330.00 against a 6,500 materials
  -- budget = 82.0%. That is what fires the amber alert, which is the single
  -- most important frame in the video. Do not change these numbers casually.
  insert into public.receipts
    (owner_id, project_id, store, description, amount, tax_amount, category, purchase_date)
  values
    (v_owner, v_deck, 'Curtis Lumber', 'PT framing, 2x8 joists, ledger stock',
       2847.19, 227.78, 'materials', d - 6),
    (v_owner, v_deck, 'The Home Depot', 'Joist hangers, structural screws, flashing tape',
       1612.44, 128.99, 'materials', d - 4),
    (v_owner, v_deck, 'Curtis Lumber', 'Railing posts, balusters, top cap',
        870.37,  69.63, 'materials', d - 2),
    -- The finished bathroom needs real costs or its Final profit is fiction.
    (v_owner, v_bath, 'Ferguson', 'Vanity, trim kit, shower valve',
       1968.40, 157.47, 'materials', d - 21),
    (v_owner, v_bath, 'The Home Depot', 'Tile, backer board, thinset, grout',
       1011.72,  80.94, 'materials', d - 17),
    -- One non-materials receipt so the "Other" card is not a zero on camera.
    (v_owner, v_deck, 'Stewart''s', 'Fuel — jobsite runs', 96.20, 0, 'fuel', d - 3);

  -- 5 ── CREW HOURS -----------------------------------------------------------
  -- A three-week deck. Puts labor at a believable fraction of budget while
  -- materials sit at 82%, so the two bars tell different stories on screen.
  select id into v_worker
    from public.profiles
   where lower(full_name) = lower(v_worker_name)
   limit 1;

  if v_worker is null then
    raise notice 'SKIPPED HOURS: no crew profile named "%". Tap the invite link on the second phone, then re-run this file.', v_worker_name;
  else
    -- Make sure he is actually ON the job. project_workers is what
    -- WorkerDashboard reads to decide what he can clock into. Assign, not
    -- schedule — schedule does not gate clock-in.
    insert into public.project_workers (project_id, worker_id)
    values (v_deck, v_worker)
    on conflict do nothing;

    -- 8-hour days, weekdays only, walking back three weeks.
    -- generate_series with an interval step returns TIMESTAMP, and Postgres has
    -- no `timestamp + time` operator — it has to be cast back to date first.
    -- The earlier version of this file failed here.
    insert into public.time_entries
      (project_id, worker_id, clocked_in_at, clocked_out_at, total_minutes)
    select
      v_deck, v_worker,
      (g.day::date + time '07:30') at time zone 'America/New_York',
      (g.day::date + time '15:30') at time zone 'America/New_York',
      480
    from generate_series((d - 19)::timestamp, (d - 1)::timestamp, interval '1 day') as g(day)
    where extract(isodow from g.day) < 6;
  end if;

  raise notice 'Seeded. owner=% deck=% bath=% kitchen=%', v_owner, v_deck, v_bath, v_kitchen;
end
$seed$;

-- ── PROVE IT FROM THE CATALOG, NOT FROM THE TOAST ────────────────────────────
-- "Success. No rows returned" is not proof. These four are. They key off the
-- job names rather than the email, so they still work if the session setting
-- did not survive the connection — there is nothing to edit down here.

-- A. Access is comped and the app agrees.
select s.status, s.plan, public.has_app_access(s.owner_id) as app_access
  from public.subscriptions s
 where s.owner_id = (select owner_id from public.projects
                      where name = 'Miller Road deck' limit 1);

-- B. Three jobs, and only two of them count against the free slot.
select p.name, p.stage, p.budget, p.materials_budget, p.labor_budget
  from public.projects p
 where p.owner_id = (select owner_id from public.projects
                      where name = 'Miller Road deck' limit 1)
 order by p.created_at;

-- C. 🔴 THE ONE THAT MATTERS: the hero job must read 82.0.
select p.name,
       p.materials_budget,
       sum(r.amount) filter (where r.category = 'materials') as materials_spent,
       round(100 * sum(r.amount) filter (where r.category = 'materials')
             / nullif(p.materials_budget,0), 1) as pct
  from public.projects p
  left join public.receipts r on r.project_id = p.id
 where p.name = 'Miller Road deck'
 group by p.name, p.materials_budget;

-- D. Hours landed and the man is assigned. The count is every weekday in the
-- last 19 days, so it lands between 13 and 15 shifts (104-120 hours) depending
-- on the day it is run. Seeded 09/04 it is 14 shifts, 112 hours.
select pr.full_name, count(*) as shifts, sum(t.total_minutes)/60.0 as hours
  from public.time_entries t
  join public.profiles pr on pr.id = t.worker_id
  join public.projects p on p.id = t.project_id
 where p.name = 'Miller Road deck'
 group by pr.full_name;
