-- ============================================================
-- FIX-DATABASE-24-growth-engine.sql
-- Four growth changes that go together:
--   1. Free window 7 days -> 30 days (server side, matches src/App.js)
--   2. projects.is_sample  — the seeded demo job a new owner lands on
--   3. public.product_events — first-party funnel analytics (we had NONE)
--   4. public.testimonials   — real, consented social proof for the landing page
--   5. public.app_admins + is_admin()/founder_funnel() — so the founder can
--      actually SEE the funnel without a third-party analytics vendor.
-- Run ONCE in Supabase -> SQL Editor, AFTER FIX-DATABASE-1..23.
-- Idempotent / safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- 1) FREE WINDOW: 7 -> 30 DAYS
--    Supersedes the version in FIX-DATABASE-17-hole-cleanup.sql. Everything
--    else about the function is identical — only the interval changed.
--    WHY: a contractor's job runs 2-6 weeks. The whole payoff of this app is
--    "here's what that job actually made you", and at 7 days the trial died
--    BEFORE the product could ever show it. 30 days lets one real job finish.
--    This must stay in lockstep with FREE_WINDOW_DAYS in src/App.js — the
--    client decides what to render, this decides what the DB will accept.
-- ------------------------------------------------------------
create or replace function public.has_app_access(uid uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_created timestamptz;
begin
  -- Comped / grandfathered accounts: always in.
  if exists (
    select 1 from public.subscriptions s
    where s.owner_id = uid and s.status = 'comp'
  ) then
    return true;
  end if;

  -- A real paid or Stripe-trialing subscription with a live period end.
  if exists (
    select 1 from public.subscriptions s
    where s.owner_id = uid
      and s.status in ('active', 'trialing')
      and s.current_period_end is not null
      and s.current_period_end > now()
  ) then
    return true;
  end if;

  -- Otherwise, still inside the 30-day no-card free window from signup.
  select p.created_at into v_created from public.profiles p where p.id = uid;
  if v_created is not null and v_created > now() - interval '30 days' then
    return true;
  end if;

  return false;
end;
$$;

revoke all on function public.has_app_access(uuid) from public;
grant execute on function public.has_app_access(uuid) to authenticated;

-- ------------------------------------------------------------
-- 2) SAMPLE JOB FLAG
--    A brand-new owner used to land on a completely empty dashboard — no way
--    to tell what "good" looks like, nothing to click. We now seed ONE
--    finished demo job at first login. It has to be flagged so it can be
--    (a) labelled clearly as a demo, (b) one-click deleted, and (c) excluded
--    from real profit totals so it never pollutes their actual numbers.
--    No new RLS needed: it's an ordinary column on an already-protected table.
-- ------------------------------------------------------------
alter table public.projects
  add column if not exists is_sample boolean not null default false;

create index if not exists idx_projects_is_sample
  on public.projects(owner_id) where is_sample;

-- ------------------------------------------------------------
-- 3) PRODUCT EVENTS — first-party funnel analytics.
--    Threat model mirrors public.leads: anonymous INSERT is deliberately open
--    (we need landing-page events from logged-out visitors), so every field is
--    length-capped by CHECK constraints and there is NO anon read. A visitor
--    can drop an event in the box; they can never read the box.
--    Signed-in users may read only their OWN rows. Only an app_admin (the
--    founder) can read across accounts, and only via founder_funnel() below.
--    Rows are append-only: no UPDATE/DELETE policies for anyone.
-- ------------------------------------------------------------
create table if not exists public.product_events (
  id         bigint generated always as identity primary key,
  -- Null for logged-out landing-page events.
  user_id    uuid references public.profiles(id) on delete cascade,
  -- Stable random id from localStorage, so a landing view can be tied to the
  -- signup it produced. Not a fingerprint — we generate and store it ourselves.
  anon_id    text check (anon_id is null or char_length(anon_id) <= 64),
  event      text not null check (char_length(event) between 1 and 64),
  -- Small bag of context (which screen, which plan, days_left, etc).
  props      jsonb not null default '{}'::jsonb
               check (pg_column_size(props) <= 2048),
  created_at timestamptz not null default now()
);

