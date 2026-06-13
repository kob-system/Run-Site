-- ============================================================
-- FIX-DATABASE-10 — let crew (workers) add jobsite photos
-- ============================================================
-- Why: today only the owner can add job photos. job_photos has a
-- single owner-only policy ("owner_manages_job_photos": owner_id =
-- auth.uid()), so a worker's INSERT is rejected — their auth.uid()
-- is their own profile id, not the owner's. This adds worker-scoped
-- policies so an *assigned* worker can add photos to a job and see
-- the job's photos, without touching the owner's existing access.
--
-- Storage note: the worker app uploads the image under the OWNER's
-- folder (`${owner_id}/jobphotos/...`) in the private 'receipts'
-- bucket. The existing `auth_upload_receipts` policy already lets any
-- authenticated user upload, and `receipts_authed_read` lets the
-- owner read files under their own folder — so the owner sees the
-- photo with no storage-policy change. (Workers don't read the file
-- back; they just send it to the boss.)
--
-- Mirrors the worker-scoped pattern used for time_entries in
-- FIX-DATABASE-4 (assignment checked via project_workers).
-- Safe to run multiple times (drop-if-exists guards). Apply in the
-- Supabase SQL editor BEFORE deploying the worker-photo code.
-- ------------------------------------------------------------

-- Assigned worker can ADD a photo to a job they're on. owner_id must
-- match the project's real owner so the row stays correctly tenanted
-- (and the owner can read it) — a worker can't smuggle a photo onto
-- another company's project or mislabel the owner.
drop policy if exists "worker_insert_job_photos" on public.job_photos;
create policy "worker_insert_job_photos" on public.job_photos
  for insert with check (
    project_id in (
      select project_id from public.project_workers where worker_id = auth.uid()
    )
    and owner_id = (
      select p.owner_id from public.projects p where p.id = project_id
    )
  );

-- Assigned worker can SEE the photo rows for their jobs (the owner's
-- existing "owner_manages_job_photos" ALL policy is left untouched).
drop policy if exists "worker_select_job_photos" on public.job_photos;
create policy "worker_select_job_photos" on public.job_photos
  for select using (
    project_id in (
      select project_id from public.project_workers where worker_id = auth.uid()
    )
  );
