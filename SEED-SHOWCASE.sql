-- ============================================================
-- RUN-SITE — SHOWCASE SEED  (Summit Build Co — a fully lived-in account)
-- Paste into Supabase → SQL Editor → Run.  Idempotent: skips if already seeded.
--
-- Creates ONE owner you can log into + 4 crew + ~6 months of real usage:
-- 9 jobs (5 completed, 4 active) across the trades, with receipts (every
-- category), clocked hours w/ GPS, mileage, paychecks, schedule, estimates,
-- invoices, change orders, daily logs, photos, and punch/material lists.
--
--   LOG IN AS:  demo-owner@runsite-demo.com
--   PASSWORD :  RunSiteDemo!26
--
-- To remove everything later: run WIPE-DEMO-DATA.sql.
-- Requires the contractor-feature migrations (FIX-4..7) already applied (they are).
-- ============================================================
do $$
declare
  v_owner uuid := 'a0000000-0000-4000-8000-000000000001';
  v_dave  uuid := 'a0000000-0000-4000-8000-000000000002';
  v_carl  uuid := 'a0000000-0000-4000-8000-000000000003';
  v_tyler uuid := 'a0000000-0000-4000-8000-000000000004';
  v_mike  uuid := 'a0000000-0000-4000-8000-000000000005';
  -- jobs
  j_kitchen uuid := 'b0000000-0000-4000-8000-000000000001';
  j_roof    uuid := 'b0000000-0000-4000-8000-000000000002';
  j_bath    uuid := 'b0000000-0000-4000-8000-000000000003';
  j_base    uuid := 'b0000000-0000-4000-8000-000000000004';
  j_side    uuid := 'b0000000-0000-4000-8000-000000000005';
  j_deck    uuid := 'b0000000-0000-4000-8000-000000000006';
  j_elec    uuid := 'b0000000-0000-4000-8000-000000000007';
  j_add     uuid := 'b0000000-0000-4000-8000-000000000008';
  j_gar     uuid := 'b0000000-0000-4000-8000-000000000009';
  glat numeric := 42.7284;  -- Capital Region, NY
  glng numeric := -73.6918;
