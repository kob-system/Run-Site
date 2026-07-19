-- ============================================================
-- FIX-DATABASE-21 — worker photo view-back + "who added it"
-- ============================================================
-- Context: workers can already ADD jobsite photos (FIX-DATABASE-10)
-- and owners see them under the job's Photos tab. This migration adds
-- the two polish pieces:
--   (a) a denormalized `uploaded_by_name` so the OWNER sees WHICH crew
--       member added each photo (no cross-table join / no profiles-RLS
--       dependency — the app writes the name at insert time), and
--   (b) a tightly-scoped storage READ policy so an assigned WORKER can
--       view the job's photos back in their own app (today they can
--       only fire-and-forget upload; FIX-DATABASE-10 left read out on
--       purpose to avoid touching storage policies).
--
-- Safe / idempotent to re-run. Apply in the Supabase SQL editor BEFORE
-- deploying the matching app code. (The app also degrades gracefully:
-- the insert retries without the column if this hasn't run yet, and
-- worker thumbnails fall back to a placeholder until the read policy
-- exists — nothing breaks either way.)
-- ------------------------------------------------------------

-- (a) Who added the photo. Denormalized text (not an FK) so the owner
-- read needs no join and no extra profiles read policy. Nullable so old
-- rows and the owner's own uploads ("You") are fine.
alter table public.job_photos add column if not exists uploaded_by_name text;

-- ------------------------------------------------------------
-- (b) Assigned worker can READ (sign) the job photos under their
-- owner's folder. Scoped THREE ways so this can NOT reopen the
-- cross-tenant receipt leak that FIX-DATABASE-12 closed:
--   1. bucket must be 'receipts'
--   2. the file must live in a `.../jobphotos/...` path — this EXCLUDES
--      receipts (stored at `<owner>/<file>`, no 2nd folder) and
--      documents (`<owner>/docs/<file>`). Only job photos qualify.
--   3. the folder's first segment must be the owner_id of a project the
--      caller is actually assigned to (via project_workers).
-- Owners keep reading via the existing own-folder read policy; this only
-- ADDs a narrow worker read. (A same-tenant worker could in theory sign
-- another of the same owner's jobphotos if they guessed the exact path,
-- but paths aren't enumerable — no list grant — and the job_photos ROWS
-- stay per-project scoped by worker_select_job_photos. Same-tenant, low
-- risk, and never exposes receipts/documents or another company.)
-- ------------------------------------------------------------
drop policy if exists "receipts_worker_read_jobphotos" on storage.objects;
create policy "receipts_worker_read_jobphotos" on storage.objects
  for select using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[2] = 'jobphotos'
    and exists (
      select 1
      from public.project_workers pw
      join public.projects p on p.id = pw.project_id
      where pw.worker_id = auth.uid()
        and p.owner_id::text = (storage.foldername(name))[1]
    )
  );

-- ------------------------------------------------------------
-- VERIFY (run after applying):
--   column exists:
--     select column_name from information_schema.columns
--     where table_name = 'job_photos' and column_name = 'uploaded_by_name';
--   worker read policy present (and receipts read still own-folder only):
--     select policyname, cmd from pg_policies
--     where schemaname = 'storage' and tablename = 'objects'
--       and policyname like 'receipts_%';
--
-- POST-APPLY RE-TEST:
--   1) As a WORKER on a job: add a photo → it now shows in your job's
--      gallery (not just "sent"), with your optional note.
--   2) As the OWNER of that job: open Photos → the photo shows the
--      worker's name + date + note.
--   3) As the OWNER: scan a receipt / open a document → still works,
--      and a worker still CANNOT see receipts or documents.
-- ============================================================
