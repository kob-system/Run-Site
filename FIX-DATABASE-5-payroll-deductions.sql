-- ============================================================
-- RUN-SITE — DATABASE MIGRATION #5 (payroll + deductions)
-- Run ONCE in Supabase → SQL Editor, AFTER FIX-DATABASE-4.
-- Safe to re-run (idempotent). Adds: receipt sales tax, a mileage
-- log (standard-mileage deduction), and weekly worker paychecks.
-- ============================================================

-- ------------------------------------------------------------
-- 1. RECEIPT SALES TAX
-- Capture the sales tax paid on each receipt so it can be totalled
-- for the tax pack. Existing rows default to 0.
-- ------------------------------------------------------------
alter table public.receipts
  add column if not exists tax_amount numeric not null default 0;

-- ------------------------------------------------------------
-- 2. MILEAGE LOG  (per job; miles × IRS standard rate = deduction)
-- ------------------------------------------------------------
create table if not exists public.mileage_entries (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid references public.profiles(id) on delete cascade,
  project_id  uuid references public.projects(id) on delete cascade,
  trip_date   date,
  miles       numeric not null default 0,
  rate        numeric not null default 0.70,   -- editable per entry; set to the current IRS rate
  notes       text,
  created_at  timestamptz default now()
);
alter table public.mileage_entries enable row level security;
drop policy if exists "owner_manages_mileage" on public.mileage_entries;
create policy "owner_manages_mileage" on public.mileage_entries
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create index if not exists idx_mileage_project on public.mileage_entries(project_id);
create index if not exists idx_mileage_owner   on public.mileage_entries(owner_id);

-- ------------------------------------------------------------
-- 3. PAYCHECKS  (weekly worker pay records)
-- A snapshot of one worker's pay for one week: hours, rate, gross,
-- and when it was marked paid. Owner manages; worker can view theirs.
-- ------------------------------------------------------------
create table if not exists public.paychecks (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid references public.profiles(id) on delete cascade,
  worker_id      uuid references public.profiles(id) on delete cascade,
  week_start     date,
  week_end       date,
  total_minutes  integer default 0,
  hourly_rate    numeric default 0,
  gross_pay      numeric not null default 0,
  paid_at        timestamptz,
  notes          text,
  created_at     timestamptz default now()
);
alter table public.paychecks enable row level security;
drop policy if exists "owner_manages_paychecks"   on public.paychecks;
drop policy if exists "worker_sees_own_paychecks" on public.paychecks;
create policy "owner_manages_paychecks" on public.paychecks
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "worker_sees_own_paychecks" on public.paychecks
  for select using (worker_id = auth.uid());
create index if not exists idx_paychecks_worker on public.paychecks(worker_id);
create index if not exists idx_paychecks_owner  on public.paychecks(owner_id);

-- ============================================================
-- DONE. Receipts now carry sales tax; mileage and weekly
-- paychecks are tracked per owner. Run BEFORE deploying the
-- payroll/deductions app build.
-- ============================================================
