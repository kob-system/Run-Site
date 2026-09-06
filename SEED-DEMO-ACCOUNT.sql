-- SEED THE SHOOT DEMO ACCOUNT — Capital Ridge Contracting
-- v2, rewritten 2026-09-06 to cover the whole walkthrough, not just the money.
--
-- HOW TO RUN — the whole file goes in at once:
--   • no browser:  node ~/the-sky/bin/sql.mjs SEED-DEMO-ACCOUNT.sql
--   • dashboard:   paste into the Supabase SQL editor and Run
--
-- BEFORE RUNNING, two things must already be true:
--   1. The demo owner account exists.
--   2. Both crew profiles exist — 'Dave Molinari' and 'Luis Ferrara'. They can
--      ONLY be made by api/join-invite.js (it creates the auth user, the
--      profile and the pay rate server-side), so they cannot be faked here.
--      Missing a worker does not break the file: the jobs, receipts, mileage
--      and lists still land, and only that man's hours, shifts and chat lines
--      are skipped with a notice. Fix the profile, re-run the file.
--
-- EDIT THE TWO set_config LINES BELOW AND NOTHING ELSE.
-- Re-running is safe — it clears everything it made first, so a second run an
-- hour before the shoot does not put six jobs on the Jobs list.
--
-- ⚠️ THE NUMBERS ARE LOAD-BEARING. receipts.amount is the PRE-TAX subtotal and
-- the app books cost = amount + tax_amount (OwnerDashboard fetchSpend), so the
-- receipts below are balanced backwards from the two percentages that have to
-- appear on camera. getBudgetClass warns at 80% and goes red at 100%:
--     Miller Road deck   materials  5,330.00 / 6,500 = 82.0%  amber
--     Fielding Ave bath  materials  2,979.20 / 3,200 = 93.1%  amber
--     Miller Road deck   labor      3,968.00 / 5,200 = 76.3%  green
-- One amber bar next to one green bar is the frame the whole video is built on.
-- Change a receipt and you change the bar.

-- WHO to seed. Put EITHER the owner's sign-in email OR the owner's profile id
-- here — the block below takes a uuid or an address. The id route exists
-- because reading auth.users is not always possible and profiles.id is the
-- same value.
select set_config('seed.owner', 'REPLACE_ME@example.com', false);

-- 'yes' deletes EVERY other job on that account first, so the Jobs list on
-- camera is exactly the three below. 'no' leaves the account's existing jobs
-- sitting alongside them.
select set_config('seed.wipe_other_jobs', 'no', false);

do $seed$
declare
  v_target text    := current_setting('seed.owner');
  v_wipe   boolean := lower(coalesce(current_setting('seed.wipe_other_jobs', true), 'no')) in ('yes','true','y');
  -- The photos are served from our OWN origin on purpose: vercel.json sets
  -- img-src 'self' data: blob: https://*.supabase.co, so a receipt hotlinked
  -- from anywhere else is a broken image on camera. PhotoViewer uses a full
  -- URL directly and only signs a storage path when it is not one.
  v_img text := 'https://runsite-pearl.vercel.app/demo/receipts/';

  v_owner   uuid;
  v_dave    uuid;
  v_luis    uuid;
  v_deck    uuid;
  v_bath    uuid;
  v_kitchen uuid;
  d date := current_date;
  v_names text[] := array['Fielding Ave bathroom','Miller Road deck','Ontario St kitchen'];
  v_jobs  uuid[];
