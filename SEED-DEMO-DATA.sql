-- ============================================================
-- RUN-SITE — DEMO DATA SEED  (First Class Property Services)
-- Run in Supabase → SQL Editor AFTER:
--   • FIX-DATABASE-4 and FIX-DATABASE-5 have been applied, and
--   • the owner account Firstclasspropertyservices7@gmail.com has
--     signed up in the app (role = owner).
-- Creates 2 demo crew members and a full set of sample data so the
-- owner sees every feature populated. Safe to re-run (skips if the
-- owner already has jobs).
-- ============================================================
do $$
declare
  v_owner uuid;
  v_mike  uuid := '11111111-1111-4111-8111-111111111111';
  v_dave  uuid := '22222222-2222-4222-8222-222222222222';
  p_kitchen uuid := gen_random_uuid();
  p_roof    uuid := gen_random_uuid();
  p_bath    uuid := gen_random_uuid();
  p_elec    uuid := gen_random_uuid();
  -- Sunday-start week anchors that match the app's weekly grouping.
  sun_c date := (current_date - 17) - extract(dow from (current_date - 17))::int; -- ~2.5 wks ago
  sun_b date := (current_date - 10) - extract(dow from (current_date - 10))::int; -- ~1.5 wks ago
  glat  numeric := 42.7284;  -- Troy, NY
  glng  numeric := -73.6918;
