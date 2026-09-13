-- ============================================================
-- FIX-DATABASE-36: a photo or PDF on an insurance / license item
-- ============================================================
-- More → Insurance & Licenses stored only text and a date. Owners want to
-- keep the actual certificate or license with it: a photo from the phone
-- camera, or a PDF their agent sent.
--
-- WHAT THIS DOES: adds three nullable columns to public.compliance_items.
--   file_path  text   storage key in the private 'receipts' bucket
--   file_name  text   the name the owner picked (shown on the row)
--   file_type  text   MIME type, e.g. image/jpeg or application/pdf
-- Nothing else. No data is changed, no row is touched.
--
-- ROW ACCESS: unchanged. The existing "owner_manages_compliance_items"
-- policy (FIX-DATABASE-7, `owner_id = auth.uid()`, for all) already covers
-- the new columns.
--
-- STORAGE: no new policy needed. Files are written to
--   `<owner_id>/compliance/<ms>_<name>`
-- in the same private 'receipts' bucket job documents use
-- (`<owner_id>/docs/...`). That path is already covered by:
--   * receipts_tenant_scoped_upload (FIX-22): insert into your own folder
--   * receipts_authed_read          (FIX-4):  read only your own folder
-- The crew read policy (receipts_worker_read_jobphotos, FIX-22) only opens
-- the `jobphotos` subfolder, so a crew member can NOT open these files.
-- The app views them through short-lived signed URLs, same as documents.
--
-- Safe / idempotent: `add column if not exists`. Run it twice, nothing
-- happens the second time.
--
-- UNTIL THIS RUNS: the app still saves text-only items and edits. Saving
-- an item WITH a file fails loudly ("Nothing was saved") instead of quietly
-- dropping the file.
-- ------------------------------------------------------------

alter table public.compliance_items
  add column if not exists file_path text,
  add column if not exists file_name text,
  add column if not exists file_type text;

-- ------------------------------------------------------------
-- VERIFY (live REST API, no login needed, 30 seconds):
--   GET <SUPABASE_URL>/rest/v1/compliance_items?select=file_path,file_name,file_type&limit=0
--   with the anon key:  200 = columns exist · 400 (42703) = not run yet
--
-- Or in the SQL editor:
--   select column_name, data_type from information_schema.columns
--   where table_schema = 'public' and table_name = 'compliance_items'
--     and column_name in ('file_path','file_name','file_type');   -- expect 3 rows
-- ============================================================
