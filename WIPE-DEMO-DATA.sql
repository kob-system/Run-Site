-- ============================================================
-- RUN-SITE — WIPE SHOWCASE DEMO DATA
-- Removes the Summit Build Co demo owner + crew and ALL their data.
-- Paste into Supabase → SQL Editor → Run. Safe to run anytime.
-- Only touches the demo accounts (fixed UUIDs); real data is untouched.
-- ============================================================
do $$
declare
  ids uuid[] := array[
    'a0000000-0000-4000-8000-000000000001',  -- owner (Danny Rivera)
    'a0000000-0000-4000-8000-000000000002',  -- Dave
    'a0000000-0000-4000-8000-000000000003',  -- Carlos
    'a0000000-0000-4000-8000-000000000004',  -- Tyler
    'a0000000-0000-4000-8000-000000000005'   -- Mike
  ];
  v_owner uuid := 'a0000000-0000-4000-8000-000000000001';
begin
  -- child data first (explicit, in case any FK cascade isn't set)
  delete from public.time_entries     where worker_id = any(ids);
  delete from public.paychecks        where owner_id = v_owner;
  delete from public.schedule_entries where owner_id = v_owner;
  delete from public.mileage_entries  where owner_id = v_owner;
  delete from public.receipts         where owner_id = v_owner;
  delete from public.invoices         where owner_id = v_owner;
  delete from public.estimates        where owner_id = v_owner;
  delete from public.change_orders    where owner_id = v_owner;
  delete from public.daily_logs       where owner_id = v_owner;
  delete from public.job_photos       where owner_id = v_owner;
  delete from public.punch_items      where owner_id = v_owner;
  delete from public.material_items   where owner_id = v_owner;
  delete from public.project_workers  where worker_id = any(ids);
  delete from public.projects         where owner_id = v_owner;
  delete from public.profiles         where id = any(ids) or owner_id = v_owner;
  delete from auth.users              where id = any(ids);
  raise notice 'Demo data wiped.';
end $$;
