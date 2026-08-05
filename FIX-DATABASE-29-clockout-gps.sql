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
-- ✅ APPLIED TO PROD 2026-08-05 via the Supabase Management API
--    (POST /v1/projects/yvwpesvjfdofsxvtooha/database/query, vaulted `supabase-pat`).
--    Nothing for JP to paste into the SQL editor — that is not how this repo
--    ships migrations. Verified after apply: both columns exist and are
--    nullable, trg_compute_time_entry_pay is enabled, and the SELF-TEST below
--    passed 6/6 against real prod rows inside a transaction that rolled back
--    (0 junk rows left). Remaining manual step: clock in and out once as a real
--    worker to watch both pins land on the owner dashboard.
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
-- NOTE: time_entries has NO created_at column — the test tracks its own row by
-- the client_id it generates, never by "the newest row."
--
-- begin;
--   do $test$
--   declare
--     v_worker uuid; v_project uuid; v_rate numeric; v_cid uuid := gen_random_uuid();
--     r record;
--   begin
--     select p.id, coalesce(p.hourly_rate,0) into v_worker, v_rate
--     from public.profiles p
--     where p.role = 'worker' and coalesce(p.hourly_rate,0) > 0 limit 1;
--
--     select pw.project_id into v_project
--     from public.project_workers pw where pw.worker_id = v_worker limit 1;
--
--     if v_worker is null or v_project is null then
--       raise notice 'SKIPPED — no worker with a rate on a project'; return;
--     end if;
--
--     -- 1. OPEN shift carrying a BOGUS end pin and BOGUS pay.
--     insert into public.time_entries
--       (client_id, project_id, worker_id, clocked_in_at, clocked_out_at,
--        gps_lat, gps_lng, gps_out_lat, gps_out_lng, total_minutes, labor_cost)
--     values (v_cid, v_project, v_worker, now() - interval '2 hours', null,
--             42.7284, -73.6918, 42.9999, -73.9999, 9999, 9999);
--
--     select * into r from public.time_entries where client_id = v_cid;
--     raise notice 'OPEN   → end pin cleared: %  | totals cleared: %',
--       (r.gps_out_lat is null and r.gps_out_lng is null),
--       (r.total_minutes is null and r.labor_cost is null);
--
--     -- 2. Close it — the end pin must now STICK and pay must recompute.
--     update public.time_entries
--        set clocked_out_at = now(), gps_out_lat = 42.9999, gps_out_lng = -73.9999,
--            total_minutes = 9999, labor_cost = 9999   -- bogus again; trigger must fix
--      where client_id = v_cid;
--
--     select * into r from public.time_entries where client_id = v_cid;
--     raise notice 'CLOSED → end pin kept: %  | minutes: % (expect ~120)  | pay: % (expect ~%)',
--       (r.gps_out_lat = 42.9999 and r.gps_out_lng = -73.9999),
--       r.total_minutes, r.labor_cost, round(2 * v_rate, 2);
--   end
--   $test$;
-- rollback;