alter table public.product_events enable row level security;

create index if not exists idx_pe_event_created on public.product_events(event, created_at desc);
create index if not exists idx_pe_user          on public.product_events(user_id, created_at desc);
create index if not exists idx_pe_created       on public.product_events(created_at desc);

-- Anyone may append an event. A signed-in caller must stamp their OWN user_id
-- (or leave it null) — they can't forge events onto another account.
drop policy if exists "pe_insert_any" on public.product_events;
create policy "pe_insert_any" on public.product_events
  for insert to anon, authenticated
  with check (user_id is null or user_id = auth.uid());

-- Read your own trail only.
drop policy if exists "pe_select_own" on public.product_events;
create policy "pe_select_own" on public.product_events
  for select to authenticated
  using (user_id = auth.uid());

grant insert on public.product_events to anon, authenticated;
grant select on public.product_events to authenticated;
revoke select, update, delete on public.product_events from anon;
revoke update, delete on public.product_events from authenticated;

-- ------------------------------------------------------------
-- 4) TESTIMONIALS — real quotes from real owners, shown on the landing page.
--    Deliberately NOT free-for-all: a row is invisible to the public until
--    approved = true, which only happens by hand in the Supabase dashboard.
--    permission_granted records that the owner actually ticked the "you can
--    use this publicly" box — we never publish a quote without it.
--    Anonymous visitors can read ONLY approved rows (that's the landing page).
-- ------------------------------------------------------------
create table if not exists public.testimonials (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null references public.profiles(id) on delete cascade,
  quote              text not null check (char_length(quote) between 10 and 600),
  author_name        text check (author_name  is null or char_length(author_name)  <= 80),
  company_name       text check (company_name is null or char_length(company_name) <= 120),
  city               text check (city         is null or char_length(city)         <= 80),
  rating             int  check (rating is null or rating between 1 and 5),
  -- The owner explicitly consented to public use. No consent, no publishing.
  permission_granted boolean not null default false,
  -- Flipped by hand after review. Gate for anonymous read.
  approved           boolean not null default false,
  created_at         timestamptz not null default now()
);

alter table public.testimonials enable row level security;

create index if not exists idx_testimonials_approved
  on public.testimonials(created_at desc) where approved;

-- An owner may submit their own quote, and read back what they submitted.
drop policy if exists "testimonials_insert_own" on public.testimonials;
create policy "testimonials_insert_own" on public.testimonials
  for insert to authenticated
  with check (owner_id = auth.uid() and approved = false);

drop policy if exists "testimonials_select_own" on public.testimonials;
create policy "testimonials_select_own" on public.testimonials
  for select to authenticated
  using (owner_id = auth.uid());

-- The public sees approved quotes only.
drop policy if exists "testimonials_select_approved" on public.testimonials;
create policy "testimonials_select_approved" on public.testimonials
  for select to anon, authenticated
  using (approved = true);

grant insert, select on public.testimonials to authenticated;
grant select on public.testimonials to anon;
revoke update, delete on public.testimonials from anon, authenticated;

-- ------------------------------------------------------------
-- 5) FOUNDER READOUT
--    Analytics nobody looks at is theatre. app_admins is an explicit allow-list
--    of user ids; founder_funnel() is SECURITY DEFINER so it can aggregate
--    across every account, but it hard-refuses unless the caller is on that
--    list. It returns COUNTS ONLY — never another customer's rows.
-- ------------------------------------------------------------
create table if not exists public.app_admins (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.app_admins enable row level security;
-- No policies at all: unreachable via PostgREST by anyone. Managed from the
-- SQL editor / service role only, and read by SECURITY DEFINER functions.
revoke all on public.app_admins from anon, authenticated;

-- Seed the founder account by email. Safe if the row doesn't exist yet — it
-- simply inserts nothing, and you can re-run this statement after signing in.
insert into public.app_admins (user_id)
select id from public.profiles where lower(email) = 'jpkobrossi@hotmail.com'
on conflict (user_id) do nothing;

create or replace function public.is_admin(uid uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.app_admins a where a.user_id = uid);
$$;

revoke all on function public.is_admin(uuid) from public;
grant execute on function public.is_admin(uuid) to authenticated;

-- One JSON blob with the whole funnel. Called by the in-app ?metrics=1 screen.
create or replace function public.founder_funnel()
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  result jsonb;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'not authorized';
  end if;

  select jsonb_build_object(
    'generated_at', now(),

    -- Accounts
    'owners_total',      (select count(*) from public.profiles where role = 'owner'),
    'owners_7d',         (select count(*) from public.profiles
                            where role = 'owner' and created_at > now() - interval '7 days'),
    'owners_30d',        (select count(*) from public.profiles
                            where role = 'owner' and created_at > now() - interval '30 days'),
    'workers_total',     (select count(*) from public.profiles where role = 'worker'),

    -- Activation: did they put a REAL job in (sample job excluded)?
    'owners_with_job',   (select count(distinct owner_id) from public.projects where not is_sample),
    'real_jobs_total',   (select count(*) from public.projects where not is_sample),
    'owners_with_receipt', (select count(distinct r.owner_id) from public.receipts r),
    'owners_with_time',  (select count(distinct p.owner_id)
                            from public.time_entries t
                            join public.projects p on p.id = t.project_id
                           where not p.is_sample),

    -- Money
    'subs_active',       (select count(*) from public.subscriptions where status = 'active'),
    'subs_trialing',     (select count(*) from public.subscriptions where status = 'trialing'),
    'subs_past_due',     (select count(*) from public.subscriptions where status = 'past_due'),
    'subs_canceled',     (select count(*) from public.subscriptions where status = 'canceled'),

    -- Behaviour, from product_events
    'events_total',      (select count(*) from public.product_events),
    'events_7d',         (select count(*) from public.product_events
                            where created_at > now() - interval '7 days'),
    'events_by_name_7d', (select coalesce(jsonb_object_agg(e.event, e.n), '{}'::jsonb)
                            from (select event, count(*) as n
                                    from public.product_events
                                   where created_at > now() - interval '7 days'
                                   group by event order by count(*) desc limit 40) e),

    -- Where they came from
    'top_sources',       (select coalesce(jsonb_object_agg(a.src, a.n), '{}'::jsonb)
                            from (select coalesce(utm_source, ref, 'direct') as src, count(*) as n
                                    from public.signup_attribution
                                   group by 1 order by count(*) desc limit 20) a),
    'leads_total',       (select count(*) from public.leads),

    -- Social proof pipeline
    'testimonials_pending',  (select count(*) from public.testimonials where not approved),
    'testimonials_approved', (select count(*) from public.testimonials where approved)
  ) into result;

  return result;
end;
$$;

revoke all on function public.founder_funnel() from public;
grant execute on function public.founder_funnel() to authenticated;

-- ------------------------------------------------------------
-- VERIFY (run after applying):
--   -- 30-day window is live:
--   select prosrc like '%30 days%' from pg_proc where proname = 'has_app_access';   -- t
--   -- new objects exist with RLS on:
--   select relname, relrowsecurity from pg_class
--     where oid in ('public.product_events'::regclass,
--                   'public.testimonials'::regclass,
--                   'public.app_admins'::regclass);                                  -- all t
--   select column_name from information_schema.columns
--     where table_name = 'projects' and column_name = 'is_sample';                   -- 1 row
--   -- founder is on the allow-list (must return 1 AFTER the owner account exists):
--   select count(*) from public.app_admins;
--   -- and the readout works when called as that user:
--   select public.founder_funnel();
--   -- as anon: insert into product_events succeeds, select returns 0 rows.
-- ============================================================