begin
  -- A uuid is read as a profile id, anything else as a sign-in address.
  -- profiles.id IS the auth user id, so the uuid route never touches the auth
  -- schema. owner_id is null is what distinguishes an owner from a crew member.
  if v_target ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select id into v_owner from public.profiles
     where id = v_target::uuid and owner_id is null;
  else
    select id into v_owner from auth.users where lower(email) = lower(v_target);
  end if;
  if v_owner is null then
    raise exception 'No owner account matches %. Pass a sign-in email or a profiles.id.', v_target;
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
  select array_agg(id) into v_jobs
    from public.projects
   where owner_id = v_owner
     and (v_wipe or coalesce(is_sample,false) or name = any(v_names));

  if v_jobs is not null then
    delete from public.time_entries     where project_id = any(v_jobs);
    delete from public.project_workers  where project_id = any(v_jobs);
    delete from public.receipts         where project_id = any(v_jobs);
    delete from public.schedule_entries where project_id = any(v_jobs);
    delete from public.mileage_entries  where project_id = any(v_jobs);
    delete from public.punch_items      where project_id = any(v_jobs);
    delete from public.material_items   where project_id = any(v_jobs);
    delete from public.job_messages     where project_id = any(v_jobs);
    delete from public.invoices         where project_id = any(v_jobs);
    delete from public.job_photos       where project_id = any(v_jobs);
    delete from public.projects         where id         = any(v_jobs);
  end if;

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

  -- 4 ── RECEIPTS, EACH WITH A PHOTO ------------------------------------------
  -- amount = the PRE-TAX subtotal printed on the photo. Do not paste a grand
  -- total in here alongside the tax: fetchSpend adds them and the job gets
  -- charged its sales tax twice, which is exactly what v1 of this file did.
  insert into public.receipts
    (owner_id, project_id, store, description, amount, tax_amount, category, purchase_date, photo_url)
  values
    (v_owner, v_deck, 'Curtis Lumber', 'PT framing, 2x8 joists, ledger stock',
       2637.87, 211.03, 'materials', d - 6, v_img || 'curtis-lumber-framing.svg'),
    (v_owner, v_deck, 'The Home Depot', 'Joist hangers, structural screws, flashing tape',
       1494.32, 119.55, 'materials', d - 4, v_img || 'home-depot-hardware.svg'),
    (v_owner, v_deck, 'Curtis Lumber', 'Railing posts, balusters, top cap',
        803.00,  64.23, 'materials', d - 2, v_img || 'curtis-lumber-railing.svg'),
    -- The finished bathroom needs real costs or its Final profit is fiction.
    (v_owner, v_bath, 'Ferguson', 'Vanity, trim kit, shower valve',
       1847.00, 147.76, 'materials', d - 21, v_img || 'ferguson-vanity.svg'),
    (v_owner, v_bath, 'The Home Depot', 'Tile, backer board, thinset, grout',
        911.52,  72.92, 'materials', d - 17, v_img || 'home-depot-tile.svg'),
    -- One non-materials receipt so the "Other" card is not a zero on camera.
    (v_owner, v_deck, 'Stewart''s', 'Fuel — jobsite runs',
         96.20,   0.00, 'fuel',      d - 3,  v_img || 'stewarts-fuel.svg');

  -- 5 ── MILEAGE --------------------------------------------------------------
  -- Two trucks, named in the notes, because "0.70/mi" on its own means nothing
  -- to a contractor and "F-250 — shop to Miller Rd" is his own sentence back at
  -- him. 0.70 is the current IRS business rate.
  insert into public.mileage_entries (owner_id, project_id, trip_date, miles, rate, notes)
  values
    (v_owner, v_deck,    d - 6, 22.4, 0.70, 'F-250 — shop to Curtis Lumber to Miller Rd'),
    (v_owner, v_deck,    d - 4, 18.1, 0.70, 'F-250 — shop to Miller Rd'),
    (v_owner, v_deck,    d - 3, 31.6, 0.70, 'F-250 — Miller Rd, dump run, back to shop'),
    (v_owner, v_deck,    d - 2, 18.1, 0.70, 'F-250 — shop to Miller Rd'),
    (v_owner, v_deck,    d - 1, 18.1, 0.70, 'Silverado — Luis, shop to Miller Rd'),
    (v_owner, v_bath,   d - 24, 11.9, 0.70, 'F-250 — shop to Fielding Ave'),
    (v_owner, v_bath,   d - 21, 26.3, 0.70, 'F-250 — Ferguson pickup to Fielding Ave'),
    (v_owner, v_kitchen, d - 5, 24.8, 0.70, 'F-250 — walkthrough at Ontario St');

  -- 6 ── THE TWO LISTS THE OWNER LEAVES THE CREW ------------------------------
  -- These are what the crew opens on their own phones (worker_material_items /
  -- worker_punch_items). Some already ticked, so the screen shows progress
  -- rather than a wall of empty boxes.
  insert into public.material_items (owner_id, project_id, name, qty, bought)
  values
    (v_owner, v_deck, 'Joist hanger nails (1-1/2")', '2 boxes', true),
    (v_owner, v_deck, 'Deck screws — 2-1/2" tan',    '5 lb',    true),
    (v_owner, v_deck, 'Post caps — black',           '11',      false),
    (v_owner, v_deck, 'Stain — semi-transparent cedar', '4 gal', false),
    (v_owner, v_deck, 'Construction adhesive',       '6 tubes', false);

  insert into public.punch_items (owner_id, project_id, description, done)
  values
    (v_owner, v_deck, 'Shim the third stair stringer — it rocks',      true),
    (v_owner, v_deck, 'Flash the ledger before the decking goes down', true),
    (v_owner, v_deck, 'Two balusters short on the north run',          false),
    (v_owner, v_deck, 'Gate hardware not installed yet',               false),
    (v_owner, v_deck, 'Haul the offcut pile — Gary asked twice',       false);

  -- 7 ── MONEY: WHAT CAME IN AND WHAT IS STILL OWED ---------------------------
  -- The Money screen is a blank page without these. Three collected, one
  -- sitting unpaid past its date, which is the only line an owner reacts to.
  insert into public.invoices (owner_id, project_id, label, amount, issued_date, due_date, status, paid_at)
  values
    (v_owner, v_bath, 'Fielding Ave bathroom — deposit', 4700, d - 34, d - 27, 'paid',   (d - 32)::timestamptz),
    (v_owner, v_bath, 'Fielding Ave bathroom — final',   4700, d - 12, d - 2,  'paid',   (d - 4)::timestamptz),
    (v_owner, v_deck, 'Miller Road deck — deposit',      7750, d - 20, d - 13, 'paid',   (d - 16)::timestamptz),
    (v_owner, v_deck, 'Miller Road deck — progress #2',  3875, d - 8,  d - 1,  'unpaid', null);

  -- 8 ── THE CREW -------------------------------------------------------------
  select id into v_dave from public.profiles where lower(full_name) = 'dave molinari' limit 1;
  select id into v_luis from public.profiles where lower(full_name) = 'luis ferrara'  limit 1;

  if v_dave is null then
    raise notice 'SKIPPED Dave Molinari — no crew profile. Run api/join-invite.js for him, then re-run this file.';
  end if;
  if v_luis is null then
    raise notice 'SKIPPED Luis Ferrara — no crew profile. Run api/join-invite.js for him, then re-run this file.';
  end if;

  -- project_workers is what WorkerDashboard reads to decide what a man can
  -- clock into. Assign, not schedule — a schedule row does not gate clock-in.
  if v_dave is not null then
    insert into public.project_workers (project_id, worker_id)
    values (v_deck, v_dave), (v_bath, v_dave), (v_kitchen, v_dave)
    on conflict do nothing;
  end if;
  if v_luis is not null then
    insert into public.project_workers (project_id, worker_id)
    values (v_deck, v_luis)
    on conflict do nothing;
  end if;

  -- 8a. HOURS ALREADY WORKED --------------------------------------------------
  -- ⚠️ trg_compute_time_entry_pay IS INSTALLED here — read out of pg_proc on
  -- 2026-09-06, not assumed from the repo. It OVERWRITES whatever labor_cost is
  -- inserted with (minutes / 60) * profiles.hourly_rate, so the RATE is what
  -- actually decides the labor bar. Pin both rates first: the invite may have
  -- set them and may not have. labor_cost is still written below so the numbers
  -- are also right on a database where that trigger is missing.
  update public.profiles set hourly_rate = 28.00 where id = v_dave;
  update public.profiles set hourly_rate = 26.00 where id = v_luis;
  --
  -- generate_series with an interval step returns TIMESTAMP, and Postgres has
  -- no `timestamp + time` operator, so it has to be cast back to date first.
  -- An earlier version of this file failed exactly here.
  if v_dave is not null then
    -- Three weeks on the deck: 14 weekdays x 8h x $28 = $3,136.
    insert into public.time_entries
      (project_id, worker_id, clocked_in_at, clocked_out_at, total_minutes, labor_cost)
    select v_deck, v_dave,
           (g.day::date + time '07:30') at time zone 'America/New_York',
           (g.day::date + time '15:30') at time zone 'America/New_York',
           480, 224.00
      from generate_series((d - 19)::timestamp, (d - 1)::timestamp, interval '1 day') as g(day)
     where extract(isodow from g.day) < 6;

    -- The bathroom, finished and billed. An earlier window so the two jobs
    -- never put the same man on two sites on the same day.
    insert into public.time_entries
      (project_id, worker_id, clocked_in_at, clocked_out_at, total_minutes, labor_cost)
    select v_bath, v_dave,
           (g.day::date + time '07:30') at time zone 'America/New_York',
           (g.day::date + time '15:30') at time zone 'America/New_York',
           480, 224.00
      from generate_series((d - 34)::timestamp, (d - 20)::timestamp, interval '1 day') as g(day)
     where extract(isodow from g.day) < 6;
  end if;

  if v_luis is not null then
    -- On the deck the last four weekdays only: 4 x 8h x $26 = $832.
    insert into public.time_entries
      (project_id, worker_id, clocked_in_at, clocked_out_at, total_minutes, labor_cost)
    select v_deck, v_luis,
           (g.day::date + time '07:45') at time zone 'America/New_York',
           (g.day::date + time '15:45') at time zone 'America/New_York',
           480, 208.00
      from generate_series((d - 6)::timestamp, (d - 1)::timestamp, interval '1 day') as g(day)
     where extract(isodow from g.day) < 6;
  end if;

  -- 8b. ON THE CLOCK RIGHT NOW ------------------------------------------------
  -- The single best frame in the video: Home and Crew both count open shifts,
  -- and an open shift is one with clocked_out_at IS NULL. fetchSpend filters
  -- these out, so they cost the job nothing and cannot move a budget bar.
  --
  -- least() is what keeps this honest whatever time he presses record: normally
  -- it lands on this morning's real start time, and if he shoots before that
  -- has happened yet it falls back to a few minutes ago rather than showing a
  -- man who clocked in in the future.
  if v_dave is not null then
    insert into public.time_entries (project_id, worker_id, clocked_in_at)
    values (v_deck, v_dave,
            least((d + time '07:12') at time zone 'America/New_York', now() - interval '25 minutes'));
  end if;
  if v_luis is not null then
    insert into public.time_entries (project_id, worker_id, clocked_in_at)
    values (v_deck, v_luis,
            least((d + time '07:31') at time zone 'America/New_York', now() - interval '12 minutes'));
  end if;

  -- 8c. THE SCHEDULE ----------------------------------------------------------
  -- Seven days back and ten forward, so the week strip is populated whichever
  -- week the Crew screen happens to open on — Sunday sits at a different end of
  -- the week depending on where weekStartKey lands, and an empty strip on
  -- camera is worse than a busy one.
  if v_dave is not null then
    insert into public.schedule_entries
      (owner_id, worker_id, project_id, task_description, scheduled_date, start_time, end_time)
    select v_owner, v_dave, v_deck, 'Railing + stairs', g.day::date, time '07:30', time '15:30'
      from generate_series((d - 7)::timestamp, (d + 4)::timestamp, interval '1 day') as g(day)
     where extract(isodow from g.day) < 6;

    insert into public.schedule_entries
      (owner_id, worker_id, project_id, task_description, scheduled_date, start_time, end_time)
    select v_owner, v_dave, v_kitchen, 'Demo + haul out', g.day::date, time '07:30', time '15:30'
      from generate_series((d + 5)::timestamp, (d + 10)::timestamp, interval '1 day') as g(day)
     where extract(isodow from g.day) < 6;
  end if;

  if v_luis is not null then
    insert into public.schedule_entries
      (owner_id, worker_id, project_id, task_description, scheduled_date, start_time, end_time)
    select v_owner, v_luis, v_deck, 'Decking + stain prep', g.day::date, time '07:45', time '15:45'
      from generate_series((d - 4)::timestamp, (d + 6)::timestamp, interval '1 day') as g(day)
     where extract(isodow from g.day) < 6;
  end if;

  -- Today gets a shift no matter what weekday it is, so "who is on today"
  -- answers on camera even on a Sunday shoot.
  if v_dave is not null then
    insert into public.schedule_entries
      (owner_id, worker_id, project_id, task_description, scheduled_date, start_time, end_time)
    select v_owner, v_dave, v_deck, 'Railing + stairs', d, time '07:00', time '13:00'
     where not exists (select 1 from public.schedule_entries
                        where worker_id = v_dave and scheduled_date = d);
  end if;
  if v_luis is not null then
    insert into public.schedule_entries
      (owner_id, worker_id, project_id, task_description, scheduled_date, start_time, end_time)
    select v_owner, v_luis, v_deck, 'Decking + stain prep', d, time '07:30', time '13:00'
     where not exists (select 1 from public.schedule_entries
                        where worker_id = v_luis and scheduled_date = d);
  end if;

  -- 9 ── THE GROUP CHAT -------------------------------------------------------
  -- Written the way a deck crew actually texts: short, no punctuation, one
  -- thing per line, and the owner answering a question about money. owner_id is
  -- denormalised onto every row (the RPC stamps it in production) so RLS and
  -- the owner's data export never need a join.
  if v_dave is not null then
    insert into public.job_messages (project_id, owner_id, author_id, body, created_at) values
      (v_deck, v_owner, v_owner, 'Railing posts are at Curtis, picking them up on the way in', now() - interval '51 hours'),
      (v_deck, v_owner, v_dave,  'ok. we short 2 balusters on the north run',                  now() - interval '50 hours'),
      (v_deck, v_owner, v_owner, 'Added them to the buy list. Grab them when you fuel up',     now() - interval '49 hours'),
      (v_deck, v_owner, v_dave,  'Gary asked again about the offcut pile',                     now() - interval '29 hours'),
      (v_deck, v_owner, v_owner, 'Dump run tomorrow morning. Tell him it is handled',          now() - interval '28 hours');
  end if;
  if v_luis is not null then
    insert into public.job_messages (project_id, owner_id, author_id, body, created_at) values
      (v_deck, v_owner, v_luis,  'I can be there 7:30 tomorrow',                    now() - interval '27 hours'),
      (v_deck, v_owner, v_owner, 'Good. Dave is on stairs, you are on decking',     now() - interval '26 hours'),
      (v_deck, v_owner, v_luis,  'got it',                                          now() - interval '25 hours');
  end if;
  if v_dave is not null then
    insert into public.job_messages (project_id, owner_id, author_id, body, created_at) values
      (v_deck, v_owner, v_dave, 'on site, starting on the stringers', now() - interval '2 hours');
  end if;

  raise notice 'Seeded. owner=% deck=% bath=% kitchen=% dave=% luis=%',
    v_owner, v_deck, v_bath, v_kitchen, v_dave, v_luis;
