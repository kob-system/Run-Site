-- ============================================================
-- FIX-DATABASE-33-crew-chat.sql
-- One thread per job, shared by the owner and the crew assigned to it.
--
-- WHY THIS FILE EXISTS:
-- JP, 2026-08-26: "one useful thing would be a group chat between the crew, so
-- when a crew is created for the job and there is say 4 people on that job then
-- there would be a group chat in JobTally where the owner can communicate with
-- the workers. Maybe we can mix that in with the lists."
--
-- Today every word between an owner and his crew happens in a group text the
-- app cannot see. The shopping list and the fix-it list already live per-job;
-- the talk about them does not, so "did you grab the 2x6s" lands in a thread
-- next to somebody's kid's soccer schedule.
--
-- SHAPE — deliberately the boring one, not the ambitious one:
--   * ONE thread per JOB. No DMs, no per-worker threads. A second axis of
--     privacy is the fastest way to make a crew app confusing, and the owner
--     already has each worker's phone number for anything private.
--   * Text only. No photos here — job photos already have a home (FIX-10/21)
--     and a second upload path means a second set of storage policies to get
--     wrong.
--   * No edits, no deletes for workers. An owner can delete a message on his
--     own job. A thread people can rewrite is not a record of anything.
--   * No read receipts in the database. "Unread" is a timestamp in each
--     phone's own localStorage. Nobody needs a server round-trip to know
--     whether the boss has seen it, and per-viewer read state is a table that
--     grows forever for a badge.
--
-- SECURITY, same three-part pattern the rest of this app uses:
--   TABLE  -> RLS: owner of the job, or a worker assigned to it. Nobody else,
--             ever, including other workers of the same owner on other jobs.
--   READ   -> a SECURITY DEFINER view, because FIX-DATABASE-15 took the crew's
--             read of public.profiles away (it carries email and hourly_rate).
--             Without the view a worker sees a wall of UUIDs instead of names.
--             The view exposes author_name and NOTHING else about the person.
--   WRITE  -> a SECURITY DEFINER function, not an insert straight at the view.
--             It stamps author_id from auth.uid() and owner_id from the job, so
--             a message can never be posted in someone else's name or onto a
--             job the caller is not on.
--
-- RUN ORDER: after FIX-DATABASE-1 (is_owner_of_project / is_worker_on_project).
-- Additive and idempotent — safe to re-run. Without it the Chat tab renders an
-- empty state that says chat is not turned on yet; nothing else in the app
-- changes.
-- ============================================================

-- ------------------------------------------------------------
-- TABLE
-- ------------------------------------------------------------
create table if not exists public.job_messages (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  -- Denormalised from the job so an owner's "everything on my account" export
  -- and the RLS check never need a join. Stamped by the RPC, not the client.
  owner_id    uuid not null,
  author_id   uuid not null,
  body        text not null,
  created_at  timestamptz not null default now(),
  constraint job_messages_body_len check (char_length(btrim(body)) between 1 and 2000)
);

-- The only query this table ever serves: one job's thread, oldest first.
create index if not exists job_messages_project_created_idx
  on public.job_messages (project_id, created_at);

alter table public.job_messages enable row level security;

-- Read: on the job (as owner or assigned crew).
drop policy if exists job_messages_select on public.job_messages;
create policy job_messages_select on public.job_messages
  for select to authenticated
  using (
    public.is_owner_of_project(project_id)
    or public.is_worker_on_project(project_id)
  );

-- Insert is NOT granted to anyone here on purpose. Everything goes through
-- post_job_message() below, which is the only thing that can stamp author_id
-- and owner_id truthfully. A direct insert policy would let a client claim
-- either field.

-- Delete: the owner of the job only, and only his own job's messages.
drop policy if exists job_messages_delete on public.job_messages;
create policy job_messages_delete on public.job_messages
  for delete to authenticated
  using (public.is_owner_of_project(project_id));

-- No update policy at all. Messages are not editable by anybody.

grant select, delete on public.job_messages to authenticated;

-- ------------------------------------------------------------
-- READ — names attached, and nothing else about the person
-- ------------------------------------------------------------
drop view if exists public.job_message_feed;
create view public.job_message_feed
with (security_invoker = off) as
  select
    m.id,
    m.project_id,
    m.author_id,
    coalesce(pr.full_name, 'Crew member') as author_name,
    (m.author_id = pj.owner_id)           as author_is_owner,
    m.body,
    m.created_at,
    pj.name as project_name
  from public.job_messages m
  join public.projects pj on pj.id = m.project_id
  left join public.profiles pr on pr.id = m.author_id
  where pj.owner_id = auth.uid()
     or exists (
       select 1 from public.project_workers pw
       where pw.project_id = m.project_id
         and pw.worker_id = auth.uid()
     );

comment on view public.job_message_feed is
  'Job chat with author names. Definer-scoped by auth.uid() to jobs the caller owns or is assigned to. Carries no email and no pay rate.';

grant select on public.job_message_feed to authenticated;

-- ------------------------------------------------------------
-- WRITE — the only way a message gets in
-- ------------------------------------------------------------
create or replace function public.post_job_message(p_project_id uuid, p_body text)
returns public.job_message_feed
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner   uuid;
  v_id      uuid;
  v_row     public.job_message_feed;
  v_clean   text := btrim(coalesce(p_body, ''));
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  -- Membership re-checked here, not trusted from the caller. This is the gate.
  select p.owner_id into v_owner
  from public.projects p
  where p.id = p_project_id
    and (
      p.owner_id = auth.uid()
      or exists (
        select 1 from public.project_workers pw
        where pw.project_id = p.id and pw.worker_id = auth.uid()
      )
    );

  if v_owner is null then
    raise exception 'You are not on this job';
  end if;

  if char_length(v_clean) = 0 then
    raise exception 'Message is empty';
  end if;
  if char_length(v_clean) > 2000 then
    v_clean := left(v_clean, 2000);
  end if;

  insert into public.job_messages (project_id, owner_id, author_id, body)
  values (p_project_id, v_owner, auth.uid(), v_clean)
  returning id into v_id;

  -- Return the feed row so the sender's screen can append the message with the
  -- author name already on it, without a second round trip on a jobsite signal.
  select f.* into v_row from public.job_message_feed f where f.id = v_id;
  return v_row;
end;
$$;

revoke all on function public.post_job_message(uuid, text) from public;
grant execute on function public.post_job_message(uuid, text) to authenticated;

-- ---------- Sanity ----------
-- As an OWNER:
--   select public.post_job_message('<a job id you own>', 'Bringing the trailer at 7.');
--   select * from public.job_message_feed order by created_at;
-- As a WORKER assigned to that job: both of the above should work.
-- As a worker NOT assigned to it: post raises 'You are not on this job', and
--   the feed returns zero rows for that project.
