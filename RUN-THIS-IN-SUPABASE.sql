-- ============================================================
-- RUN-SITE — GO-LIVE DB BUNDLE  (assembled 2026-06-21)
-- Paste this WHOLE file into Supabase → SQL Editor → Run.
-- Idempotent: safe to run more than once.
--
-- It applies the 3 migrations from the 2026-06-20 launch-hardening pass
-- that are NOT yet confirmed live:
--   FIX-1  RLS helper functions (committed to source at last)
--   FIX-12 storage write lockdown + kills the cross-tenant receipt READ leak
--   FIX-13 per-user rate limits for the paid/email endpoints
-- Then it VERIFIES the database is locked. Read the verify output at the end:
-- every check has a "WANT:" note telling you what a healthy result looks like.
-- ============================================================


-- ===== FIX-1: RLS helper functions =====
create or replace function public.is_owner_of_project(pid uuid)
returns boolean language plpgsql security definer stable
set search_path = public, pg_temp as $$
begin
  return exists (select 1 from public.projects p where p.id = pid and p.owner_id = auth.uid());
end; $$;

create or replace function public.is_worker_on_project(pid uuid)
returns boolean language plpgsql security definer stable
set search_path = public, pg_temp as $$
begin
  return exists (select 1 from public.project_workers pw where pw.project_id = pid and pw.worker_id = auth.uid());
end; $$;

revoke all on function public.is_owner_of_project(uuid) from public;
grant execute on function public.is_owner_of_project(uuid) to authenticated;
revoke all on function public.is_worker_on_project(uuid) from public;
grant execute on function public.is_worker_on_project(uuid) to authenticated;


-- ===== FIX-12: storage write lockdown + remove leaky UI policies =====
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
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1 from public.project_workers pw
        join public.projects p on p.id = pw.project_id
        where pw.worker_id = auth.uid()
          and p.owner_id::text = (storage.foldername(name))[1]
      )
    )
  );

-- Make sure the bucket itself is private (FIX-4 should have done this; enforce it).
update storage.buckets set public = false where id = 'receipts';


-- ===== FIX-13: per-user rate limits =====
create table if not exists public.rate_limits (
  user_id      uuid        not null,
  bucket       text        not null,
  window_start timestamptz not null default now(),
  count        int         not null default 0,
  primary key (user_id, bucket)
);
alter table public.rate_limits enable row level security;

create or replace function public.rate_limit_hit(p_user uuid, p_bucket text, p_max int, p_window_secs int)
returns boolean language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_now timestamptz := now(); v_count int;
begin
  insert into public.rate_limits (user_id, bucket, window_start, count)
  values (p_user, p_bucket, v_now, 1)
  on conflict (user_id, bucket) do update
    set count = case when public.rate_limits.window_start < v_now - make_interval(secs => p_window_secs)
                     then 1 else public.rate_limits.count + 1 end,
        window_start = case when public.rate_limits.window_start < v_now - make_interval(secs => p_window_secs)
                     then v_now else public.rate_limits.window_start end
  returning count into v_count;
  return v_count <= p_max;
end; $$;
revoke all on function public.rate_limit_hit(uuid, text, int, int) from public;
grant execute on function public.rate_limit_hit(uuid, text, int, int) to service_role;


-- ============================================================
-- VERIFY  —  read these results before you deploy
-- ============================================================

-- 1) RLS helpers are the SAFE kind. WANT: 2 rows, lang=plpgsql, prosecdef=true, proconfig has search_path.
select proname, prosecdef,
       (select lanname from pg_language l where l.oid = p.prolang) as lang, proconfig
from pg_proc p
where proname in ('is_owner_of_project','is_worker_on_project');

-- 2) Receipts bucket is private. WANT: public = false.
select id, public from storage.buckets where id = 'receipts';

-- 3) Storage policies. WANT: NO "publicly viewable" / loose upload rows left;
--    inserts only via "receipts_tenant_scoped_upload"; reads only via "receipts_authed_read".
select policyname, cmd from pg_policies where schemaname = 'storage' and tablename = 'objects';

-- 4) Every public table has RLS ON. WANT: ZERO rows returned.
select n.nspname, c.relname
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = false;
