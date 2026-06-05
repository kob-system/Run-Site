-- =====================================================================
-- FIX-DATABASE-8 : Server-authoritative payroll on time_entries
-- =====================================================================
-- WHY: today the worker's phone computes total_minutes + labor_cost and
-- writes them directly, so a tampered client could inflate hours/pay
-- (flagged as the top payroll-integrity hole in the security audit).
--
-- HOW: a BEFORE INSERT/UPDATE trigger RECOMPUTES total_minutes + labor_cost
-- from the clock timestamps and the worker's SERVER-held rate, overwriting
-- whatever the client sent. We use a recompute trigger (NOT column locks)
-- on purpose: the worker's clock-out upsert still SUCCEEDS — it just gets
-- corrected — so this can never break the clock-out flow.
--
-- SAFE TO RE-RUN (create-or-replace + drop-if-exists).
--
-- ⚠️ JP: apply this in the Supabase SQL editor, then run the SELF-TEST at the
-- bottom (it uses a transaction + ROLLBACK, so it leaves NO junk data), and
-- finally clock in/out once as a worker (mike@firstclassdemo.com) to confirm
-- the flow still works. I held off applying it myself because it sits on the
-- live clock-out write path and deserves your eyes-on.
-- =====================================================================

create or replace function public.compute_time_entry_pay()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  rate numeric;
begin
  -- An open shift (no clock-out yet) carries no totals.
  if new.clocked_out_at is null then
    new.total_minutes := null;
    new.labor_cost := null;
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
-- Picks a real worker (with a rate) + one of their projects, inserts a
-- 2-hour shift with deliberately BOGUS totals, and proves the trigger
-- overwrote them with the correct server-computed values.
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
--   )
--   insert into public.time_entries
--     (client_id, project_id, worker_id, clocked_in_at, clocked_out_at, total_minutes, labor_cost)
--   select gen_random_uuid(), (select project_id from p), (select id from w),
--          now() - interval '2 hours', now(),
--          999999, 999999            -- bogus values the client "sent"
--   returning total_minutes, labor_cost;   -- EXPECT ~120 min and 2 * hourly_rate (NOT 999999)
-- rollback;
