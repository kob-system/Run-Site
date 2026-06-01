-- ============================================================
-- RUN-SITE — DATABASE MIGRATION #6 (getting-paid + field features)
-- Run ONCE in Supabase → SQL Editor, AFTER FIX-DATABASE-5.
-- Safe to re-run (idempotent). Adds: client contact fields,
-- daily logs, change orders, job photos, and client invoices.
-- Job photo images reuse the existing private 'receipts' bucket.
-- ============================================================

-- ------------------------------------------------------------
-- 1. CLIENT CONTACT  (phone / email / address on the job)
-- ------------------------------------------------------------
alter table public.projects
  add column if not exists client_phone   text,
  add column if not exists client_email   text,
  add column if not exists client_address text;

-- ------------------------------------------------------------
-- 2. DAILY LOGS  (what happened on site that day)
-- ------------------------------------------------------------
create table if not exists public.daily_logs (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid references public.profiles(id) on delete cascade,
  project_id  uuid references public.projects(id) on delete cascade,
  log_date    date,
  weather     text,
  note        text,
  created_at  timestamptz default now()
);
alter table public.daily_logs enable row level security;
drop policy if exists "owner_manages_daily_logs" on public.daily_logs;
create policy "owner_manages_daily_logs" on public.daily_logs
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create index if not exists idx_daily_logs_project on public.daily_logs(project_id);
create index if not exists idx_daily_logs_owner   on public.daily_logs(owner_id);

-- ------------------------------------------------------------
-- 3. CHANGE ORDERS  (extra work / scope changes the client pays for)
-- Approved change orders add to what the client owes (the contract price).
-- ------------------------------------------------------------
create table if not exists public.change_orders (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid references public.profiles(id) on delete cascade,
  project_id  uuid references public.projects(id) on delete cascade,
  description text,
  amount      numeric not null default 0,
  status      text not null default 'pending',   -- pending | approved | declined
  created_at  timestamptz default now()
);
alter table public.change_orders enable row level security;
drop policy if exists "owner_manages_change_orders" on public.change_orders;
create policy "owner_manages_change_orders" on public.change_orders
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create index if not exists idx_change_orders_project on public.change_orders(project_id);
create index if not exists idx_change_orders_owner   on public.change_orders(owner_id);

-- ------------------------------------------------------------
-- 4. JOB PHOTOS  (progress / before-after; image lives in the
-- private 'receipts' storage bucket, or photo_url may be a full URL)
-- ------------------------------------------------------------
create table if not exists public.job_photos (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid references public.profiles(id) on delete cascade,
  project_id  uuid references public.projects(id) on delete cascade,
  photo_url   text,
  caption     text,
  created_at  timestamptz default now()
);
alter table public.job_photos enable row level security;
drop policy if exists "owner_manages_job_photos" on public.job_photos;
create policy "owner_manages_job_photos" on public.job_photos
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create index if not exists idx_job_photos_project on public.job_photos(project_id);
create index if not exists idx_job_photos_owner   on public.job_photos(owner_id);

-- ------------------------------------------------------------
-- 5. INVOICES  (what the client owes / has paid)
-- ------------------------------------------------------------
create table if not exists public.invoices (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid references public.profiles(id) on delete cascade,
  project_id   uuid references public.projects(id) on delete cascade,
  label        text,
  amount       numeric not null default 0,
  issued_date  date,
  due_date     date,
  status       text not null default 'unpaid',   -- unpaid | paid
  paid_at      timestamptz,
  notes        text,
  created_at   timestamptz default now()
);
alter table public.invoices enable row level security;
drop policy if exists "owner_manages_invoices" on public.invoices;
create policy "owner_manages_invoices" on public.invoices
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create index if not exists idx_invoices_project on public.invoices(project_id);
create index if not exists idx_invoices_owner   on public.invoices(owner_id);

-- ============================================================
-- DONE. Run BEFORE deploying the contractor-features app build.
-- ============================================================