begin
  select id into v_owner from auth.users
    where lower(email) = lower('Firstclasspropertyservices7@gmail.com') limit 1;
  if v_owner is null then
    raise exception 'No auth user for Firstclasspropertyservices7@gmail.com — sign up in the app first.';
  end if;
  -- Ensure the owner profile exists (signup can land on the recovery screen if
  -- the client-side profile insert is blocked; create it here as postgres).
  insert into public.profiles (id, email, full_name, company_name, role, owner_id)
    values (v_owner, 'Firstclasspropertyservices7@gmail.com', 'Josh Smith', 'First Class Property Services', 'owner', null)
  on conflict (id) do update set role = 'owner', company_name = 'First Class Property Services';
  if exists (select 1 from public.projects where owner_id = v_owner) then
    raise notice 'Owner already has jobs — demo data appears to be seeded already. Skipping.';
    return;
  end if;

  -- ---- crew members (auth users + profiles) ----
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change_token_new, email_change)
  values
    ('00000000-0000-0000-0000-000000000000', v_mike, 'authenticated', 'authenticated',
      'mike@firstclassdemo.com', crypt('demo-pass', gen_salt('bf')), now(), now(), now(),
      '{"provider":"email","providers":["email"]}', '{}', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_dave, 'authenticated', 'authenticated',
      'dave@firstclassdemo.com', crypt('demo-pass', gen_salt('bf')), now(), now(), now(),
      '{"provider":"email","providers":["email"]}', '{}', '', '', '', '')
  on conflict (id) do nothing;

  insert into public.profiles (id, email, full_name, role, owner_id, hourly_rate) values
    (v_mike, 'mike@firstclassdemo.com', 'Mike Reyes',    'worker', v_owner, 30),
    (v_dave, 'dave@firstclassdemo.com', 'Dave Sullivan', 'worker', v_owner, 26)
  on conflict (id) do nothing;

  -- ---- jobs (mix of active + completed, across the trades) ----
  insert into public.projects (id, owner_id, name, client_name, budget, materials_budget, labor_budget, profit_target, stage, completed_at, created_at) values
    (p_kitchen, v_owner, 'Kitchen Remodel — 24 Pinewood Dr', 'Sarah Whitman',       14000, 6000, 4500, 3500, 'mid',  null,                       now() - interval '20 days'),
    (p_roof,    v_owner, 'Roof Replacement — 8 Maple Ave',   'Robert Daly',          17500, 8500, 5000, 4000, 'end',  now() - interval '5 days',  now() - interval '30 days'),
    (p_bath,    v_owner, 'Bathroom Plumbing — 112 Hoosick St','Greenfield Apartments', 5500, 2200, 1800, 1500, 'start',null,                       now() - interval '6 days'),
    (p_elec,    v_owner, 'Electrical Panel Upgrade — 305 Congress St', 'Troy Lofts LLC', 6000, 1800, 2400, 1800, 'mid', null,                     now() - interval '12 days');

  insert into public.project_workers (worker_id, project_id) values
    (v_mike, p_kitchen), (v_dave, p_kitchen), (v_mike, p_elec), (v_dave, p_bath),
    (v_mike, p_roof), (v_dave, p_roof)
  on conflict do nothing;

  -- ---- receipts: every category, with sales tax ----
  insert into public.receipts (owner_id, project_id, description, store, amount, tax_amount, category, created_at) values
    (v_owner, p_kitchen, 'Cabinets & lumber',        'Home Depot',            1840.00, 147.20, 'materials',     now() - interval '14 days'),
    (v_owner, p_kitchen, 'Sink & faucet',            'Ferguson',               620.50,  49.64, 'materials',     now() - interval '11 days'),
    (v_owner, p_kitchen, 'Paint & misc',             'Lowe''s',                215.30,  17.22, 'supplies',      now() - interval '9 days'),
    (v_owner, p_kitchen, 'Gas — supply runs',        'Stewart''s',              58.20,   0.00, 'fuel',          now() - interval '8 days'),
    (v_owner, p_bath,    'Bath fixtures',            'Ferguson Plumbing',      980.00,  78.40, 'materials',     now() - interval '4 days'),
    (v_owner, p_bath,    'Plumbing permit',          'City of Troy',           185.00,   0.00, 'permits',       now() - interval '3 days'),
    (v_owner, p_elec,    'Panel & breakers',         'Capital Electric Supply',1240.00,  99.20, 'materials',    now() - interval '7 days'),
    (v_owner, p_elec,    'Wire strippers & meter',   'Harbor Freight',         164.50,  13.16, 'tools',         now() - interval '6 days'),
    (v_owner, p_elec,    'Sub — service disconnect', 'Capital Electric',      1500.00,   0.00, 'subcontractor', now() - interval '5 days'),
    (v_owner, p_roof,    'Shingles & underlayment',  'ABC Supply',            4200.00, 336.00, 'materials',     now() - interval '24 days'),
    (v_owner, p_roof,    'Gas — material haul',      'Mobil',                   72.40,   0.00, 'fuel',          now() - interval '22 days'),
    (v_owner, p_roof,    'Crew coffee',              'Dunkin',                  38.60,   3.09, 'meals',         now() - interval '20 days');

  -- ---- time entries (labor) across 3 weeks, clocked out, with GPS ----
  insert into public.time_entries (worker_id, project_id, clocked_in_at, clocked_out_at, total_minutes, labor_cost, gps_lat, gps_lng) values
    -- week C (sun_c)
    (v_mike, p_roof,    (sun_c + 2)::timestamp + time '08:00', (sun_c + 2)::timestamp + time '16:00', 480, 240.00, glat, glng),
    (v_mike, p_kitchen, (sun_c + 4)::timestamp + time '08:00', (sun_c + 4)::timestamp + time '15:30', 450, 225.00, glat, glng),
    (v_dave, p_roof,    (sun_c + 2)::timestamp + time '08:00', (sun_c + 2)::timestamp + time '16:00', 480, 208.00, glat, glng),
    (v_dave, p_bath,    (sun_c + 4)::timestamp + time '08:30', (sun_c + 4)::timestamp + time '15:30', 420, 182.00, glat, glng),
    -- week B (sun_b)
    (v_mike, p_kitchen, (sun_b + 1)::timestamp + time '07:30', (sun_b + 1)::timestamp + time '16:00', 510, 255.00, glat, glng),
    (v_mike, p_elec,    (sun_b + 3)::timestamp + time '08:00', (sun_b + 3)::timestamp + time '16:00', 480, 240.00, glat, glng),
    (v_dave, p_kitchen, (sun_b + 1)::timestamp + time '08:00', (sun_b + 1)::timestamp + time '16:00', 480, 208.00, glat, glng),
    (v_dave, p_bath,    (sun_b + 3)::timestamp + time '08:00', (sun_b + 3)::timestamp + time '15:30', 450, 195.00, glat, glng),
    -- week A (this week)
    (v_mike, p_kitchen, (current_date - 2)::timestamp + time '08:00', (current_date - 2)::timestamp + time '16:00', 480, 240.00, glat, glng),
    (v_mike, p_elec,    (current_date - 1)::timestamp + time '08:00', (current_date - 1)::timestamp + time '15:00', 420, 210.00, glat, glng),
    (v_dave, p_bath,    (current_date - 2)::timestamp + time '08:00', (current_date - 2)::timestamp + time '15:30', 450, 195.00, glat, glng),
    (v_dave, p_kitchen, (current_date - 1)::timestamp + time '08:00', (current_date - 1)::timestamp + time '16:00', 480, 208.00, glat, glng);

  -- ---- mileage (standard-rate deduction) ----
  insert into public.mileage_entries (owner_id, project_id, trip_date, miles, rate, notes) values
    (v_owner, p_kitchen, current_date - 14, 48, 0.70, 'Cabinet pickup — Home Depot'),
    (v_owner, p_elec,    current_date - 7,  32, 0.70, 'Supply run — Capital Electric'),
    (v_owner, p_bath,    current_date - 4,  21, 0.70, 'Ferguson plumbing'),
    (v_owner, p_roof,    current_date - 24, 65, 0.70, 'Roofing supplier — material haul'),
    (v_owner, p_roof,    current_date - 22, 65, 0.70, 'Second material haul');

  -- ---- paychecks: the two older weeks already paid (this week shows as owed) ----
  insert into public.paychecks (owner_id, worker_id, week_start, week_end, total_minutes, hourly_rate, gross_pay, paid_at) values
    (v_owner, v_mike, sun_c, sun_c + 6, 930, 30, 465.00, (sun_c + 7)::timestamp),
    (v_owner, v_dave, sun_c, sun_c + 6, 900, 26, 390.00, (sun_c + 7)::timestamp),
    (v_owner, v_mike, sun_b, sun_b + 6, 990, 30, 495.00, (sun_b + 7)::timestamp),
    (v_owner, v_dave, sun_b, sun_b + 6, 930, 26, 403.00, (sun_b + 7)::timestamp);

  -- ---- schedule (upcoming) ----
  insert into public.schedule_entries (owner_id, worker_id, project_id, task_description, scheduled_date, start_time, end_time) values
    (v_owner, v_mike, p_kitchen, 'Install upper cabinets', current_date + 1, '08:00', '16:00'),
    (v_owner, v_dave, p_elec,    'Pull new circuits',      current_date + 2, '07:30', '15:30'),
    (v_owner, v_mike, p_bath,    'Set vanity & toilet',    current_date + 3, '08:00', '14:00');

  raise notice 'Demo data seeded for First Class Property Services.';
end $$;