end
$seed$;

-- ── PROVE IT FROM THE CATALOG, NOT FROM THE TOAST ────────────────────────────
-- "Success. No rows returned" is not proof. These are. They key off the job
-- names rather than the email, so they still work if the session setting did
-- not survive the connection — there is nothing to edit down here.

-- A. Access is comped and the app agrees.
select s.status, s.plan, public.has_app_access(s.owner_id) as app_access
  from public.subscriptions s
 where s.owner_id = (select owner_id from public.projects where name = 'Miller Road deck' limit 1);

-- B. Three jobs, and only two of them count against the free slot.
select p.name, p.stage, p.budget, p.materials_budget, p.labor_budget
  from public.projects p
 where p.owner_id = (select owner_id from public.projects where name = 'Miller Road deck' limit 1)
 order by p.created_at;

-- C. THE ONE THAT MATTERS: the bars, computed the way fetchSpend computes them
-- (amount + tax_amount), not the way v1 of this file wrongly did.
--     Miller Road deck  → materials 82.0, labor 76.3
--     Fielding Ave bath → materials 93.1, labor 68.4
select p.name,
       round(100 * (coalesce(m.materials,0)) / nullif(p.materials_budget,0), 1) as materials_pct,
       round(100 * (coalesce(l.labor,0))     / nullif(p.labor_budget,0),     1) as labor_pct,
       coalesce(m.materials,0) as materials_cost,
       coalesce(l.labor,0)     as labor_cost
  from public.projects p
  left join lateral (select sum(r.amount + r.tax_amount) as materials
                       from public.receipts r
                      where r.project_id = p.id and r.category = 'materials') m on true
  left join lateral (select sum(t.labor_cost) as labor
                       from public.time_entries t
                      where t.project_id = p.id and t.clocked_out_at is not null) l on true
 where p.name in ('Miller Road deck','Fielding Ave bathroom')
 order by p.name;

