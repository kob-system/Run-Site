-- MAKE JP'S OWN ACCOUNT FILMABLE.
--
-- Owner is John Paul Kobrossi, jpkobrossi@hotmail.com,
-- 7d1e61b6-fc8f-43f4-8683-f3893e5394f1. This is the account the 2026-09-06
-- takes were actually shot on, and the account the Chrome recording stage is
-- already signed into — which is why it is being fixed in place rather than
-- swapping to Summit Remodeling, whose password nobody has.
--
--   node ~/the-sky/bin/sql.mjs SEED-SHOOT-ACCOUNT-JP.sql
--
-- ⚠️ THIS RENAMES, IT DOES NOT REBUILD. Every receipt, invoice, budget and
-- historical hour on this account is real-looking already and is left exactly
-- alone. What the takes exposed was not missing money, it was:
--
--   1. NINE JOB TITLES THAT ARE LABELS. "Deck Job — OVER BUDGET", "Siding Job
--      — DONE, $14,000 STILL OWED". Every one announces the app is a demo, and
--      the assistant reads the whole list back out loud when it cannot find a
--      job, so they end up on screen twice.
--   2. SIX CREW NAMED BY TRADE. "Dave — Lead Carpenter", "Ray — Plumber",
--      plus "Ghana" and "Joe", which are test junk.
--   3. NINE CLIENTS LITERALLY CALLED "Client". "Client — Owes $5,000".
--   4. TWO MEN ON THE CLOCK SINCE 1:29 AM. The open shifts are 33 days old, so
--      Home renders a start time in the middle of the night.
--   5. NOBODY HAS WORKED SINCE 2026-08-04, so every worker reads 0h 0m THIS
--      WEEK and Crew Pay is a column of zeroes.
--   6. NOTHING SCHEDULED THIS WEEK, so Home shows its instructional empty
--      state instead of the crew's week.
--   7. NOT ONE CHAT MESSAGE ON ANY OF THE NINE JOBS. The whole "the crew talks
--      inside the job" story had nothing behind it.
--   8. A TIME-OFF REQUEST DATED AUG 14 still sitting in Waiting, and two
--      invites sent and never claimed.
--
-- Re-running is safe: the renames are idempotent and every block clears what
-- it made before writing it again.

do $shoot$
declare
  v_owner uuid := '7d1e61b6-fc8f-43f4-8683-f3893e5394f1';

  -- Jobs keep their ids, their money and their history. Only the words change.
  v_roof    uuid := 'b2000001-0000-4000-8000-000000000001';
  v_porch   uuid := 'b2000002-0000-4000-8000-000000000002';
  v_siding  uuid := 'b2000003-0000-4000-8000-000000000003';
  v_bath    uuid := 'b2000004-0000-4000-8000-000000000004';
  v_kitchen uuid := 'b2000005-0000-4000-8000-000000000005';
  v_deck    uuid := 'b2000006-0000-4000-8000-000000000006';
  v_base    uuid := 'b2000007-0000-4000-8000-000000000007';
  v_slab    uuid := 'b2000008-0000-4000-8000-000000000008';
  v_est     uuid := '586c7b98-6704-4cdd-ac3e-2641908f01bd';

  v_dave   uuid := 'a1000001-0000-4000-8000-000000000001';  -- lead carpenter, $34
  v_marcus uuid := 'a1000002-0000-4000-8000-000000000002';  -- finish carpenter, $29
  v_tony   uuid := 'a1000003-0000-4000-8000-000000000003';  -- framer, $27
  v_ray    uuid := 'a1000004-0000-4000-8000-000000000004';  -- plumber, $36
  v_kevin  uuid := 'a1000005-0000-4000-8000-000000000005';  -- laborer, $22
  v_joe    uuid := 'dcf0dc48-89cf-40b7-867f-5c28ecf97f89';  -- was "Joe" at $52
  v_andre  uuid := '0e38f0ff-f9a8-4f15-b44d-ac0bcbff3653';  -- was "Ghana" at $58

  d date := current_date;
