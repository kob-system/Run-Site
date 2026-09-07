-- UNDO WHAT THE 2026-09-06 TAKES DID TO JP'S SHOOT ACCOUNT.
--
--   node ~/the-sky/bin/sql.mjs RESTORE-SHOOT-ACCOUNT-2026-09-06.sql
--
-- Owner 7d1e61b6-fc8f-43f4-8683-f3893e5394f1 only. Nothing outside that id is
-- touched, and no other customer's data is in range of any statement here.
--
-- This is the companion to SEED-SHOOT-ACCOUNT-JP.sql, which defines what the
-- account is supposed to look like. That file ran at 2026-09-06 16:48:46 UTC.
-- Two rounds of clicking happened around it and left eight things behind:
--
--   NOON TAKE (16:36 UTC)
--     1. Three weeks marked paid — Tony 08/02, Kevin 06/21, Dave 08/02.
--
--   TONIGHT (03:37-03:42 UTC on 09-07 = 23:37-23:42 EDT on 09-06)
--     2. Tony's time-off request approved. The seed puts it in Waiting on
--        purpose so Approve / Deny is a live decision on camera.
--     3. Four system messages posted on Hackett Blvd basement.
--     4. A fix-it item "ceiling" on Hackett Blvd basement.
--     5. 13.5 h logged on Hackett Blvd for Andre Pratt (5.5) and Dave
--        Molinari (8) on Sun 09/06 — which also double-books Dave, who is
--        already clocked in on Miller Road deck from the seed.
--     6. An unclaimed invite for "joe" at $35/hr.
--     7. Three more weeks marked paid — Tony, Kevin and Joe, week 08/30.
--
--   DRIFTED, DATE UNKNOWN, BOTH PROVEN WRONG BY THE 12:32 FOOTAGE
--     8. Tony Bracco's rate moved 27 -> 29. Every hour ever booked against
--        him computes at 27.00, so 29 is the outlier, not the history.
--     9. Miller Road deck budgets moved 5800/4200/3500 -> 7000/8000/4500.
--        That is what killed the OVER BUDGET screen: materials spent is
--        $5,857.38, which is over 5,800 and comfortably under 7,000.
--
-- Rows deleted here were captured first to
-- scratchpad/undo-snapshot-2026-09-06.json.

do $undo$
declare
  v_owner uuid := '7d1e61b6-fc8f-43f4-8683-f3893e5394f1';
  v_deck  uuid := 'b2000006-0000-4000-8000-000000000006';
  v_base  uuid := 'b2000007-0000-4000-8000-000000000007';
  v_dave  uuid := 'a1000001-0000-4000-8000-000000000001';
  v_tony  uuid := 'a1000003-0000-4000-8000-000000000003';
  v_andre uuid := '0e38f0ff-f9a8-4f15-b44d-ac0bcbff3653';
begin

  -- 1 + 7 ── THE SIX "MARK PAID" CLICKS -------------------------------------
  -- Everything the seed laid down was created on or before 2026-08-02. Weeks
  -- up to 07/19 are paid, week 07/26 is deliberately left unpaid so there are
  -- live Mark paid buttons on camera. Anything newer is a click from a take.
  delete from public.paychecks
   where owner_id = v_owner and created_at > timestamptz '2026-09-06 16:00Z';

  -- 5 ── THE 13.5 HOURS THE ASSISTANT LOGGED --------------------------------
  -- Scoped to the one job and the one day. The three open shifts the seed
  -- created this morning have clocked_out_at null and are not in range.
  delete from public.time_entries
   where project_id = v_base
     and worker_id in (v_andre, v_dave)
     and clocked_out_at is not null
     and (clocked_in_at at time zone 'UTC')::date = date '2026-09-06';

  -- 3 ── THE FOUR SYSTEM MESSAGES -------------------------------------------
  -- The seed's own twelve crew messages were written with now() - interval,
  -- so they date to 09-04 and 09-05 and are not in range.
  delete from public.job_messages
   where owner_id = v_owner and created_at > timestamptz '2026-09-06 16:00Z';

  -- 4 ── THE FIX-IT ITEM ----------------------------------------------------
  delete from public.punch_items
   where owner_id = v_owner and created_at > timestamptz '2026-09-06 16:00Z';

  -- 6 ── THE UNCLAIMED "joe" INVITE -----------------------------------------
  update public.worker_invites set revoked_at = now()
   where owner_id = v_owner and used_at is null and revoked_at is null;

  -- 2 ── TONY'S TIME OFF, BACK IN THE OWNER'S FACE --------------------------
  update public.time_off_requests
     set status = 'pending', decided_at = null
   where owner_id = v_owner and worker_id = v_tony and start_date = date '2026-09-10';

  -- 8 ── TONY'S RATE --------------------------------------------------------
  update public.profiles set hourly_rate = 27.00 where id = v_tony;

  -- 9 ── THE DECK BUDGET, AND THE OVER BUDGET SCREEN WITH IT ----------------
  update public.projects
     set materials_budget = 5800, labor_budget = 4200, profit_target = 3500, budget = 13500
   where id = v_deck;

end
$undo$;

-- ── PROVE IT ────────────────────────────────────────────────────────────────

-- A. Nothing on this account was created during either take any more.
select 'paychecks since 16:00Z' as thing, count(*)::text as n from public.paychecks where owner_id = '7d1e61b6-fc8f-43f4-8683-f3893e5394f1' and created_at > timestamptz '2026-09-06 16:00Z'
union all select 'job_messages since 16:00Z', count(*)::text from public.job_messages where owner_id = '7d1e61b6-fc8f-43f4-8683-f3893e5394f1' and created_at > timestamptz '2026-09-06 16:00Z'
union all select 'punch_items since 16:00Z',  count(*)::text from public.punch_items  where owner_id = '7d1e61b6-fc8f-43f4-8683-f3893e5394f1' and created_at > timestamptz '2026-09-06 16:00Z'
union all select 'unclaimed invites',         count(*)::text from public.worker_invites where owner_id = '7d1e61b6-fc8f-43f4-8683-f3893e5394f1' and used_at is null and revoked_at is null
union all select 'time-off waiting',          count(*)::text from public.time_off_requests where owner_id = '7d1e61b6-fc8f-43f4-8683-f3893e5394f1' and status = 'pending'
union all select 'closed shifts on 09/06',    count(*)::text from public.time_entries t join public.profiles pr on pr.id = t.worker_id where pr.owner_id = '7d1e61b6-fc8f-43f4-8683-f3893e5394f1' and t.clocked_out_at is not null and (t.clocked_in_at at time zone 'UTC')::date = date '2026-09-06'
union all select 'still on the clock',         count(*)::text from public.time_entries t join public.profiles pr on pr.id = t.worker_id where pr.owner_id = '7d1e61b6-fc8f-43f4-8683-f3893e5394f1' and t.clocked_out_at is null;

-- B. Every rate matches the labor already booked against that man.
select full_name, hourly_rate from public.profiles
 where owner_id = '7d1e61b6-fc8f-43f4-8683-f3893e5394f1' order by full_name;

-- C. Miller Road deck is over budget on materials again.
select name, materials_budget, labor_budget, profit_target, budget, revenue,
       (select coalesce(sum(amount),0) from public.receipts r where r.project_id = p.id) as receipts
  from public.projects p where id = 'b2000006-0000-4000-8000-000000000006';
