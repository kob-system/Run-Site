-- FIX-DATABASE-25 — receipts.purchase_date
--
-- WHY: /api/scan-receipt already reads FOUR fields off the photo (store, amount,
-- tax, date) but the app had nowhere to put the date, so every receipt was dated
-- by created_at — the moment it was typed in. A December 28 receipt entered on
-- January 3 landed in the WRONG TAX YEAR on the Tax Pack export, with the
-- owner's name on the filing.
--
-- Safe to re-run. Additive only: no drops, no policy changes, no data loss.
-- RLS is untouched — purchase_date inherits the existing receipts policies.

-- 1. The column.
alter table public.receipts
  add column if not exists purchase_date date;

-- 2. Backfill every existing row from created_at so no receipt is dateless.
--    ::date on a timestamptz uses the session TZ; force UTC for a deterministic
--    result no matter who runs this.
update public.receipts
   set purchase_date = (created_at at time zone 'utc')::date
 where purchase_date is null;

-- 3. Default for anything that omits it (e.g. the AI assistant's add_expense,
--    which has no date argument). The dashboard sends the owner's LOCAL today.
alter table public.receipts
  alter column purchase_date set default current_date;

-- 4. Lock it. NOT NULL is what lets the Tax Pack filter on purchase_date without
--    silently dropping rows. NOTE: because the column is NOT NULL WITH a default,
--    an INSERT must OMIT the key to get the default — passing an explicit NULL
--    still errors. The client never sends null (it sends localToday()).
alter table public.receipts
  alter column purchase_date set not null;

-- 5. The Tax Pack scans a whole year for one owner. Without this it is a seq scan
--    on every receipt the account has ever created.
create index if not exists receipts_owner_purchase_date_idx
  on public.receipts (owner_id, purchase_date);

-- VERIFY
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--    where table_schema='public' and table_name='receipts' and column_name='purchase_date';
--   -- expect: date | NO | CURRENT_DATE
--   select count(*) from public.receipts where purchase_date is null;  -- expect 0