begin

  -- 1 ── THE JOB NAMES, THE CLIENTS AND THE ADDRESSES ------------------------
  -- Capital Region streets and ordinary homeowner names. A contractor watching
  -- this recognises the towns, which is most of why it stops reading as a demo.
  update public.projects set name='Vly Road roof',           client_name='Ken Duffney',    client_phone='5185550164', client_email='kduffney@gmail.com',        client_address='88 Vly Rd, Niskayuna NY 12309'      where id=v_roof;
  update public.projects set name='Kenwood Ave porch',       client_name='Anne Whitcomb',  client_phone='5185550132', client_email='awhitcomb@outlook.com',    client_address='21 Kenwood Ave, Delmar NY 12054'    where id=v_porch;
  update public.projects set name='Third Ave siding',        client_name='Rick Santoro',   client_phone='5185550196', client_email='rsantoro1@gmail.com',      client_address='512 Third Ave, Watervliet NY 12189' where id=v_siding;
  update public.projects set name='Fielding Ave bathroom',   client_name='Ruth Delaney',   client_phone='5185550188', client_email='rdelaney.home@gmail.com',  client_address='42 Fielding Ave, Menands NY 12204'  where id=v_bath;
  update public.projects set name='Ontario St kitchen',      client_name='Marisol Vega',   client_phone='5185550171', client_email='m.vega77@gmail.com',       client_address='9 Ontario St, Cohoes NY 12047'      where id=v_kitchen;
  update public.projects set name='Miller Road deck',        client_name='Gary Petrucci',  client_phone='5185550142', client_email='gpetrucci@outlook.com',    client_address='118 Miller Rd, Latham NY 12110'     where id=v_deck;
  update public.projects set name='Hackett Blvd basement',   client_name='Dan Merola',     client_phone='5185550107', client_email='dmerola@gmail.com',        client_address='340 Hackett Blvd, Albany NY 12208'  where id=v_base;
  update public.projects set name='Sand Creek garage slab',  client_name='Paul Ianniello', client_phone='5185550153', client_email='pianniello@gmail.com',     client_address='76 Sand Creek Rd, Colonie NY 12205' where id=v_slab;
  update public.projects set name='Osborne Rd roof',         client_name='Dennis Hoyt',    client_phone='5185550119', client_email='dhoyt.home@gmail.com',     client_address='15 Osborne Rd, Loudonville NY 12211' where id=v_est;

  -- 2 ── THE CREW ------------------------------------------------------------
  -- Rates stay where they are for the five real ones, because the labor cost
  -- already booked against every job was computed from them and changing a rate
  -- would move a budget bar. The two test accounts get plausible rates: $52 and
  -- $58 an hour are owner money, not crew money, and read as a mistake.
  update public.profiles set full_name='Dave Molinari'  where id=v_dave;
  update public.profiles set full_name='Marcus Whitley' where id=v_marcus;
  update public.profiles set full_name='Tony Bracco'    where id=v_tony;
  update public.profiles set full_name='Ray Cioffi'     where id=v_ray;
  update public.profiles set full_name='Kevin Shea'     where id=v_kevin;
  update public.profiles set full_name='Joe Vasquez', hourly_rate=31.00 where id=v_joe;
  update public.profiles set full_name='Andre Pratt',  hourly_rate=27.00 where id=v_andre;

  -- 3 ── ON THE CLOCK, THIS MORNING AND NOT LAST MONTH -----------------------
  -- The open shifts were 33 days old, which Home renders as "since 1:29 AM".
  -- least() keeps it honest if he shoots before 07:10.
  delete from public.time_entries where clocked_out_at is null
     and worker_id in (v_dave, v_marcus, v_tony, v_ray, v_kevin, v_joe, v_andre);

  insert into public.time_entries (project_id, worker_id, clocked_in_at) values
    (v_deck,    v_dave, least((d + time '07:12') at time zone 'America/New_York', now() - interval '28 minutes')),
    (v_deck,    v_tony, least((d + time '07:26') at time zone 'America/New_York', now() - interval '17 minutes')),
    (v_kitchen, v_ray,  least((d + time '07:44') at time zone 'America/New_York', now() - interval '9 minutes'));

  -- 4 ── HOURS THIS WEEK -----------------------------------------------------
  -- Nobody had clocked since 2026-08-04, so every man read 0h 0m THIS WEEK and
  -- Crew Pay was a column of zeroes. Clear anything this file wrote before, then
  -- lay down the last five weekdays. labor_cost is written even though
  -- trg_compute_time_entry_pay overwrites it from profiles.hourly_rate, so the
  -- numbers are still right on a database where that trigger is missing.
  delete from public.time_entries
   where clocked_out_at is not null
     and clocked_in_at >= (d - 9)::timestamptz
     and worker_id in (v_dave, v_marcus, v_tony, v_ray, v_kevin);

  insert into public.time_entries (project_id, worker_id, clocked_in_at, clocked_out_at, total_minutes, labor_cost)
  select x.job, x.man,
         (g.day::date + x.tin)  at time zone 'America/New_York',
         (g.day::date + x.tout) at time zone 'America/New_York',
         480, x.rate * 8
    from (values
            (v_deck,    v_dave,   time '07:30', time '15:30', 34.00),
            (v_deck,    v_tony,   time '07:30', time '15:30', 27.00),
            (v_kitchen, v_ray,    time '08:00', time '16:00', 36.00),
            (v_kitchen, v_marcus, time '08:00', time '16:00', 29.00),
            (v_base,    v_kevin,  time '07:00', time '15:00', 22.00)
         ) as x(job, man, tin, tout, rate)
   cross join generate_series((d - 7)::timestamp, (d - 1)::timestamp, interval '1 day') as g(day)
   where extract(isodow from g.day) < 6;

  -- 5 ── THE WEEK ON THE CALENDAR --------------------------------------------
  -- Home was showing "Nothing scheduled this week" — the instructional empty
  -- state, on the screen the video opens with. Seven days back and ten forward
  -- so the strip is full whichever way weekStartKey rounds.
  delete from public.schedule_entries
   where owner_id = v_owner and scheduled_date between d - 7 and d + 10;

  insert into public.schedule_entries (owner_id, worker_id, project_id, task_description, scheduled_date, start_time, end_time)
  select v_owner, x.man, x.job, x.task, g.day::date, x.tin, x.tout
    from (values
            (v_deck,    v_dave,   'Railing + stairs',     time '07:30', time '15:30'),
            (v_deck,    v_tony,   'Decking + stain prep', time '07:30', time '15:30'),
            (v_kitchen, v_ray,    'Rough-in second floor',time '08:00', time '16:00'),
            (v_kitchen, v_marcus, 'Cabinet layout',       time '08:00', time '16:00'),
            (v_base,    v_kevin,  'Haul out + prep',      time '07:00', time '15:00')
         ) as x(job, man, task, tin, tout)
   cross join generate_series((d - 7)::timestamp, (d + 10)::timestamp, interval '1 day') as g(day)
   where extract(isodow from g.day) < 6;

  -- Today gets covered no matter what weekday the shoot lands on.
  insert into public.schedule_entries (owner_id, worker_id, project_id, task_description, scheduled_date, start_time, end_time)
  select v_owner, x.man, x.job, x.task, d, time '07:00', time '13:00'
    from (values (v_deck, v_dave, 'Railing + stairs'), (v_deck, v_tony, 'Decking + stain prep'), (v_kitchen, v_ray, 'Rough-in second floor')) as x(job, man, task)
   where not exists (select 1 from public.schedule_entries s where s.worker_id = x.man and s.scheduled_date = d);

  -- 6 ── THE CREW THREAD -----------------------------------------------------
  -- Not one message existed on any of the nine jobs, so "everyone on this job
  -- sees this thread" had nothing behind it. Written the way a deck crew texts:
  -- short, no punctuation, one thing per line, the owner answering about money.
  delete from public.job_messages where project_id in (v_deck, v_kitchen);

  insert into public.job_messages (project_id, owner_id, author_id, body, created_at) values
    (v_deck, v_owner, v_owner,  'Railing posts are at Curtis, grabbing them on the way in', now() - interval '51 hours'),
    (v_deck, v_owner, v_dave,   'ok. we short 2 balusters on the north run',                now() - interval '50 hours'),
    (v_deck, v_owner, v_owner,  'Added them to the buy list. Get them when you fuel up',    now() - interval '49 hours'),
    (v_deck, v_owner, v_dave,   'Gary asked again about the offcut pile',                   now() - interval '29 hours'),
    (v_deck, v_owner, v_owner,  'Dump run in the morning. Tell him it is handled',          now() - interval '28 hours'),
    (v_deck, v_owner, v_tony,   'I can be there 7:30 tomorrow',                             now() - interval '27 hours'),
    (v_deck, v_owner, v_owner,  'Good. Dave is on stairs, you are on decking',              now() - interval '26 hours'),
    (v_deck, v_owner, v_tony,   'got it',                                                   now() - interval '25 hours'),
    (v_deck, v_owner, v_dave,   'on site, starting on the stringers',                       now() - interval '2 hours'),
    (v_kitchen, v_owner, v_ray,    'valve behind the sink is shot, replacing it',           now() - interval '26 hours'),
    (v_kitchen, v_owner, v_owner, 'Put it on the job, do not eat it',                       now() - interval '25 hours'),
    (v_kitchen, v_owner, v_marcus,'uppers are hung, starting the crown after lunch',        now() - interval '3 hours');

  -- 7 ── THE STALE PAPERWORK -------------------------------------------------
  -- A time-off request dated Aug 14 sitting in Waiting reads as an owner who
  -- ignores his crew. Moved onto next week so the Approve / Deny buttons are a
  -- live decision on camera instead of a three-week-old one.
  update public.time_off_requests
     set start_date = d + 4, end_date = d + 5, reason = 'Family thing out of town'
   where status = 'pending' and worker_id in (v_dave, v_marcus, v_tony, v_ray, v_kevin, v_joe, v_andre);

  -- Two invites were sent and never claimed, so Workers opens with a "Sent, not
  -- joined yet" block naming a stranger. Killed — he makes a live one on camera.
  update public.worker_invites set revoked_at = now()
   where owner_id = v_owner and used_at is null and revoked_at is null;

