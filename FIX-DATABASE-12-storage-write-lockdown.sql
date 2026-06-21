-- ============================================================
-- FIX-DATABASE-12-storage-write-lockdown.sql
-- Tenant-scope WRITES to the private 'receipts' storage bucket.
--
-- THE HOLE (pre-existing): the insert policies allowed ANY authenticated user to
-- upload into ANY path of the receipts bucket. Worse, a LIVE-DB audit (2026-06-20)
-- found TWO extra policies created in the Supabase UI that are in no migration:
--   * "Authenticated users can upload receipts" (INSERT, loose — same hole again)
--   * "Receipt photos are publicly viewable"    (SELECT, using bucket_id='receipts'
--      for role public) — a CROSS-TENANT READ LEAK. Because RLS policies are OR'd,
--      this permissive read overrode the correct own-folder "receipts_authed_read",
--      so any key could read any tenant's receipts by path (the private bucket only
--      hides the public CDN URL; the storage API still honored this policy).
-- This migration removes ALL of those and leaves exactly one read + one write policy.
--
-- THE LAYOUT (do NOT change app code — uploads keep their current paths):
--   * Owners upload under  <owner_uid>/...        (their own folder)
--   * Workers upload under <project.owner_id>/...  (the OWNER's folder, so the
--     owner can read crew job photos via the existing own-folder read policy).
--
-- THE FIX: replace the open insert policy with one that allows a write only when
-- the first path segment (the folder) is EITHER the caller's own uid (owner case)
-- OR the owner_id of a project the caller is assigned to (worker case). This
-- closes cross-tenant writes without breaking owner reads of worker photos and
-- without any client change.
--
-- RUN ORDER: requires FIX-DATABASE-4 (private bucket + receipts_authed_read)
-- already applied. Safe / idempotent to re-run.
--
-- POST-APPLY RE-TEST (because this now governs worker writes):
--   1) As an OWNER: scan a receipt / add a job photo / upload a document → succeeds.
--   2) As a WORKER assigned to a job: add a jobsite photo → succeeds.
--   3) Confirm the owner can still open that worker's photo.
-- ============================================================

-- Remove every loose / legacy receipts policy (repo-created AND UI-created).
drop policy if exists "auth_upload_receipts"                     on storage.objects;
drop policy if exists "auth_upload_own_folder"                   on storage.objects;
drop policy if exists "Authenticated users can upload receipts"  on storage.objects;
drop policy if exists "Receipt photos are publicly viewable"     on storage.objects;
drop policy if exists "receipts_tenant_scoped_upload"            on storage.objects;

create policy "receipts_tenant_scoped_upload" on storage.objects
  for insert with check (
    bucket_id = 'receipts'
    and auth.role() = 'authenticated'
    and (
      -- Owner writing into their own folder.
      (storage.foldername(name))[1] = auth.uid()::text
      or
      -- Worker writing into the folder of an owner whose project they're on.
      exists (
        select 1
        from public.project_workers pw
        join public.projects p on p.id = pw.project_id
        where pw.worker_id = auth.uid()
          and p.owner_id::text = (storage.foldername(name))[1]
      )
    )
  );

-- ------------------------------------------------------------
-- VERIFY (run after applying):
--   bucket is private:
--     select id, public from storage.buckets where id = 'receipts';   -- public must be false
--   the loose policy is gone and only the scoped one remains for inserts:
--     select policyname, cmd from pg_policies
--     where schemaname = 'storage' and tablename = 'objects';
-- ------------------------------------------------------------
