-- ============================================================
-- FIX-DATABASE-22 — fix `name` column shadowing in storage policies
-- ============================================================
-- BUG (pre-existing, prod): the worker-upload branch of the storage
-- INSERT policy `receipts_tenant_scoped_upload` matched the owner folder
-- with `(storage.foldername(name))[1]` INSIDE a subquery that joins
-- `public.projects` — which has its own `name` column. Postgres bound
-- the unqualified `name` to `projects.name` (the project's DISPLAY name,
-- e.g. "Kitchen Remodel"), NOT the storage object's path. So the owner-
-- folder match could never be true and an assigned WORKER's upload to
-- `<owner_id>/jobphotos/...` was rejected (HTTP 400). Owners were fine —
-- their uploads hit the own-folder OR-branch, which is OUTSIDE the
-- subquery and binds `name` correctly. Net effect: crew photo upload has
-- been silently broken since FIX-DATABASE-10.
--
-- FIX-DATABASE-21's new READ policy inherited the identical bug
-- (`(storage.foldername(name))[1]` inside the same join), so worker
-- view-back would have failed too.
--
-- FIX: qualify the storage object explicitly as `objects.name` so the
-- reference inside the subquery correlates to the OUTER storage.objects
-- row instead of being shadowed by projects.name.
--
-- Safe / idempotent. Apply in Supabase SQL editor (or via the mgmt API).
-- No app code change needed — this is purely a policy correction.
-- ------------------------------------------------------------

-- (1) Upload: assigned worker can write into their owner's jobphotos
--     folder; anyone can write into their own folder. Only the subquery
--     ref needed qualifying, but we qualify both for clarity.
drop policy if exists "receipts_tenant_scoped_upload" on storage.objects;
create policy "receipts_tenant_scoped_upload" on storage.objects
  for insert with check (
    bucket_id = 'receipts'
    and auth.role() = 'authenticated'
    and (
      (storage.foldername(objects.name))[1] = auth.uid()::text
      or exists (
        select 1
        from public.project_workers pw
        join public.projects p on p.id = pw.project_id
        where pw.worker_id = auth.uid()
          and p.owner_id::text = (storage.foldername(objects.name))[1]
      )
    )
  );

-- (2) Read-back: assigned worker can sign their owner's jobphotos ONLY
--     (never receipts/documents — see FIX-21 for the scoping rationale).
drop policy if exists "receipts_worker_read_jobphotos" on storage.objects;
create policy "receipts_worker_read_jobphotos" on storage.objects
  for select using (
    bucket_id = 'receipts'
    and (storage.foldername(objects.name))[2] = 'jobphotos'
    and exists (
      select 1
      from public.project_workers pw
      join public.projects p on p.id = pw.project_id
      where pw.worker_id = auth.uid()
        and p.owner_id::text = (storage.foldername(objects.name))[1]
    )
  );

-- ------------------------------------------------------------
-- VERIFY: the stored policy text should now show unqualified `name`
-- (which correctly binds to storage.objects) rather than `p.name`:
--   select policyname, cmd, qual, with_check from pg_policies
--   where schemaname='storage' and tablename='objects'
--     and policyname in ('receipts_tenant_scoped_upload',
--                        'receipts_worker_read_jobphotos');
-- ============================================================
