-- ============================================================
-- FIX-DATABASE-32 — who else is on my job
-- ============================================================
-- Additive and idempotent. Safe to run before or after the deploy; without it
-- the crew list simply does not render and nothing else changes.
--
-- WHY
-- Josh asked for it after watching his guys use the app: a framer opens
-- JobTally, sees the job and his own hours, and still has to text somebody to
-- find out who else is showing up. The owner has always been able to see the
-- assignment list. The crew never could.
--
-- WHY IT NEEDS A VIEW AND NOT A POLICY
-- FIX-DATABASE-15 deliberately took the workers' column-wide read of
-- public.profiles away, because that table carries email and hourly_rate — a
-- crew member must never be able to read what the guy next to him earns. So
-- this exposes exactly two columns, id and full_name, and nothing else, ever.
--
-- SECURITY DEFINER (security_invoker = off) so the join to profiles works with
-- the worker's read revoked. The view is hard-scoped by auth.uid(), a value
-- straight out of the verified JWT that the caller cannot forge: a worker sees
-- crewmates ONLY on jobs he is himself assigned to. Not his boss's other jobs,
-- not another company's, not a job he was taken off.
-- ------------------------------------------------------------

create or replace view public.worker_crewmates
with (security_invoker = off) as
  select pw.project_id,
         pr.id        as worker_id,
         pr.full_name
  from public.project_workers pw
  join public.profiles pr on pr.id = pw.worker_id
  where exists (
    select 1
    from public.project_workers me
    where me.project_id = pw.project_id
      and me.worker_id = auth.uid()
  );

comment on view public.worker_crewmates is
  'Names only, of the crew assigned to jobs the CALLER is also assigned to. No email, no pay rate. Definer-scoped by auth.uid().';

grant select on public.worker_crewmates to authenticated;

-- ---------- Sanity ----------
-- Run as a worker (not the service key) — should return only their own jobs:
--   select * from public.worker_crewmates order by project_id;