end
$shoot$;

-- ── PROVE IT, FROM THE CATALOG ───────────────────────────────────────────────

-- A. No job title is a label any more, and no client is called "Client".
select name, client_name, stage from public.projects
 where owner_id = '7d1e61b6-fc8f-43f4-8683-f3893e5394f1' order by created_at;

-- B. No crew member is named after his trade.
select full_name, hourly_rate from public.profiles
 where owner_id = '7d1e61b6-fc8f-43f4-8683-f3893e5394f1' order by full_name;

-- C. Three men on the clock, all with a small number of minutes. If the minutes
-- run to thousands, Home will print a start time in the middle of the night.
select pr.full_name, p.name as job,
       to_char(t.clocked_in_at at time zone 'America/New_York', 'HH12:MI AM') as in_at,
       round(extract(epoch from (now() - t.clocked_in_at))/60) as minutes_on
  from public.time_entries t
  join public.profiles pr on pr.id = t.worker_id
  join public.projects p  on p.id  = t.project_id
 where t.clocked_out_at is null and pr.owner_id = '7d1e61b6-fc8f-43f4-8683-f3893e5394f1'
 order by t.clocked_in_at;

-- D. Everybody has hours THIS WEEK. Any zero here is a zero on the Crew screen.
select pr.full_name,
       sum(t.total_minutes) filter (where t.clocked_in_at >= date_trunc('week', now())) as mins_this_week,
       sum(t.total_minutes) as mins_all_time
  from public.profiles pr
  left join public.time_entries t on t.worker_id = pr.id
 where pr.owner_id = '7d1e61b6-fc8f-43f4-8683-f3893e5394f1'
 group by pr.full_name order by 2 desc nulls last;

-- E. The week has shifts on both sides of today, and today is covered.
select scheduled_date, count(*) as shifts from public.schedule_entries
 where owner_id = '7d1e61b6-fc8f-43f4-8683-f3893e5394f1'
   and scheduled_date between current_date - 7 and current_date + 10
 group by 1 order by 1;

-- F. The two jobs the video lives on have a thread, and nothing is still
-- sitting in the owner's face from three weeks ago.
select 'chat on the deck'    as thing, count(*)::text from public.job_messages where project_id = 'b2000006-0000-4000-8000-000000000006'
union all select 'chat on the kitchen', count(*)::text from public.job_messages where project_id = 'b2000005-0000-4000-8000-000000000005'
union all select 'unclaimed invites',   count(*)::text from public.worker_invites where owner_id = '7d1e61b6-fc8f-43f4-8683-f3893e5394f1' and used_at is null and revoked_at is null
union all select 'time-off waiting',    count(*)::text from public.time_off_requests where status = 'pending';
