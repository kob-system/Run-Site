-- FIX-DATABASE-9-billing.sql
-- Stripe subscription billing. Apply in Supabase AFTER FIX-DATABASE-4..8.
--
-- Security model: subscription state lives in its OWN table, not on profiles.
-- Owners may READ only their own row; there is deliberately NO insert/update/
-- delete policy for authenticated users, so the ONLY writer is the Stripe
-- webhook (which uses the service-role key and bypasses RLS). This prevents a
-- client from self-activating by PATCHing their own subscription_status.

create table if not exists public.subscriptions (
  owner_id              uuid primary key references public.profiles(id) on delete cascade,
  stripe_customer_id    text,
  stripe_subscription_id text,
  status                text,          -- trialing | active | past_due | canceled | comp | incomplete
  plan                  text,          -- 'monthly' | 'yearly' | 'comp'
  current_period_end    timestamptz,
  updated_at            timestamptz not null default now()
);

alter table public.subscriptions enable row level security;

drop policy if exists "subscriptions_select_own" on public.subscriptions;
create policy "subscriptions_select_own" on public.subscriptions
  for select using (owner_id = auth.uid());

create index if not exists subscriptions_customer_idx
  on public.subscriptions (stripe_customer_id);

-- Webhook idempotency ledger. Every processed Stripe event id is recorded once;
-- a redelivered event is a no-op. Service-role only (no policies => clients
-- cannot read or write it).
create table if not exists public.billing_events (
  id          text primary key,        -- Stripe event id, e.g. evt_123
  type        text,
  created_at  timestamptz not null default now()
);
alter table public.billing_events enable row level security;

-- Grandfather every EXISTING owner as complimentary ('comp') so that turning on
-- billing enforcement never locks out a current customer (e.g. Josh). New owners
-- get no row until they subscribe, and only see the paywall once
-- REACT_APP_BILLING_ENFORCED='true' is set in Vercel.
insert into public.subscriptions (owner_id, status, plan)
select id, 'comp', 'comp'
from public.profiles
where role = 'owner'
on conflict (owner_id) do nothing;
