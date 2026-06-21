-- ============================================================
-- FIX-DATABASE-13-rate-limits.sql
-- Per-user rate limiting for the paid / outbound API endpoints, using the
-- existing Postgres only (no Redis / KV / extra infra).
--
-- WHY: /api/scan-receipt calls the Anthropic API ($ per call) and /api/notify-owner
-- sends email via Resend. Both already require an authenticated user, but a single
-- logged-in user could still loop them to burn the API budget or spam an owner.
-- This adds a cheap atomic counter the endpoints check (server-side, service_role).
--
-- rate_limit_hit() returns TRUE if the call is allowed (still under the cap for the
-- current rolling window) and FALSE if it should be rejected. It increments
-- atomically via INSERT ... ON CONFLICT, so concurrent calls can't race past the cap.
--
-- Safe / idempotent to re-run.
-- ============================================================

create table if not exists public.rate_limits (
  user_id      uuid        not null,
  bucket       text        not null,
  window_start timestamptz not null default now(),
  count        int         not null default 0,
  primary key (user_id, bucket)
);

-- Locked down: only service_role / the SECURITY DEFINER function below touch it.
alter table public.rate_limits enable row level security;

create or replace function public.rate_limit_hit(
  p_user        uuid,
  p_bucket      text,
  p_max         int,
  p_window_secs int
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now   timestamptz := now();
  v_count int;
begin
  insert into public.rate_limits (user_id, bucket, window_start, count)
  values (p_user, p_bucket, v_now, 1)
  on conflict (user_id, bucket) do update
    set count = case
                  when public.rate_limits.window_start < v_now - make_interval(secs => p_window_secs)
                  then 1                                   -- window expired → reset
                  else public.rate_limits.count + 1        -- same window → increment
                end,
        window_start = case
                  when public.rate_limits.window_start < v_now - make_interval(secs => p_window_secs)
                  then v_now
                  else public.rate_limits.window_start
                end
  returning count into v_count;

  return v_count <= p_max;
end;
$$;

revoke all on function public.rate_limit_hit(uuid, text, int, int) from public;
grant execute on function public.rate_limit_hit(uuid, text, int, int) to service_role;
