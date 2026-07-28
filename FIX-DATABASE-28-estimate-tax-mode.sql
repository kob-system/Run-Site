-- ============================================================
-- FIX-DATABASE-28-estimate-tax-mode.sql
-- Stop charging the client sales tax on labor.
--
-- WHY THIS FILE EXISTS:
-- The estimate total was computed as:
--     total = subtotal + subtotal * tax_rate / 100
-- i.e. tax on EVERYTHING, labor included. On a $12,000 job with $7,000 of
-- labor at 8%, that overcharges the customer ~$560 of tax the contractor then
-- has to remit or refund. Silent, on every quote the app has ever produced.
--
-- Taxability is a property of the JOB, not of the line item. New York is the
-- clean example (Publication 862 / Form ST-124):
--   capital improvement -> charge the customer NO sales tax at all
--   repair / maintenance -> the ENTIRE charge is taxable, labor included
-- Most other states instead tax materials and exempt labor.
--
-- So: one column, three values, chosen once per estimate. No per-line taxable
-- checkbox — that asks the contractor to know the rule fifteen times per quote
-- instead of once.
--
-- 'materials' is the default because it is the safest answer for a first-time
-- user in an unknown state, and because it is what every existing row was
-- closest to being (existing rows were taxing labor too, which is never right).
--
-- The app tolerates this column being absent — OwnerDashboard falls back to
-- 'materials' — so the UI can ship before this runs. Idempotent; safe to re-run.
-- ============================================================

alter table public.estimates
  add column if not exists tax_mode text not null default 'materials';

-- Named constraint so re-running is a no-op rather than a duplicate.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'estimates_tax_mode_check'
      and conrelid = 'public.estimates'::regclass
  ) then
    alter table public.estimates
      add constraint estimates_tax_mode_check
      check (tax_mode in ('materials', 'repair', 'capital'));
  end if;
end $$;

-- Backfill: rows written before this column existed. The default already
-- covers add-column, but this catches any row a prior partial run left null.
update public.estimates set tax_mode = 'materials' where tax_mode is null;

comment on column public.estimates.tax_mode is
  'What the sales tax applies to: materials = tax materials only (labor exempt, the usual multi-state rule); repair = tax the whole charge incl. labor (NY repair/maintenance); capital = charge no sales tax at all (NY capital improvement, Form ST-124).';

-- No RLS change. estimates already carries the owner-only policy and this is
-- just another column on rows the owner already owns.

-- ------------------------------------------------------------
-- VERIFY (run after applying)
-- ------------------------------------------------------------
-- 1) Column exists with the right default:
--
-- select column_name, data_type, column_default, is_nullable
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'estimates'
--   and column_name = 'tax_mode';
--
-- 2) Constraint is in place:
--
-- select conname, pg_get_constraintdef(oid)
-- from pg_constraint
-- where conrelid = 'public.estimates'::regclass
--   and conname = 'estimates_tax_mode_check';
--
-- 3) Every existing estimate got a value (expect 0 rows):
--
-- select count(*) from public.estimates where tax_mode is null;
--
-- 4) A bad value is rejected (expect an error, not a row):
--
-- update public.estimates set tax_mode = 'whatever' where false;
