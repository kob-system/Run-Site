-- ============================================================
-- FIX-DATABASE-19-leads-attribution.sql
-- Marketing plumbing for the /remodelers landing page:
--   1. public.leads              — email captures from the free Job Profit
--                                  Calculator (and any future gated asset).
--   2. public.signup_attribution — first-touch UTM/ref data stamped onto a
--                                  new account at signup, so we can answer
--                                  "which social post created this trial?"
-- Run ONCE in Supabase → SQL Editor, AFTER FIX-DATABASE-1..18.
-- Idempotent / safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- 1) LEADS — written by ANONYMOUS visitors on the public landing page.
--    Threat model: anon INSERT is deliberately open (it's a lead form), so
--    every column is length-capped by CHECK constraints to stop junk-blob
--    abuse, and there are NO select/update/delete policies — a visitor can
--    drop a lead in the box but can never read the box. Reads happen via
--    the service role / Supabase dashboard only.
-- ------------------------------------------------------------
create table if not exists public.leads (
  id           uuid primary key default gen_random_uuid(),
  email        text not null
                 check (char_length(email) between 5 and 320 and position('@' in email) > 1),
  source       text not null default 'remodelers-calculator'
                 check (char_length(source) <= 64),
  utm_source   text check (utm_source   is null or char_length(utm_source)   <= 128),
  utm_medium   text check (utm_medium   is null or char_length(utm_medium)   <= 128),
  utm_campaign text check (utm_campaign is null or char_length(utm_campaign) <= 128),
  -- Calculator inputs/outputs at the moment they asked for their numbers.
  payload      jsonb not null default '{}'::jsonb
                 check (pg_column_size(payload) <= 8192),
  created_at   timestamptz not null default now()
);

alter table public.leads enable row level security;

create index if not exists idx_leads_created on public.leads(created_at desc);

-- Anonymous (and signed-in) visitors may INSERT a lead. Nothing else, ever.
drop policy if exists "leads_public_insert" on public.leads;
create policy "leads_public_insert" on public.leads
  for insert to anon, authenticated
  with check (true);
-- No SELECT/UPDATE/DELETE policies: write-only from the public's perspective.

-- Belt-and-suspenders on the grant level too (PostgREST honors both).
grant insert on public.leads to anon, authenticated;
revoke select, update, delete on public.leads from anon, authenticated;

-- ------------------------------------------------------------
-- 2) SIGNUP ATTRIBUTION — one row per account, written right after the
--    profile row is created (client-side, as the authenticated new user).
--    First-touch UTMs come from localStorage via src/utils/attribution.js;
--    for the email-confirmation flow they ride in the auth user's signup
--    metadata (set on the ORIGINAL device) so a confirm-on-another-device
--    doesn't lose them.
--    RLS: a user may insert/read only their OWN row; rows are immutable
--    (no update/delete policies) so attribution can't be rewritten later.
-- ------------------------------------------------------------
create table if not exists public.signup_attribution (
  user_id       uuid primary key references public.profiles(id) on delete cascade,
  ref           text check (ref           is null or char_length(ref)           <= 32),
  utm_source    text check (utm_source    is null or char_length(utm_source)    <= 128),
  utm_medium    text check (utm_medium    is null or char_length(utm_medium)    <= 128),
  utm_campaign  text check (utm_campaign  is null or char_length(utm_campaign)  <= 128),
  landing_page  text check (landing_page  is null or char_length(landing_page)  <= 256),
  -- When the browser FIRST saw a tagged link (may predate signup by days).
  first_seen_at timestamptz,
  created_at    timestamptz not null default now()
);

alter table public.signup_attribution enable row level security;

drop policy if exists "attribution_insert_own" on public.signup_attribution;
create policy "attribution_insert_own" on public.signup_attribution
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "attribution_read_own" on public.signup_attribution;
create policy "attribution_read_own" on public.signup_attribution
  for select to authenticated
  using (user_id = auth.uid());
-- No UPDATE/DELETE policies: append-once.

grant insert, select on public.signup_attribution to authenticated;
revoke update, delete on public.signup_attribution from anon, authenticated;
revoke all on public.signup_attribution from anon;

-- ------------------------------------------------------------
-- VERIFY (run after applying):
--   select tablename, policyname, cmd, roles from pg_policies
--     where tablename in ('leads','signup_attribution') order by tablename;
--   -- leads: exactly one INSERT policy; signup_attribution: INSERT + SELECT.
--   select relrowsecurity from pg_class where oid='public.leads'::regclass;              -- t
--   select relrowsecurity from pg_class where oid='public.signup_attribution'::regclass; -- t
--   -- As anon (e.g. curl with the anon key, no user JWT):
--   --   INSERT into leads succeeds; SELECT from leads returns zero rows/permission denied.
-- ============================================================