-- D. Every receipt has a photo, and every photo is on our own origin (anything
-- else is blocked by the CSP and renders as a broken image on camera).
select store, description, amount, tax_amount,
       photo_url like 'https://runsite-pearl.vercel.app/demo/receipts/%' as photo_ok
  from public.receipts
 where project_id in (select id from public.projects
                       where name in ('Miller Road deck','Fielding Ave bathroom'))
 order by purchase_date;

-- E. Somebody is on the clock right now. This must return rows, or the biggest
-- number on the Home screen is a grey zero.
select pr.full_name, p.name as job, t.clocked_in_at,
       round(extract(epoch from (now() - t.clocked_in_at))/60) as minutes_on
  from public.time_entries t
  join public.profiles pr on pr.id = t.worker_id
  join public.projects p  on p.id  = t.project_id
 where t.clocked_out_at is null
 order by t.clocked_in_at;

-- F. The week has shifts on both sides of today, and today itself is covered.
select scheduled_date, count(*) as shifts
  from public.schedule_entries
 where project_id in (select id from public.projects where name in ('Miller Road deck','Ontario St kitchen'))
   and scheduled_date between current_date - 7 and current_date + 10
 group by scheduled_date
 order by scheduled_date;

-- G. Everything else that has to be non-empty before the camera rolls.
select 'mileage'   as thing, count(*) from public.mileage_entries where project_id in (select id from public.projects where name = 'Miller Road deck')
union all select 'buy list',   count(*) from public.material_items where project_id in (select id from public.projects where name = 'Miller Road deck')
union all select 'fix list',   count(*) from public.punch_items    where project_id in (select id from public.projects where name = 'Miller Road deck')
union all select 'chat lines', count(*) from public.job_messages   where project_id in (select id from public.projects where name = 'Miller Road deck')
union all select 'invoices',   count(*) from public.invoices       where project_id in (select id from public.projects where name in ('Miller Road deck','Fielding Ave bathroom'));
