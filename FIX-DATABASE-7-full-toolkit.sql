-- ============================================================
-- RUN-SITE — DATABASE MIGRATION #7 (full contractor toolkit)
-- Run ONCE in Supabase → SQL Editor, AFTER FIX-DATABASE-6.
-- Safe to re-run (idempotent). Creates the tables for the whole
-- feature roadmap up front; each feature's UI ships separately.
-- Files (documents) reuse the existing private 'receipts' bucket.
-- ============================================================

-- ------------------------------------------------------------
-- ESTIMATES / QUOTES  (line items stored as JSON: [{desc, qty, unit_price, kind}])
-- "Accept" creates a job; project_id links the two once accepted.
-- ------------------------------------------------------------
create table if not exists public.estimates (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid references public.profiles(id) on delete cascade,
  project_id    uuid references public.projects(id) on delete set null,
  client_name   text,
  client_phone  text,
  client_email  text,
  title         text,
  items         jsonb not null default '[]'::jsonb,
  tax_rate      numeric not null default 0,   -- percent
  notes         text,
  status        text not null default 'draft', -- draft | sent | accepted | declined
  created_at    timestamptz default now()
);
alter table public.estimates enable row level security;
drop policy if exists "owner_manages_estimates" on public.estimates;
create policy "owner_manages_estimates" on public.estimates
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create index if not exists idx_estimates_owner on public.estimates(owner_id);

-- ------------------------------------------------------------
-- PUNCH LIST  (remaining to-do items per job)
-- ------------------------------------------------------------
create table if not exists public.punch_items (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid references public.profiles(id) on delete cascade,
  project_id   uuid references public.projects(id) on delete cascade,
  description  text,
  done         boolean not null default false,
  created_at   timestamptz default now()
);
alter table public.punch_items enable row level security;
drop policy if exists "owner_manages_punch_items" on public.punch_items;
create policy "owner_manages_punch_items" on public.punch_items
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create index if not exists idx_punch_items_project on public.punch_items(project_id);
create index if not exists idx_punch_items_owner   on public.punch_items(owner_id);

-- ------------------------------------------------------------
-- MATERIALS / SHOPPING LIST  (what to buy per job; mark bought)
-- ------------------------------------------------------------
create table if not exists public.material_items (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid references public.profiles(id) on delete cascade,
  project_id   uuid references public.projects(id) on delete cascade,
  name         text,
  qty          text,
  bought       boolean not null default false,
  created_at   timestamptz default now()
);
alter table public.material_items enable row level security;
drop policy if exists "owner_manages_material_items" on public.material_items;
create policy "owner_manages_material_items" on public.material_items
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create index if not exists idx_material_items_project on public.material_items(project_id);
create index if not exists idx_material_items_owner   on public.material_items(owner_id);

-- ------------------------------------------------------------
-- JOB DOCUMENTS  (contracts, permits, plans; file in 'receipts' bucket)
-- ------------------------------------------------------------
create table if not exists public.job_documents (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid references public.profiles(id) on delete cascade,
  project_id   uuid references public.projects(id) on delete cascade,
  name         text,
  file_url     text,
  created_at   timestamptz default now()
);
alter table public.job_documents enable row level security;
drop policy if exists "owner_manages_job_documents" on public.job_documents;
create policy "owner_manages_job_documents" on public.job_documents
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create index if not exists idx_job_documents_project on public.job_documents(project_id);
create index if not exists idx_job_documents_owner   on public.job_documents(owner_id);

-- ------------------------------------------------------------
-- COMPLIANCE  (insurance / license / certification with expiry)
-- ------------------------------------------------------------
create table if not exists public.compliance_items (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid references public.profiles(id) on delete cascade,
  kind         text,            -- insurance | license | certification
  name         text,
  reference    text,            -- policy / license number
  expires_on   date,
  notes        text,
  created_at   timestamptz default now()
);
alter table public.compliance_items enable row level security;
drop policy if exists "owner_manages_compliance_items" on public.compliance_items;
create policy "owner_manages_compliance_items" on public.compliance_items
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create index if not exists idx_compliance_items_owner on public.compliance_items(owner_id);

-- ------------------------------------------------------------
-- PERMITS & INSPECTIONS  (status per job)
-- ------------------------------------------------------------
create table if not exists public.permits (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid references public.profiles(id) on delete cascade,
  project_id    uuid references public.projects(id) on delete cascade,
  name          text,
  status        text not null default 'applied', -- applied | approved | inspection | passed | failed
  permit_number text,
  inspection_on date,
  notes         text,
  created_at    timestamptz default now()
);
alter table public.permits enable row level security;
drop policy if exists "owner_manages_permits" on public.permits;
create policy "owner_manages_permits" on public.permits
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create index if not exists idx_permits_project on public.permits(project_id);
create index if not exists idx_permits_owner   on public.permits(owner_id);

-- ------------------------------------------------------------
-- WARRANTY / CALLBACKS  (post-completion follow-ups)
-- ------------------------------------------------------------
create table if not exists public.warranties (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid references public.profiles(id) on delete cascade,
  project_id   uuid references public.projects(id) on delete set null,
  description  text,
  status       text not null default 'open',   -- open | scheduled | closed
  due_on       date,
  created_at   timestamptz default now()
);
alter table public.warranties enable row level security;
drop policy if exists "owner_manages_warranties" on public.warranties;
create policy "owner_manages_warranties" on public.warranties
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create index if not exists idx_warranties_owner on public.warranties(owner_id);

-- ------------------------------------------------------------
-- INVOICE PAYMENT LINK  (paste your Stripe/Square/etc. link)
-- ------------------------------------------------------------
alter table public.invoices
  add column if not exists payment_link text;

-- ============================================================
-- DONE. All roadmap tables exist; ship each feature's UI next.
-- ============================================================
