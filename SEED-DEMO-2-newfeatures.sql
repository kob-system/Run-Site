-- ============================================================
-- RUN-SITE — DEMO DATA SEED #2  (new contractor features)
-- Run in Supabase → SQL Editor AFTER FIX-DATABASE-6 and the
-- original demo seed. Adds client contact info, daily logs,
-- change orders, job photos, and invoices for the demo account.
-- Safe to re-run (skips if invoices already exist for the owner).
-- ============================================================
do $$
declare
  v_owner uuid;
  p_kitchen uuid; p_roof uuid; p_bath uuid; p_elec uuid;
begin
  select id into v_owner from auth.users
    where lower(email) = lower('Firstclasspropertyservices7@gmail.com') limit 1;
  if v_owner is null then
    raise exception 'No auth user for Firstclasspropertyservices7@gmail.com — sign up first.';
  end if;

  select id into p_kitchen from public.projects where owner_id = v_owner and name like 'Kitchen Remodel%'    limit 1;
  select id into p_roof    from public.projects where owner_id = v_owner and name like 'Roof Replacement%'    limit 1;
  select id into p_bath    from public.projects where owner_id = v_owner and name like 'Bathroom Plumbing%'   limit 1;
  select id into p_elec    from public.projects where owner_id = v_owner and name like 'Electrical Panel%'    limit 1;

  if exists (select 1 from public.invoices where owner_id = v_owner) then
    raise notice 'New-feature demo data already seeded. Skipping.';
    return;
  end if;

  -- ---- client contact on each job ----
  update public.projects set client_phone = '(518) 555-0142', client_email = 'sarah.whitman@gmail.com',    client_address = '24 Pinewood Dr, Troy, NY 12180'  where id = p_kitchen;
  update public.projects set client_phone = '(518) 555-0188', client_email = 'rdaly@gmail.com',            client_address = '8 Maple Ave, Troy, NY 12180'     where id = p_roof;
  update public.projects set client_phone = '(518) 555-0167', client_email = 'manager@greenfieldapts.com', client_address = '112 Hoosick St, Troy, NY 12180'   where id = p_bath;
  update public.projects set client_phone = '(518) 555-0123', client_email = 'ops@troylofts.com',          client_address = '305 Congress St, Troy, NY 12180'  where id = p_elec;

  -- ---- daily logs ----
  insert into public.daily_logs (owner_id, project_id, log_date, weather, note) values
    (v_owner, p_kitchen, current_date - 2, 'Sunny, 68°',    'Demo''d old cabinets and hauled out. Found water damage under the sink — patched the subfloor. Homeowner approved the extra.'),
    (v_owner, p_kitchen, current_date - 1, 'Cloudy, 60°',   'Ran new outlets for the island. Cabinet delivery confirmed for Thursday.'),
    (v_owner, p_roof,    current_date - 6, 'Clear, 72°',     'Tore off old shingles, dried in with underlayment. Decking solid except a few sheets.'),
    (v_owner, p_roof,    current_date - 5, 'Light rain AM',  'Held off the morning for the rain, finished shingles in the afternoon. Job complete.'),
    (v_owner, p_bath,    current_date - 1, 'Sunny, 65°',     'Rough plumbing in for the vanity. Inspector scheduled for Monday.'),
    (v_owner, p_elec,    current_date - 1, 'Cold, 45°',      'Pulled the meter and set the new 200A panel. Power back on by 3pm.');

  -- ---- change orders (approved ones add to the contract + profit) ----
  insert into public.change_orders (owner_id, project_id, description, amount, status) values
    (v_owner, p_kitchen, 'Repair water-damaged subfloor under sink', 650.00,  'approved'),
    (v_owner, p_kitchen, 'Upgrade to quartz countertop',            1800.00,  'pending'),
    (v_owner, p_bath,    'Add second shut-off valve',                180.00,  'approved'),
    (v_owner, p_elec,    'Add EV charger circuit in garage',        1200.00,  'approved'),
    (v_owner, p_roof,    'Replace 3 sheets of rotted decking',       420.00,  'approved');

  -- ---- job photos (real demo images; uploads go to the private bucket) ----
  insert into public.job_photos (owner_id, project_id, photo_url, caption, created_at) values
    (v_owner, p_kitchen, 'https://images.unsplash.com/photo-1556911220-bff31c812dba?w=800&q=70', 'Before — old kitchen', now() - interval '15 days'),
    (v_owner, p_kitchen, 'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=800&q=70', 'Cabinets going in',    now() - interval '2 days'),
    (v_owner, p_roof,    'https://images.unsplash.com/photo-1632759145351-1d592919f522?w=800&q=70', 'New shingles done',  now() - interval '5 days'),
    (v_owner, p_bath,    'https://images.unsplash.com/photo-1620626011761-996317b8d101?w=800&q=70', 'Rough plumbing in',  now() - interval '1 days'),
    (v_owner, p_elec,    'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&q=70',  'New 200A panel',      now() - interval '1 days');

  -- ---- invoices (deposits paid, progress/final outstanding) ----
  insert into public.invoices (owner_id, project_id, label, amount, issued_date, due_date, status, paid_at) values
    (v_owner, p_kitchen, 'Deposit (50%)', 7000.00, current_date - 20, current_date - 13, 'paid',   (current_date - 14)::timestamp),
    (v_owner, p_kitchen, 'Progress draw', 4000.00, current_date - 5,  current_date + 2,  'unpaid', null),
    (v_owner, p_roof,    'Deposit',       8000.00, current_date - 30, current_date - 23, 'paid',   (current_date - 24)::timestamp),
    (v_owner, p_roof,    'Final invoice', 9500.00, current_date - 5,  current_date + 5,  'unpaid', null),
    (v_owner, p_bath,    'Deposit',       2500.00, current_date - 6,  current_date + 1,  'unpaid', null),
    (v_owner, p_elec,    'Deposit (50%)', 3000.00, current_date - 12, current_date - 5,  'paid',   (current_date - 6)::timestamp);

  raise notice 'New-feature demo data seeded for First Class Property Services.';
end $$;
