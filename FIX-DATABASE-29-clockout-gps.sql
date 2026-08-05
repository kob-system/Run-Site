-- =====================================================================
-- FIX-DATABASE-29 : Clock-OUT GPS stamp on time_entries
-- =====================================================================
-- WHY: the app only ever stamped a location at clock IN. The owner could see
-- where a shift STARTED but not where it ended — so a guy could start on the
-- job and finish anywhere, and "GPS at clock in and clock out" (already
-- promised in privacy.html §3 and terms.html §1) was not actually true.
--
-- HOW: two nullable columns mirroring gps_lat/gps_lng. Nullable ON PURPOSE —
-- a phone with location blocked, no fix, or a slow lock still clocks out and
-- still gets paid; only the location is missing. Same contract as clock-in:
-- hours are never held hostage to a map pin.
--
-- RLS: no policy change needed. worker_update_own_time_entries (migration #4)
-- gates the ROW (worker_id = auth.uid()), not individual columns, so the
-- worker's own clock-out already carries the right to write these.
--
-- SAFE TO RE-RUN (add-column-if-not-exists + create-or-replace).
--
-- ⚠️ JP: apply this in the Supabase SQL editor, then run the SELF-TEST at the
-- bottom (transaction + ROLLBACK, leaves NO junk data), and finally clock in
-- and out once as a worker (mike@firstclassdemo.com) to confirm the real flow.
-- =====================================================================

alter table public.time_entries
  add column if not exists gps_out_lat numeric,
  add column if not exists gps_out_lng numeric;


-- ---------------------------------------------------------------------
-- Payroll trigger, extended: an OPEN shift cannot have an end location.
--
-- This is the same server-authoritative recompute from FIX-DATABASE-8 with
-- one addition — while clocked_out_at is null we now also null the clock-out
-- coordinates, exactly as we already null total_minutes/labor_cost. Without
-- this, a tampered client could stamp an "ended at the shop" location onto a
-- shift that is still running, and the owner's map pin would lie.
--
-- Still a RECOMPUTE trigger, not column locks: the worker's clock-out upsert
-- always SUCCEEDS, it just gets corrected. This can never break clock-out.
-- ---------------------------------------------------------------------
create or replace function public.compute_time_entry_pay()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  rate numeric;
begin
  -- An open shift (no clock-out yet) carries no totals and no end location.
  if new.clocked_out_at is null then
    new.total_minutes := null;
    new.labor_cost := null;
    new.gps_out_lat := null;
    new.gps_out_lng := null;
    return new;
  end if;

  -- Defensive: a clock-out must be after the clock-in.
  if new.clocked_in_at is null or new.clocked_out_at <= new.clocked_in_at then
    new.total_minutes := 0;
    new.labor_cost := 0;
    return new;
  end if;

  -- Server-held rate for THIS entry's worker — never trust a client value.
  select hourly_rate into rate
  from public.profiles
  where id = new.worker_id;

  new.total_minutes := floor(extract(epoch from (new.clocked_out_at - new.clocked_in_at)) / 60)::int;
  new.labor_cost    := round((new.total_minutes::numeric / 60) * coalesce(rate, 0), 2);
  return new;
end;
$$;

drop trigger if exists trg_compute_time_entry_pay on public.time_entries;
create trigger trg_compute_time_entry_pay
  before insert or update on public.time_entries
  for each row execute function public.compute_time_entry_pay();


-- =====================================================================
-- SELF-TEST  (run this block on its own; it ROLLBACKs → no data is kept)
-- Proves three things:
--   1. an OPEN shift cannot hold an end location (trigger nulls it),
--   2. a CLOSED shift keeps the end location the phone sent,
--   3. the payroll recompute from #8 still works.
-- =====================================================================
-- begin;
--   with w as (
--     select id, hourly_rate from public.profiles
--     where role = 'worker' and coalesce(hourly_rate,0) > 0
--     limit 1
--   ),
--   p as (
--     select pw.project_id from public.project_workers pw
--     join w on w.id = pw.worker_id limit 1
--   ),
--   ins as (
--     insert into public.time_entries
--       (client_id, project_id, worker_id, clocked_in_at, clocked_out_at,
--        gps_lat, gps_lng, gps_out_lat, gps_out_lng, total_minutes, labor_cost)
--     select gen_random_uuid(), (select project_id from p), (select id from w),
--            now() - interval '2 hours', null,
--            42.7284, -73.6918, 42.9999, -73.9999,   -- bogus end pin on an OPEN shift
--            9999, 9999                              -- bogus pay
--     returning *
--   )
--   select 'OPEN shift'  as case,
--          gps_out_lat is null and gps_out_lng is null as end_pin_cleared,
--          total_minutes is null and labor_cost is null as totals_cleared
--   from ins;
--
--   -- now close it and confirm the end pin STICKS
--   update public.time_entries
--     set clocked_out_at = now(), gps_out_lat = 42.9999, gps_out_lng = -73.9999
--   where client_id = (select client_id from public.time_entries order by created_at desc limit 1);
--
--   select 'CLOSED shift' as case, gps_out_lat, gps_out_lng, total_minutes, labor_cost
--   from public.time_entries order by created_at desc limit 1;
-- rollback;
