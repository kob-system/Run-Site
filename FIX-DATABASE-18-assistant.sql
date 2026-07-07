-- ============================================================
-- FIX-DATABASE-18-assistant.sql
-- In-app AI assistant: the audit trail table.
-- Run ONCE in Supabase → SQL Editor, AFTER FIX-DATABASE-1..17.
-- Idempotent / safe to re-run.
--
-- Every action the assistant EXECUTES (reads that touch data + all writes) is
-- recorded here so the owner can see exactly what was done and by whom. The
-- assistant endpoints write these rows with the service role, setting the
-- actor/scope fields authoritatively from the verified JWT — clients never
-- insert directly. Users only ever READ their own slice (RLS below).
--
-- owner_scope = the owner tenant a row belongs to:
--   * owner actor  -> their own id
--   * worker actor -> their owner_id
-- so an owner sees their own actions AND their crew's; a worker sees only
-- their own.
-- ============================================================

create table if not exists public.assistant_actions (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid references public.profiles(id) on delete cascade,
  actor_role   text,                          -- 'owner' | 'worker'
  owner_scope  uuid,                          -- tenant this row is visible to (owner id)
  action       text not null,                 -- tool name, e.g. 'add_expense'
  params       jsonb not null default '{}'::jsonb,
  status       text not null default 'executed', -- 'executed' | 'failed'
  result       jsonb,
  created_at   timestamptz default now()
);

alter table public.assistant_actions enable row level security;

create index if not exists idx_assistant_actions_scope
  on public.assistant_actions(owner_scope, created_at desc);
create index if not exists idx_assistant_actions_actor
  on public.assistant_actions(actor_id, created_at desc);

-- Owner sees everything in their tenant (own + crew). Worker sees only own.
drop policy if exists "assistant_actions_owner_read" on public.assistant_actions;
create policy "assistant_actions_owner_read" on public.assistant_actions
  for select using (owner_scope = auth.uid());

drop policy if exists "assistant_actions_actor_read" on public.assistant_actions;
create policy "assistant_actions_actor_read" on public.assistant_actions
  for select using (actor_id = auth.uid());

-- No INSERT/UPDATE/DELETE policies for users: only the service role (assistant
-- endpoints) writes here, and service_role bypasses RLS. This makes the audit
-- log append-only from any user's perspective — a worker can't forge or erase
-- an entry.

-- ------------------------------------------------------------
-- VERIFY:
--   select tablename, policyname, cmd from pg_policies where tablename='assistant_actions';
--   select relrowsecurity from pg_class where oid='public.assistant_actions'::regclass; -- t
-- ============================================================
