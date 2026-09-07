-- RESET THE SHOOT DATA TO TODAY.
--
-- Run this on the MORNING OF THE SHOOT, and only this. It does not touch the
-- jobs, the receipts, the invoices, the lists or the chat — those never go
-- stale. It fixes the two things that are stamped with a real clock:
--
--   1. THE TWO OPEN SHIFTS. Dave and Luis are clocked in at 07:12 and 07:31.
--      Those timestamps are absolute, so filming a day later makes the Crew
--      screen say "31h 40m" next to a man's name, which reads as broken
--      software on camera. This re-stamps them to this morning.
--   2. THE SHIFT THAT COVERS TODAY. schedule_entries are dated rows; a shoot
--      on a day nobody was scheduled shows an empty week strip.
--
--   node ~/the-sky/bin/sql.mjs RESHOOT-RESET.sql
--
-- Owner is Summit Remodeling, c9114903-61f7-4d2f-9cd7-d8c55d4b8b46. Crew are
-- Dave Molinari ($28), Luis Ferrara ($26) and Mike Torres ($38) — all three
-- were made through api/join-invite.js, so their invite links still work and
-- the Workers tab can copy them on camera.

do $reset$
declare
  v_owner   uuid := 'c9114903-61f7-4d2f-9cd7-d8c55d4b8b46';
  v_deck    uuid := '26d78515-e8cb-446d-9663-500e35925144';
  v_kitchen uuid := 'c32964c1-6fbc-4943-ab2d-f43e4513d99d';
  v_dave    uuid := '8de7d02e-8a3e-435d-996a-1fee054770ca';
  v_luis    uuid := 'ec530910-5cc7-4410-b57c-11924c26e0fb';
  v_mike    uuid := 'f1769a97-53a0-4b99-8c90-ddb1548cbf76';
  d date := current_date;
begin
  -- Clear whatever open shifts are there and put two fresh ones down. Deleting
  -- first is what keeps a second run from stacking four men on the clock.
  delete from public.time_entries
   where clocked_out_at is null
     and worker_id in (v_dave, v_luis, v_mike);

  -- least() so a shoot before 07:12 still shows a man who started in the past
  -- rather than one who clocked in in the future.
  insert into public.time_entries (project_id, worker_id, clocked_in_at) values
    (v_deck, v_dave, least((d + time '07:12') at time zone 'America/New_York', now() - interval '25 minutes')),
    (v_deck, v_luis, least((d + time '07:31') at time zone 'America/New_York', now() - interval '12 minutes'));

  -- Today is covered for all three, whatever weekday it lands on.
  insert into public.schedule_entries
    (owner_id, worker_id, project_id, task_description, scheduled_date, start_time, end_time)
  select v_owner, v_dave, v_deck, 'Railing + stairs', d, time '07:00', time '15:00'
   where not exists (select 1 from public.schedule_entries where worker_id = v_dave and scheduled_date = d);
  insert into public.schedule_entries
    (owner_id, worker_id, project_id, task_description, scheduled_date, start_time, end_time)
  select v_owner, v_luis, v_deck, 'Decking + stain prep', d, time '07:30', time '15:30'
   where not exists (select 1 from public.schedule_entries where worker_id = v_luis and scheduled_date = d);
  insert into public.schedule_entries
    (owner_id, worker_id, project_id, task_description, scheduled_date, start_time, end_time)
  select v_owner, v_mike, v_kitchen, 'Cabinet layout', d, time '08:00', time '16:00'
   where not exists (select 1 from public.schedule_entries where worker_id = v_mike and scheduled_date = d);
end
$reset$;

-- PROVE IT. Two rows, both with a small number of minutes. If this is empty the
-- biggest number on the Home screen is a grey zero.
select pr.full_name, p.name as job,
       to_char(t.clocked_in_at at time zone 'America/New_York', 'HH12:MI AM') as in_at,
       round(extract(epoch from (now() - t.clocked_in_at))/60) as minutes_on
  from public.time_entries t
  join public.profiles pr on pr.id = t.worker_id
  join public.projects p  on p.id  = t.project_id
 where t.clocked_out_at is null and pr.owner_id = 'c9114903-61f7-4d2f-9cd7-d8c55d4b8b46'
 order by t.clocked_in_at;
