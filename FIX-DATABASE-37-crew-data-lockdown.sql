-- ============================================================
-- FIX-DATABASE-37: crew sees only their own work
-- ============================================================
-- THE HOLE (read from the live database, 2026-09-13):
-- Seven row policies scope access by `current_tenant_id()`. That function
-- returns `coalesce(owner_id, id)` from the caller's profile, so for an OWNER
-- it is his own id, but for a CREW MEMBER it is the BOSS's id. Every one of
-- these policies therefore hands a crew member the boss's whole tenant:
--
--   projects.projects_rw            read + write EVERY column of every job
--                                   (client phone/email/address, budgets,
--                                   profit target), update or delete jobs
--   receipts.receipts_rw            read + write every receipt
--   time_entries.time_entries_rw    every crewmate's hours, pay and GPS, and
--                                   insert/edit/delete anyone's shift
--   profiles.profiles_select        every crewmate's profile incl. hourly_rate
--   profiles.profiles_update        edit a crewmate's profile, incl. his
--                                   hourly_rate (the lock trigger only stops
--                                   you changing your OWN rate)
--   project_workers.project_workers_rw  add himself to any of the boss's jobs
--   schedule_entries.schedule_rw    read + write the whole crew schedule
--
-- None of these are in any committed .sql file; they were created by hand.
-- FIX-DATABASE-16 Part B (the drop of the old worker project read) was left
-- commented out, and projects_rw quietly did the same job anyway.
--
-- THE FIX:
--   1. Each of the seven keeps its name but `current_tenant_id()` becomes
--      `auth.uid()` and the tenant-wide worker branch is removed. For an owner
--      current_tenant_id() already equals auth.uid() (no owner has an
--      owner_id; checked live: 0 rows), so OWNER ACCESS IS UNCHANGED.
--   2. Crew keep exactly what the crew screen uses, all of it already in
--      place and none of it tenant-wide:
--        own time entries        worker_select/insert/update_own_time_entries
--        own assignments         worker_sees_own_assignments
--        own profile             owner_sees_own_profile / update_own_profile
--        own time off            worker_reads_own_time_off / worker_files_time_off
--        photos on his jobs      worker_select_job_photos
--        job info, lists, crew,  worker_projects, worker_time_entries,
--        schedule, chat          worker_schedule, worker_crewmates,
--                                worker_material_items, worker_punch_items,
--                                job_message_feed (views, security_invoker=off,
--                                so they never needed the base-table policies)
--        tick-offs, chat posts   worker_set_material_bought, worker_set_punch_done,
--                                post_job_message (SECURITY DEFINER RPCs)
--   3. Four crew WRITE checks looked the job up in `projects` under the crew
--      member's own RLS. They only worked because of projects_rw. They are
--      rewritten to ask two new SECURITY DEFINER helpers instead, with the
--      same meaning (you are assigned to this job, and the owner id matches):
--        job_photos.worker_insert_job_photos        (crew adds a job photo)
--        receipts.worker_inserts_receipts           (crew logs a receipt)
--        storage receipts_tenant_scoped_upload      (the photo file itself)
--        storage receipts_worker_read_jobphotos     (crew sees photo thumbnails)
--   4. Two crew writes nothing in the app uses are removed:
--        time_entries.worker_delete_own_time_entries   (a worker deleting his
--          own hours erases the boss's payroll record; no screen does it)
--        add_labor_cost(): the worker branch. Nothing in the app calls it any
--          more (pay is computed by the time-entry trigger); it let a crew
--          member write projects.labor_spent on his job.
--
-- NO APP CHANGE IS REQUIRED for this to run. Every crew read/write already
-- goes through the views, RPCs and own-row policies listed above. It can run
-- before or after the code deploy.
--
-- AFTER IT RUNS, do the crew walk-through on a real phone before calling it
-- done: clock in, clock out, hours list, schedule, shopping + fix-it ticks,
-- add a job photo and see the thumbnail, log a receipt through the assistant,
-- job chat, time off request.
--
-- Idempotent: every policy is drop-if-exists + create, every function is
-- create-or-replace. One transaction: all of it lands or none of it does.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. Helpers. SECURITY DEFINER so they can see `projects` even though the
--    crew member no longer can. Both are hard-scoped by auth.uid(), which is
--    a verified-JWT value, so they only ever answer about the caller's own
--    assignments. plpgsql + locked search_path, like is_worker_on_project.
-- ------------------------------------------------------------

-- The owner of a job the caller is assigned to, else NULL. With
-- p_open_only = true, a finished job (stage 'end') also returns NULL.
create or replace function public.crew_job_owner(p_project_id uuid, p_open_only boolean default false)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid;
begin
  if auth.uid() is null or p_project_id is null then
    return null;
  end if;
  select p.owner_id into v_owner
  from public.projects p
  where p.id = p_project_id
    and (not coalesce(p_open_only, false) or p.stage is distinct from 'end')
    and exists (
      select 1 from public.project_workers pw
      where pw.project_id = p.id and pw.worker_id = auth.uid()
    );
  return v_owner;
end;
$$;

-- Is the caller on at least one job owned by this owner? Takes TEXT because
-- the storage policies pass the first folder of the object path.
create or replace function public.is_crew_of_owner(p_owner text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or p_owner is null then
    return false;
  end if;
  return exists (
    select 1
    from public.project_workers pw
    join public.projects p on p.id = pw.project_id
    where pw.worker_id = auth.uid()
      and p.owner_id::text = p_owner
  );
end;
$$;

revoke all on function public.crew_job_owner(uuid, boolean) from public;
revoke all on function public.is_crew_of_owner(text) from public;
-- anon too: a storage policy is evaluated for anon requests as well, and a
-- missing grant there is an error instead of a plain "no".
grant execute on function public.crew_job_owner(uuid, boolean) to anon, authenticated;
grant execute on function public.is_crew_of_owner(text) to anon, authenticated;

-- ------------------------------------------------------------
-- 2. The seven tenant-wide policies, narrowed in place (same names).
-- ------------------------------------------------------------

drop policy if exists "projects_rw" on public.projects;
create policy "projects_rw" on public.projects
  as permissive for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "receipts_rw" on public.receipts;
create policy "receipts_rw" on public.receipts
  as permissive for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- Owner side only. A worker's own rows stay covered by the four
-- worker_*_own_time_entries policies (three after step 4).
drop policy if exists "time_entries_rw" on public.time_entries;
create policy "time_entries_rw" on public.time_entries
  as permissive for all to authenticated
  using (exists (
    select 1 from public.projects pr
    where pr.id = time_entries.project_id and pr.owner_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.projects pr
    where pr.id = time_entries.project_id and pr.owner_id = auth.uid()
  ));

-- Owner side only. A worker still READS his own rows through
-- worker_sees_own_assignments; he can no longer add, move or remove them.
drop policy if exists "project_workers_rw" on public.project_workers;
create policy "project_workers_rw" on public.project_workers
  as permissive for all to authenticated
  using (exists (
    select 1 from public.projects pr
    where pr.id = project_workers.project_id and pr.owner_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.projects pr
    where pr.id = project_workers.project_id and pr.owner_id = auth.uid()
  ));

-- Owner side only. A worker still reads his own rows through
-- worker_sees_own_schedule and the worker_schedule view.
drop policy if exists "schedule_rw" on public.schedule_entries;
create policy "schedule_rw" on public.schedule_entries
  as permissive for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- Yourself, or (owner) your own crew. A worker no longer sees the boss's
-- profile or any crewmate's. Crewmate NAMES still reach the crew screen
-- through the worker_crewmates view and job_message_feed.
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  as permissive for select to authenticated
  using ((id = auth.uid()) or (owner_id = auth.uid()));

drop policy if exists "profiles_update" on public.profiles;
create policy "profiles_update" on public.profiles
  as permissive for update to authenticated
  using ((id = auth.uid()) or (owner_id = auth.uid()))
  with check ((id = auth.uid()) or (owner_id = auth.uid()));

-- ------------------------------------------------------------
-- 3. Crew write checks that used to peek at `projects` under the crew
--    member's own RLS. Same meaning, now asked of the definer helpers.
-- ------------------------------------------------------------

-- Was: assigned to project_id AND owner_id = that project's owner.
drop policy if exists "worker_insert_job_photos" on public.job_photos;
create policy "worker_insert_job_photos" on public.job_photos
  as permissive for insert
  with check (owner_id = public.crew_job_owner(project_id));

-- Was: assigned, owner_id = the project's owner, job not finished.
drop policy if exists "worker_inserts_receipts" on public.receipts;
create policy "worker_inserts_receipts" on public.receipts
  as permissive for insert
  with check (owner_id = public.crew_job_owner(project_id, true));

-- Was (FIX-22): your own folder, or the folder of an owner whose job you're on.
drop policy if exists "receipts_tenant_scoped_upload" on storage.objects;
create policy "receipts_tenant_scoped_upload" on storage.objects
  for insert with check (
    bucket_id = 'receipts'
    and auth.role() = 'authenticated'
    and (
      (storage.foldername(objects.name))[1] = auth.uid()::text
      or public.is_crew_of_owner((storage.foldername(objects.name))[1])
    )
  );

-- Was (FIX-22): the jobphotos subfolder of an owner whose job you're on.
drop policy if exists "receipts_worker_read_jobphotos" on storage.objects;
create policy "receipts_worker_read_jobphotos" on storage.objects
  for select using (
    bucket_id = 'receipts'
    and (storage.foldername(objects.name))[2] = 'jobphotos'
    and public.is_crew_of_owner((storage.foldername(objects.name))[1])
  );

-- ------------------------------------------------------------
-- 4. Crew writes nothing in the app uses.
-- ------------------------------------------------------------

drop policy if exists "worker_delete_own_time_entries" on public.time_entries;

-- Owner only. Same body as live minus the is_worker_on_project branch.
create or replace function public.add_labor_cost(p_project_id uuid, p_cost numeric)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_owner_of_project(p_project_id) then
    raise exception 'Not authorized to add labor cost to this project';
  end if;
  if p_cost is null or p_cost < 0 or p_cost > 100000 then
    raise exception 'Invalid labor cost: %', p_cost;
  end if;
  update public.projects
    set labor_spent = coalesce(labor_spent, 0) + p_cost
    where id = p_project_id;
end;
$function$;

commit;

-- ============================================================
-- VERIFY (read-only). Run after the block above.
-- ============================================================
--
-- V1. No policy anywhere still scopes by current_tenant_id(). Expect 0 rows.
--   select schemaname, tablename, policyname from pg_policies
--   where schemaname in ('public','storage')
--     and (coalesce(qual,'') ilike '%current_tenant_id%'
--          or coalesce(with_check,'') ilike '%current_tenant_id%');
--
-- V2. The narrowed and rewritten policies read as intended.
--   select tablename, policyname, cmd, roles, qual, with_check from pg_policies
--   where (schemaname = 'public' and policyname in (
--           'projects_rw','receipts_rw','time_entries_rw','project_workers_rw',
--           'schedule_rw','profiles_select','profiles_update',
--           'worker_insert_job_photos','worker_inserts_receipts',
--           'worker_delete_own_time_entries'))
--      or (schemaname = 'storage' and policyname in (
--           'receipts_tenant_scoped_upload','receipts_worker_read_jobphotos'))
--   order by 1, 2;
--   -- expect 11 rows (worker_delete_own_time_entries gone), no current_tenant_id.
--
-- V3. Helpers exist and are SECURITY DEFINER. Expect 2 rows, prosecdef = true.
--   select proname, prosecdef from pg_proc
--   where pronamespace = 'public'::regnamespace
--     and proname in ('crew_job_owner','is_crew_of_owner');
--
-- V4. Same proof over the live REST API, no login, 30 seconds:
--   POST <SUPABASE_URL>/rest/v1/rpc/is_crew_of_owner   body {"p_owner":"x"}
--   with the anon key:  200 `false` = ran · 404 PGRST202 = not run yet
--
-- V5. Look through a real crew member's eyes. Needs a role that can
--     `set role` (the Supabase SQL editor can; `sql.mjs --read-only` cannot).
--     Ends in ROLLBACK, so nothing is written.
--
--   begin;
--   select set_config('request.jwt.claims', json_build_object(
--     'sub', (select p.id from public.profiles p
--             where p.role = 'worker' and p.owner_id is not null
--               and exists (select 1 from public.project_workers pw where pw.worker_id = p.id)
--             limit 1)::text,
--     'role', 'authenticated')::text, true);
--   set local role authenticated;
--   select 'projects (base table)'      as what, count(*) from public.projects                         -- expect 0
--   union all select 'receipts',                 count(*) from public.receipts                         -- expect 0
--   union all select 'time_entries not mine',    count(*) from public.time_entries where worker_id <> auth.uid()   -- expect 0
--   union all select 'profiles not me',          count(*) from public.profiles where id <> auth.uid()            -- expect 0
--   union all select 'schedule not mine',        count(*) from public.schedule_entries where worker_id is distinct from auth.uid() -- expect 0
--   union all select 'assignments not mine',     count(*) from public.project_workers where worker_id <> auth.uid() -- expect 0
--   union all select 'worker_projects view',     count(*) from public.worker_projects                  -- expect his open jobs, > 0
--   union all select 'worker_crewmates view',    count(*) from public.worker_crewmates                 -- unchanged
--   union all select 'job_photos on my jobs',    count(*) from public.job_photos                       -- unchanged
--   union all select 'can photo my first job',   count(*) from public.worker_projects w
--                                                where public.crew_job_owner(w.id) = w.owner_id;       -- = worker_projects count
--   rollback;
--
-- V6. Owners unchanged. Same shape as V5 with an owner's id in 'sub':
--   'projects (base table)' must equal
--   select count(*) from public.projects where owner_id = '<that owner id>';
-- ============================================================


-- ============================================================
-- ROLLBACK: restores the exact live definitions captured from pg_policy /
-- pg_get_functiondef on 2026-09-13, before this file. One paste. This puts
-- the hole back, so only use it if the crew screen breaks and you need time.
-- ============================================================
-- begin;
--
-- drop policy if exists "projects_rw" on public.projects;
-- create policy "projects_rw" on public.projects
--   as permissive for all to authenticated
--   using (owner_id = current_tenant_id())
--   with check (owner_id = current_tenant_id());
--
-- drop policy if exists "receipts_rw" on public.receipts;
-- create policy "receipts_rw" on public.receipts
--   as permissive for all to authenticated
--   using (owner_id = current_tenant_id())
--   with check (owner_id = current_tenant_id());
--
-- drop policy if exists "time_entries_rw" on public.time_entries;
-- create policy "time_entries_rw" on public.time_entries
--   as permissive for all to authenticated
--   using ((worker_id = auth.uid()) OR (EXISTS ( SELECT 1
--      FROM projects pr
--     WHERE ((pr.id = time_entries.project_id) AND (pr.owner_id = current_tenant_id())))))
--   with check ((worker_id = auth.uid()) OR (EXISTS ( SELECT 1
--      FROM projects pr
--     WHERE ((pr.id = time_entries.project_id) AND (pr.owner_id = current_tenant_id())))));
--
-- drop policy if exists "project_workers_rw" on public.project_workers;
-- create policy "project_workers_rw" on public.project_workers
--   as permissive for all to authenticated
--   using ((worker_id = auth.uid()) OR (EXISTS ( SELECT 1
--      FROM projects pr
--     WHERE ((pr.id = project_workers.project_id) AND (pr.owner_id = current_tenant_id())))))
--   with check ((EXISTS ( SELECT 1
--      FROM projects pr
--     WHERE ((pr.id = project_workers.project_id) AND (pr.owner_id = current_tenant_id())))));
--
-- drop policy if exists "schedule_rw" on public.schedule_entries;
-- create policy "schedule_rw" on public.schedule_entries
--   as permissive for all to authenticated
--   using ((owner_id = current_tenant_id()) OR (worker_id = auth.uid()))
--   with check ((owner_id = current_tenant_id()) OR (worker_id = auth.uid()));
--
-- drop policy if exists "profiles_select" on public.profiles;
-- create policy "profiles_select" on public.profiles
--   as permissive for select to authenticated
--   using ((id = auth.uid()) OR (id = current_tenant_id()) OR (owner_id = current_tenant_id()));
--
-- drop policy if exists "profiles_update" on public.profiles;
-- create policy "profiles_update" on public.profiles
--   as permissive for update to authenticated
--   using ((id = auth.uid()) OR (owner_id = current_tenant_id()))
--   with check ((id = auth.uid()) OR (owner_id = current_tenant_id()));
--
-- drop policy if exists "worker_insert_job_photos" on public.job_photos;
-- create policy "worker_insert_job_photos" on public.job_photos
--   as permissive for insert
--   with check ((project_id IN ( SELECT project_workers.project_id
--      FROM project_workers
--     WHERE (project_workers.worker_id = auth.uid()))) AND (owner_id = ( SELECT p.owner_id
--      FROM projects p
--     WHERE (p.id = job_photos.project_id))));
--
-- drop policy if exists "worker_inserts_receipts" on public.receipts;
-- create policy "worker_inserts_receipts" on public.receipts
--   as permissive for insert
--   with check ((EXISTS ( SELECT 1
--      FROM (projects p
--        JOIN project_workers pw ON ((pw.project_id = p.id)))
--     WHERE ((p.id = receipts.project_id) AND (pw.worker_id = auth.uid()) AND (p.owner_id = receipts.owner_id) AND (p.stage IS DISTINCT FROM 'end'::text)))));
--
-- drop policy if exists "worker_delete_own_time_entries" on public.time_entries;
-- create policy "worker_delete_own_time_entries" on public.time_entries
--   as permissive for delete
--   using (worker_id = auth.uid());
--
-- drop policy if exists "receipts_tenant_scoped_upload" on storage.objects;
-- create policy "receipts_tenant_scoped_upload" on storage.objects
--   for insert with check ((bucket_id = 'receipts'::text) AND (auth.role() = 'authenticated'::text) AND (((storage.foldername(name))[1] = (auth.uid())::text) OR (EXISTS ( SELECT 1
--      FROM (project_workers pw
--        JOIN projects p ON ((p.id = pw.project_id)))
--     WHERE ((pw.worker_id = auth.uid()) AND ((p.owner_id)::text = (storage.foldername(objects.name))[1]))))));
--
-- drop policy if exists "receipts_worker_read_jobphotos" on storage.objects;
-- create policy "receipts_worker_read_jobphotos" on storage.objects
--   for select using ((bucket_id = 'receipts'::text) AND ((storage.foldername(name))[2] = 'jobphotos'::text) AND (EXISTS ( SELECT 1
--      FROM (project_workers pw
--        JOIN projects p ON ((p.id = pw.project_id)))
--     WHERE ((pw.worker_id = auth.uid()) AND ((p.owner_id)::text = (storage.foldername(objects.name))[1])))));
--
-- CREATE OR REPLACE FUNCTION public.add_labor_cost(p_project_id uuid, p_cost numeric)
--  RETURNS void
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$
-- begin
--   if not (public.is_owner_of_project(p_project_id)
--           or public.is_worker_on_project(p_project_id)) then
--     raise exception 'Not authorized to add labor cost to this project';
--   end if;
--   if p_cost is null or p_cost < 0 or p_cost > 100000 then
--     raise exception 'Invalid labor cost: %', p_cost;
--   end if;
--   update public.projects
--     set labor_spent = coalesce(labor_spent, 0) + p_cost
--     where id = p_project_id;
-- end;
-- $function$;
--
-- -- Last, once nothing references them:
-- drop function if exists public.crew_job_owner(uuid, boolean);
-- drop function if exists public.is_crew_of_owner(text);
--
-- commit;
-- ============================================================