begin
  if exists (select 1 from public.projects where owner_id = v_owner) then
    raise notice 'Showcase already seeded — skipping.';
    return;
  end if;

  -- ---------- auth users (owner + crew) ----------
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change_token_new, email_change)
  values
    ('00000000-0000-0000-0000-000000000000', v_owner, 'authenticated', 'authenticated',
      'demo-owner@runsite-demo.com', crypt('RunSiteDemo!26', gen_salt('bf')), now(), now()-interval '180 days', now(),
      '{"provider":"email","providers":["email"]}', '{}', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_mike, 'authenticated', 'authenticated',
      'mike@summitbuild-demo.com', crypt('RunSiteDemo!26', gen_salt('bf')), now(), now()-interval '180 days', now(),
      '{"provider":"email","providers":["email"]}', '{}', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_dave, 'authenticated', 'authenticated',
      'dave@summitbuild-demo.com', crypt('RunSiteDemo!26', gen_salt('bf')), now(), now()-interval '180 days', now(),
      '{"provider":"email","providers":["email"]}', '{}', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_carl, 'authenticated', 'authenticated',
      'carlos@summitbuild-demo.com', crypt('RunSiteDemo!26', gen_salt('bf')), now(), now()-interval '150 days', now(),
      '{"provider":"email","providers":["email"]}', '{}', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_tyler, 'authenticated', 'authenticated',
      'tyler@summitbuild-demo.com', crypt('RunSiteDemo!26', gen_salt('bf')), now(), now()-interval '95 days', now(),
      '{"provider":"email","providers":["email"]}', '{}', '', '', '', '')
  on conflict (id) do nothing;

  -- ---------- profiles ----------
  insert into public.profiles (id, email, full_name, company_name, role, owner_id, hourly_rate) values
    (v_owner, 'demo-owner@runsite-demo.com', 'Danny Rivera', 'Summit Build Co', 'owner',  null, null)
  on conflict (id) do update set role='owner', company_name='Summit Build Co', full_name='Danny Rivera';
  insert into public.profiles (id, email, full_name, role, owner_id, hourly_rate) values
    (v_mike,  'mike@summitbuild-demo.com',   'Mike Reyes',     'worker', v_owner, 32),
    (v_dave,  'dave@summitbuild-demo.com',   'Dave Sullivan',  'worker', v_owner, 28),
    (v_carl,  'carlos@summitbuild-demo.com', 'Carlos Mendez',  'worker', v_owner, 30),
    (v_tyler, 'tyler@summitbuild-demo.com',  'Tyler Brooks',   'worker', v_owner, 24)
  on conflict (id) do nothing;

  -- ---------- jobs (5 completed + 4 active) ----------
  insert into public.projects (id, owner_id, name, client_name, client_phone, client_email, client_address,
      budget, materials_budget, labor_budget, profit_target, stage, completed_at, created_at) values
    (j_kitchen, v_owner, 'Kitchen Remodel — 24 Pinewood Dr', 'Sarah Whitman',  '(518) 555-0140', 'swhitman@gmail.com',   '24 Pinewood Dr, Latham NY',
        14000, 6000, 4500, 3500, 'end', now()-interval '150 days', now()-interval '170 days'),
    (j_roof,    v_owner, 'Roof Replacement — 8 Maple Ave',   'Robert Daly',    '(518) 555-0155', 'rdaly@outlook.com',    '8 Maple Ave, Troy NY',
        17500, 8500, 5000, 4000, 'end', now()-interval '120 days', now()-interval '140 days'),
    (j_bath,    v_owner, 'Bathroom Reno — 112 Hoosick St',   'Greenfield Apts','(518) 555-0161', 'mgmt@greenfield.com',  '112 Hoosick St, Troy NY',
        5500, 2200, 1800, 1500, 'end', now()-interval '95 days', now()-interval '110 days'),
    (j_base,    v_owner, 'Basement Finish — 5 Oakwood Ct',   'The Pattersons', '(518) 555-0177', 'patterson5@gmail.com', '5 Oakwood Ct, Clifton Park NY',
        17500, 7000, 6000, 4500, 'end', now()-interval '70 days', now()-interval '90 days'),
    (j_side,    v_owner, 'Siding Replacement — 41 Glenmore', 'Acme Rentals',   '(518) 555-0182', 'ops@acmerentals.com',  '41 Glenmore Ave, Albany NY',
        16500, 9000, 4000, 3500, 'end', now()-interval '40 days', now()-interval '60 days'),
    (j_deck,    v_owner, 'Deck Build — Clifton Park',        'Tom & Rita Henderson','(518) 555-0188','henderson.fam@gmail.com','8 Birchwood Dr, Clifton Park NY',
        12500, 4800, 5200, 2500, 'mid', null, now()-interval '30 days'),
    (j_elec,    v_owner, 'Electrical Panel Upgrade — 305 Congress','Troy Lofts LLC','(518) 555-0193','lofts@troyllc.com',  '305 Congress St, Troy NY',
        6000, 1800, 2400, 1800, 'mid', null, now()-interval '20 days'),
    (j_add,     v_owner, 'Addition — 19 Birch Ln',           'The Coles',      '(518) 555-0199', 'coles.home@gmail.com', '19 Birch Ln, Saratoga Springs NY',
        35000, 15000, 12000, 8000, 'start', null, now()-interval '12 days'),
    (j_gar,     v_owner, 'Garage Build — 88 Sand Creek',     'Westside Holdings','(518) 555-0204','build@westside.com',  '88 Sand Creek Rd, Colonie NY',
        25000, 11000, 8000, 6000, 'start', null, now()-interval '6 days');

  -- ---------- crew assignments ----------
  insert into public.project_workers (worker_id, project_id) values
    (v_mike,j_kitchen),(v_dave,j_kitchen),
    (v_mike,j_roof),(v_dave,j_roof),(v_carl,j_roof),
    (v_dave,j_bath),(v_tyler,j_bath),
    (v_mike,j_base),(v_carl,j_base),(v_tyler,j_base),
    (v_mike,j_side),(v_dave,j_side),(v_carl,j_side),
    (v_mike,j_deck),(v_tyler,j_deck),
    (v_carl,j_elec),
    (v_mike,j_add),(v_dave,j_add),(v_carl,j_add),(v_tyler,j_add),
    (v_dave,j_gar),(v_carl,j_gar)
  on conflict do nothing;

  -- ---------- receipts (every category, with sales tax, across 6 months) ----------
  insert into public.receipts (owner_id, project_id, description, store, amount, tax_amount, category, created_at) values
    (v_owner,j_kitchen,'Cabinets & lumber','Home Depot',          1840.00,147.20,'materials',  now()-interval '165 days'),
    (v_owner,j_kitchen,'Sink & faucet','Ferguson',                 620.50, 49.64,'materials',  now()-interval '162 days'),
    (v_owner,j_kitchen,'Paint & misc','Lowe''s',                   215.30, 17.22,'supplies',   now()-interval '158 days'),
    (v_owner,j_kitchen,'Gas — supply runs','Stewart''s',            58.20,  0.00,'fuel',       now()-interval '156 days'),
    (v_owner,j_kitchen,'Countertop install (sub)','Capital Stone',1200.00, 0.00,'subcontractor',now()-interval '154 days'),
    (v_owner,j_roof,   'Shingles & underlayment','ABC Supply',     4200.00,336.00,'materials',  now()-interval '136 days'),
    (v_owner,j_roof,   'Dumpster rental','Twin Bridges Waste',      385.00, 30.80,'equipment',  now()-interval '134 days'),
    (v_owner,j_roof,   'Gas — material haul','Mobil',                72.40,  0.00,'fuel',       now()-interval '132 days'),
    (v_owner,j_roof,   'Crew lunch','Subway',                        46.80,  3.74,'meals',      now()-interval '130 days'),
    (v_owner,j_bath,   'Bath fixtures','Ferguson Plumbing',          980.00, 78.40,'materials',  now()-interval '106 days'),
    (v_owner,j_bath,   'Plumbing permit','City of Troy',             185.00,  0.00,'permits',    now()-interval '104 days'),
    (v_owner,j_bath,   'Tile & grout','Floor & Decor',              430.00, 34.40,'materials',  now()-interval '101 days'),
    (v_owner,j_base,   'Framing lumber','84 Lumber',               2100.00,168.00,'materials',  now()-interval '86 days'),
    (v_owner,j_base,   'Drywall & insulation','Home Depot',         1340.00,107.20,'materials',  now()-interval '83 days'),
    (v_owner,j_base,   'Egress window (sub)','Capital Glass',        850.00,  0.00,'subcontractor',now()-interval '80 days'),
    (v_owner,j_base,   'Tool rental — nailer','Sunbelt',            120.00,  9.60,'equipment',  now()-interval '78 days'),
    (v_owner,j_side,   'Vinyl siding & trim','ABC Supply',          5200.00,416.00,'materials',  now()-interval '56 days'),
    (v_owner,j_side,   'Housewrap & fasteners','Home Depot',         640.00, 51.20,'supplies',   now()-interval '53 days'),
    (v_owner,j_side,   'Gas — daily','Stewart''s',                    91.10,  0.00,'fuel',       now()-interval '50 days'),
    (v_owner,j_deck,   'PT lumber & joist hangers','84 Lumber',     1480.00,118.40,'materials',  now()-interval '24 days'),
    (v_owner,j_deck,   'Composite decking','Lowe''s',               1320.00,105.60,'materials',  now()-interval '12 days'),
    (v_owner,j_deck,   'Concrete for footings','Home Depot',         210.00, 16.80,'materials',  now()-interval '20 days'),
    (v_owner,j_elec,   'Panel & breakers','Capital Electric Supply',1240.00, 99.20,'materials',  now()-interval '16 days'),
    (v_owner,j_elec,   'Wire & conduit','Capital Electric Supply',   360.00, 28.80,'materials',  now()-interval '9 days'),
    (v_owner,j_add,    'Deposit — engineered trusses','Build Supply',900.00, 72.00,'materials',  now()-interval '8 days');

  -- ---------- time entries (GPS, clocked out) via generate_series per job ----------
  -- helper: 8h weekday shifts; labor_cost = 8 * rate
  insert into public.time_entries (worker_id, project_id, clocked_in_at, clocked_out_at, total_minutes, labor_cost, gps_lat, gps_lng)
  select w.wid, j.jid,
         gs.gd::date + time '08:00', gs.gd::date + time '16:00', 480, 8*w.rate, glat, glng
  from (values
      (j_kitchen, (current_date-168)::date, (current_date-153)::date),
      (j_roof,    (current_date-138)::date, (current_date-123)::date),
      (j_bath,    (current_date-108)::date, (current_date-97)::date),
      (j_base,    (current_date-88)::date,  (current_date-72)::date),
      (j_side,    (current_date-58)::date,  (current_date-42)::date),
      (j_deck,    (current_date-26)::date,  (current_date-2)::date),
      (j_elec,    (current_date-16)::date,  (current_date-2)::date)
    ) as j(jid, dstart, dend)
  cross join (values (v_mike,32),(v_dave,28),(v_carl,30),(v_tyler,24)) as w(wid, rate)
  cross join lateral generate_series(j.dstart::timestamp, j.dend::timestamp, interval '3 days') as gs(gd)
  where extract(dow from gs.gd) between 1 and 5
    and exists (select 1 from public.project_workers pw where pw.project_id = j.jid and pw.worker_id = w.wid);

  -- ---------- mileage ----------
  insert into public.mileage_entries (owner_id, project_id, trip_date, miles, rate, notes) values
    (v_owner,j_kitchen,current_date-164,48,0.70,'Cabinet pickup — Home Depot'),
    (v_owner,j_roof,   current_date-135,65,0.70,'Roofing supplier haul'),
    (v_owner,j_base,   current_date-85, 32,0.70,'Lumber run — 84 Lumber'),
    (v_owner,j_side,   current_date-55, 41,0.70,'Siding pickup — ABC Supply'),
    (v_owner,j_deck,   current_date-22, 28,0.70,'Decking pickup — Lowe''s'),
    (v_owner,j_elec,   current_date-15, 19,0.70,'Supply run — Capital Electric');

  -- ---------- paychecks (older weeks paid; nothing forced for current week) ----------
  insert into public.paychecks (owner_id, worker_id, week_start, week_end, total_minutes, hourly_rate, gross_pay, paid_at) values
    (v_owner,v_mike,(current_date-168),(current_date-162),1920,32,1024.00,(current_date-161)::timestamp),
    (v_owner,v_dave,(current_date-168),(current_date-162),1920,28, 896.00,(current_date-161)::timestamp),
    (v_owner,v_mike,(current_date-138),(current_date-132),1440,32, 768.00,(current_date-131)::timestamp),
    (v_owner,v_carl,(current_date-138),(current_date-132),1440,30, 720.00,(current_date-131)::timestamp),
    (v_owner,v_mike,(current_date-58),(current_date-52),1920,32,1024.00,(current_date-51)::timestamp),
    (v_owner,v_dave,(current_date-58),(current_date-52),1920,28, 896.00,(current_date-51)::timestamp);

  -- ---------- schedule (upcoming this/next week) ----------
  insert into public.schedule_entries (owner_id, worker_id, project_id, task_description, scheduled_date, start_time, end_time) values
    (v_owner,v_mike, j_deck,'Frame deck + set posts',     current_date+1,'08:00','16:00'),
    (v_owner,v_tyler,j_deck,'Help frame + cleanup',        current_date+1,'08:00','15:00'),
    (v_owner,v_carl, j_elec,'Pull new circuits',           current_date+2,'07:30','15:30'),
    (v_owner,v_dave, j_gar, 'Layout + footing dig',        current_date+3,'08:00','16:00'),
    (v_owner,v_mike, j_add, 'Demo existing porch',         current_date+4,'08:00','16:00');

  -- ---------- estimates (mix of statuses; one accepted -> linked job) ----------
  insert into public.estimates (owner_id, project_id, client_name, client_phone, client_email, title, items, tax_rate, notes, status, created_at) values
    (v_owner, j_gar, 'Westside Holdings','(518) 555-0204','build@westside.com','24x24 Detached Garage',
       '[{"desc":"Slab + foundation","qty":1,"unit_price":6500,"kind":"materials"},{"desc":"Framing + roof","qty":1,"unit_price":9000,"kind":"labor"},{"desc":"Siding + doors","qty":1,"unit_price":5500,"kind":"materials"}]'::jsonb,
       8.0,'Accepted — converted to job.','accepted', now()-interval '9 days'),
    (v_owner, null, 'Nguyen Family','(518) 555-0221','nguyen@gmail.com','Front Porch Rebuild',
       '[{"desc":"Tear-off + footings","qty":1,"unit_price":2200,"kind":"labor"},{"desc":"Composite porch + rails","qty":1,"unit_price":4800,"kind":"materials"}]'::jsonb,
       8.0,'Sent — waiting on homeowner.','sent', now()-interval '4 days'),
    (v_owner, null, 'Capital Diner','(518) 555-0233','owner@capdiner.com','Kitchen Floor Retile',
       '[{"desc":"Demo old tile","qty":1,"unit_price":900,"kind":"labor"},{"desc":"Commercial tile + setting","qty":1,"unit_price":3100,"kind":"materials"}]'::jsonb,
       8.0,'Draft.','draft', now()-interval '1 days');

  -- ---------- invoices (completed jobs paid; one deposit outstanding) ----------
  insert into public.invoices (owner_id, project_id, label, amount, issued_date, due_date, status, paid_at, notes) values
    (v_owner,j_kitchen,'Final — Kitchen Remodel',14000,current_date-149,current_date-135,'paid',(current_date-140)::timestamp,'Paid in full, thank you!'),
    (v_owner,j_roof,   'Final — Roof Replacement',17500,current_date-119,current_date-105,'paid',(current_date-110)::timestamp,null),
    (v_owner,j_bath,   'Final — Bathroom Reno',5500,current_date-94,current_date-80,'paid',(current_date-88)::timestamp,null),
    (v_owner,j_base,   'Final — Basement Finish',17500,current_date-69,current_date-55,'paid',(current_date-60)::timestamp,null),
    (v_owner,j_side,   'Final — Siding Replacement',16500,current_date-39,current_date-25,'paid',(current_date-30)::timestamp,null),
    (v_owner,j_deck,   'Deposit (50%) — Deck Build',6250,current_date-28,current_date-14,'paid',(current_date-25)::timestamp,'Balance due on completion.'),
    (v_owner,j_add,    'Deposit (30%) — Addition',10500,current_date-10,current_date+4,'unpaid',null,'Mobilization deposit.');

  -- ---------- change orders ----------
  insert into public.change_orders (owner_id, project_id, description, amount, status, created_at) values
    (v_owner,j_base,'Add recessed lighting (6 cans)',1200,'approved',now()-interval '78 days'),
    (v_owner,j_deck,'Upgrade to composite railing',  850,'approved',now()-interval '10 days'),
    (v_owner,j_elec,'Add EV charger circuit',         600,'pending', now()-interval '6 days');

  -- ---------- daily logs ----------
  insert into public.daily_logs (owner_id, project_id, log_date, weather, note, created_at) values
    (v_owner,j_deck,current_date-3,'Sunny, 72°','Set all footings, framing started. On schedule.',now()-interval '3 days'),
    (v_owner,j_deck,current_date-2,'Overcast','Joists in. Composite delivered.',now()-interval '2 days'),
    (v_owner,j_elec,current_date-2,'Clear','Panel swap done, inspection scheduled.',now()-interval '2 days'),
    (v_owner,j_add, current_date-1,'Light rain','Demo of old porch complete; dumpster full.',now()-interval '1 days');

  -- ---------- job photos (placeholder image URLs so the gallery actually shows) ----------
  insert into public.job_photos (owner_id, project_id, photo_url, caption, created_at) values
    (v_owner,j_kitchen,'https://picsum.photos/seed/runsite-kitchen1/900/700','Before — old kitchen',now()-interval '168 days'),
    (v_owner,j_kitchen,'https://picsum.photos/seed/runsite-kitchen2/900/700','After — finished',now()-interval '151 days'),
    (v_owner,j_roof,   'https://picsum.photos/seed/runsite-roof1/900/700','Tear-off in progress',now()-interval '135 days'),
    (v_owner,j_base,   'https://picsum.photos/seed/runsite-base1/900/700','Framing done',now()-interval '80 days'),
    (v_owner,j_deck,   'https://picsum.photos/seed/runsite-deck1/900/700','Footings set',now()-interval '3 days'),
    (v_owner,j_deck,   'https://picsum.photos/seed/runsite-deck2/900/700','Joists in',now()-interval '2 days');

  -- ---------- punch + material lists (active jobs) ----------
  insert into public.punch_items (owner_id, project_id, description, done, created_at) values
    (v_owner,j_deck,'Install stair stringers',false,now()-interval '2 days'),
    (v_owner,j_deck,'Final railing hardware',false,now()-interval '2 days'),
    (v_owner,j_deck,'Set footings',true,now()-interval '3 days'),
    (v_owner,j_elec,'Schedule town inspection',false,now()-interval '2 days'),
    (v_owner,j_add, 'Order windows',false,now()-interval '1 days');
  insert into public.material_items (owner_id, project_id, name, qty, bought, created_at) values
    (v_owner,j_deck,'Joist hangers','40',true,now()-interval '20 days'),
    (v_owner,j_deck,'Composite boards','1x12 — 24 pcs',true,now()-interval '12 days'),
    (v_owner,j_gar, 'Concrete bags','60',false,now()-interval '5 days'),
    (v_owner,j_add, 'LVL beams','3',false,now()-interval '8 days');

  raise notice 'Showcase seeded: Summit Build Co (demo-owner@runsite-demo.com / RunSiteDemo!26).';
end $$;
