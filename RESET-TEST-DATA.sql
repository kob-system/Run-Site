-- ============================================================
-- RUN-SITE — FULL TEST-DATA RESET
-- Run ONCE in Supabase → SQL Editor.
--
-- ⚠️  DESTRUCTIVE: this WIPES ALL business data AND ALL login
-- accounts so you can re-test signup from a clean slate. Only run
-- this while everything in the database is test data.
--
-- Order matters: delete child rows before parent rows so foreign
-- keys don't block the delete.
-- ============================================================

-- 1. Business data (children first)
delete from public.time_entries;
delete from public.receipts;
delete from public.schedule_entries;
delete from public.project_workers;
delete from public.projects;

-- 2. User profiles (the app's copy of each account)
delete from public.profiles;

-- 3. Login accounts (so signup can be re-tested fresh)
delete from auth.users;

-- ============================================================
-- DONE. Database is empty. Next signup starts the owner/worker
-- flow from scratch.
--
-- NOTE: Receipt photos in Storage can't be deleted via SQL
-- (Supabase blocks it). Clear them in the dashboard instead:
-- Storage → "receipts" bucket → select all → delete. Harmless
-- to leave them if you'd rather not bother.
-- ============================================================
