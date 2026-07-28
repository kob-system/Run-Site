-- ------------------------------------------------------------
-- 26. worker_invites.hourly_rate — carry the pay rate on the invite
--
-- Why: the assistant's "Add a worker" template asks the owner for the
-- new hire's name AND what he pays him, in one guided flow. Until now
-- the rate had nowhere to live — invite_worker only stored a name, and
-- set_worker_rate needs a profiles row that doesn't exist until the
-- worker actually signs up. So the owner had to come back later and set
-- the rate a second time.
--
-- Now the rate rides on the invite row and api/claim-invite.js stamps it
-- onto the worker's profile the moment they claim the link. The rate is
-- read SERVER-SIDE from this row (service key), never from anything the
-- signing-up worker can edit — a crew member can't inflate their own pay
-- by editing signup metadata.
--
-- Nullable on purpose: the Workers-tab invite button doesn't collect a
-- rate, and those invites must keep working exactly as before.
-- ------------------------------------------------------------

alter table public.worker_invites
  add column if not exists hourly_rate numeric;

comment on column public.worker_invites.hourly_rate is
  'Optional pay rate captured when the invite was created; applied to the worker''s profile at claim time.';

-- Sanity: existing invites are untouched (null = "ask me later", the old behavior).
-- select token, worker_name, hourly_rate from public.worker_invites order by created_at desc limit 5;
