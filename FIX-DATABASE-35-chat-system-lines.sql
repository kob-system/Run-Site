-- ============================================================
-- FIX-DATABASE-35 — the job chat writes the job's diary by itself
-- ============================================================
-- JP, 2026-08-30, on the rebuild: the crew chat becomes the spine of the job
-- screen, with Days / Buy / Fix / Hours / Photo as chips over the thread. When
-- anything is ticked, bought, logged or photographed, one line posts back INTO
-- the thread — "✓ Rob checked off 2x4s · 40" — so the conversation ends up
-- being the record of the job without anybody writing a log.
--
-- WHY THIS NEEDS SCHEMA AT ALL
-- job_messages (FIX-DATABASE-33) has author_id NOT NULL and body as the only
-- content column. So today there is exactly one way for the app to post a
-- diary line: as the owner. That is not acceptable — it puts words in his
-- mouth in a thread his crew reads, and a man who never typed "Got it · 2x4s"
-- would be looking at a message with his own name on it.
--
-- So: author_id becomes nullable, and a `kind` column says which of the two
-- things a row is.
--
--   kind = 'human'   a person typed it. author_id is who.
--   kind = 'system'  the app wrote it because something happened.
--                    author_id is NULL. It renders as JobTally, centred, grey,
--                    and it is nobody's message.
--
-- WHAT DOES NOT CHANGE
--   * post_job_message() still stamps author_id from auth.uid() and still
--     refuses a job you are not on. A client can no more forge a system line
--     than it could forge a human one — the new function ignores anything the
--     caller says about who wrote it, exactly like the old one.
--   * The RLS policies are untouched. Read is still "owner of the job, or
--     assigned to it". Delete is still the owner only.
--   * Nothing can UPDATE a message. There is still no update policy.
--
-- ONE DELIBERATE ASYMMETRY
-- A system line is posted BY the app on behalf of whoever acted, so the
-- membership check is the same as for a human message: you have to be on the
-- job to cause one. A worker ticking an item off the buy list from his phone
-- posts a system line to that job's thread and no other.
--
-- RUN ORDER: after FIX-DATABASE-33 (which creates job_messages and the feed).
-- Additive and idempotent — safe to run more than once.
-- ============================================================

-- ------------------------------------------------------------
-- 1. THE COLUMNS
-- ------------------------------------------------------------
-- Nullable author: a system line has no author, and pretending otherwise is
-- the whole problem this file exists to solve.
alter table public.job_messages
  alter column author_id drop not null;

alter table public.job_messages
  add column if not exists kind text not null default 'human';

-- Only two kinds, ever. A third would need a rendering decision on both the
-- owner and the crew side, so the constraint is the reminder to make it.
alter table public.job_messages
  drop constraint if exists job_messages_kind_check;
alter table public.job_messages
  add constraint job_messages_kind_check
  check (kind in ('human', 'system'));

-- The pairing that actually matters, and the reason this is a constraint and
-- not a convention: a human message with no author is an orphan nobody can be
-- held to, and a system message WITH an author is the exact bug we are fixing.
alter table public.job_messages
  drop constraint if exists job_messages_author_matches_kind;
alter table public.job_messages
  add constraint job_messages_author_matches_kind
  check (
    (kind = 'human'  and author_id is not null)
    or
    (kind = 'system' and author_id is null)
  );

comment on column public.job_messages.kind is
  'human = a person typed it (author_id set). system = the app logged an action (author_id null). Nothing else.';

-- ------------------------------------------------------------
-- 2. THE FEED — carry `kind` through, and never invent a name
-- ------------------------------------------------------------
-- The old view coalesced a missing profile to 'Crew member'. With a nullable
-- author that would label every system line as a crew member — worse than the
-- problem we started with. So the name is decided by kind, not by whether the
-- profile join happened to find anything.
--
-- THE FUNCTION HAS TO GO FIRST, and this is not obvious:
-- post_job_message() is declared `returns public.job_message_feed`, so it
-- depends on the view's COMPOSITE TYPE, not just its rows. Dropping the view
-- underneath it fails with 2BP01 ("cannot drop view ... because other objects
-- depend on it"). Found the hard way running this on 2026-08-30.
-- CASCADE would also work and is the wrong tool: it would silently take the
-- function with it and leave the app with a chat box that cannot send.
drop function if exists public.post_job_message(uuid, text);
drop view if exists public.job_message_feed;
create view public.job_message_feed
with (security_invoker = off) as
  select
    m.id,
    m.project_id,
    m.author_id,
    m.kind,
    case
      when m.kind = 'system' then 'JobTally'
      else coalesce(pr.full_name, 'Crew member')
    end                                   as author_name,
    -- A system line is nobody's, least of all the boss's. Explicitly false so
    -- the owner-badge styling on both dashboards can never light up on one.
    (m.kind = 'human' and m.author_id = pj.owner_id) as author_is_owner,
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
  'Job chat with author names and message kind. Definer-scoped by auth.uid() to jobs the caller owns or is assigned to. Carries no email and no pay rate. kind=system rows are the app''s own diary lines and have no author.';

grant select on public.job_message_feed to authenticated;

-- ------------------------------------------------------------
-- 3. WRITE — human messages, unchanged except for stamping the kind
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

  insert into public.job_messages (project_id, owner_id, author_id, body, kind)
  values (p_project_id, v_owner, auth.uid(), v_clean, 'human')
  returning id into v_id;

  select f.* into v_row from public.job_message_feed f where f.id = v_id;
  return v_row;
end;
$$;

revoke all on function public.post_job_message(uuid, text) from public;
grant execute on function public.post_job_message(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- 4. WRITE — the diary line
-- ------------------------------------------------------------
-- Same gate, no author. Note what the caller CANNOT do: choose the kind,
-- choose the author, or post to a job they are not on. All three are decided
-- in here.
--
-- Returns void rather than the row. The app fires this alongside the write it
-- is describing and does not wait on it or render it — the next 15-second poll
-- brings the line in. A diary that could fail a receipt save would be a bad
-- trade, so the client swallows every error from this call.
create or replace function public.post_job_system_message(p_project_id uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid;
  v_clean text := btrim(coalesce(p_body, ''));
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

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
    return; -- nothing to say; not an error
  end if;
  if char_length(v_clean) > 2000 then
    v_clean := left(v_clean, 2000);
  end if;

  insert into public.job_messages (project_id, owner_id, author_id, body, kind)
  values (p_project_id, v_owner, null, v_clean, 'system');
end;
$$;

revoke all on function public.post_job_system_message(uuid, text) from public;
grant execute on function public.post_job_system_message(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- 5. PROVE IT RAN
-- ------------------------------------------------------------
-- Expect: kind | text | NO   and   author_id | uuid | YES
select column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema = 'public'
   and table_name   = 'job_messages'
   and column_name in ('kind', 'author_id')
 order by column_name;

-- Expect one row: post_job_system_message
select p.proname
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname = 'post_job_system_message';

-- From the live REST API, no login needed:
--   GET  /rest/v1/job_messages?select=kind&limit=1   → 200 once this has run (400 before)
--   POST /rest/v1/rpc/post_job_system_message        → 'Not signed in' once this has run
--                                                      (PGRST202 before)
