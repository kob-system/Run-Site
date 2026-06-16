-- ============================================================
-- FIX-DATABASE-11 — owner-initiated worker invites + time-off requests
-- ============================================================
-- Two additive features for Josh's test build. Safe to run multiple
-- times (drop/if-exists guards). Apply in the Supabase SQL editor
-- BEFORE deploying the code that reads these tables.
--
-- 1) worker_invites — the owner generates a one-time invite token in
--    the Workers tab and texts the link (`/?invite=<token>`) to a new
--    hire. The worker opens it, sets a password, and is auto-linked to
--    the owner — no more typing the boss's email (and no orphaned
--    accounts from a typo). The unauthenticated resolve/claim happen
--    server-side with the service-role key (api/resolve-invite.js,
--    api/claim-invite.js), so this table needs only owner RLS.
--
-- 2) time_off_requests — a worker submits a date range + reason from
--    the worker app; the owner approves or denies it in the Workers
--    tab; the worker sees the status. Owner-RLS + worker-scoped RLS,
--    mirroring the time_entries pattern.
-- ------------------------------------------------------------

-- ---------- 1. worker_invites ----------
create table if not exists public.worker_invites (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  token       text not null unique,
  worker_name text,
  created_at  timestamptz not null default now(),
  used_at     timestamptz,
  used_by     uuid references public.profiles(id) on delete set null
);

create index if not exists worker_invites_owner_idx on public.worker_invites(owner_id);
create index if not exists worker_invites_token_idx on public.worker_invites(token);

alter table public.worker_invites enable row level security;

-- Owner fully manages their own invites. The worker who opens the link
-- is NOT logged in yet, so they never touch this table directly — the
-- service-role endpoints resolve/claim the token for them.
drop policy if exists "owner_manages_invites" on public.worker_invites;
create policy "owner_manages_invites" on public.worker_invites
  for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- ---------- 2. time_off_requests ----------
create table if not exists public.time_off_requests (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  worker_id   uuid not null references public.profiles(id) on delete cascade,
  start_date  date not null,
  end_date    date not null,
  reason      text,
  status      text not null default 'pending'
                check (status in ('pending', 'approved', 'denied')),
  created_at  timestamptz not null default now(),
  decided_at  timestamptz
);

create index if not exists time_off_owner_idx  on public.time_off_requests(owner_id);
create index if not exists time_off_worker_idx on public.time_off_requests(worker_id);

alter table public.time_off_requests enable row level security;

-- Owner sees + approves/denies every request addressed to them.
drop policy if exists "owner_manages_time_off" on public.time_off_requests;
create policy "owner_manages_time_off" on public.time_off_requests
  for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- Worker can read their own requests (to see Pending/Approved/Denied).
drop policy if exists "worker_reads_own_time_off" on public.time_off_requests;
create policy "worker_reads_own_time_off" on public.time_off_requests
  for select
  using (worker_id = auth.uid());

-- Worker can file a request for themselves, tenanted to their real
-- owner (can't spoof another company's owner_id, and the row starts
-- 'pending' — only the owner's policy above can flip it).
drop policy if exists "worker_files_time_off" on public.time_off_requests;
create policy "worker_files_time_off" on public.time_off_requests
  for insert
  with check (
    worker_id = auth.uid()
    and owner_id = (select p.owner_id from public.profiles p where p.id = auth.uid())
    and status = 'pending'
  );
