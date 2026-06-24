# Ship Run-Site to Josh — Runbook (2026-06-16)

Preview-first plan. Your live site stays untouched until the last step.
The 4 features Josh asked for are already built and verified; this is the "set it up" part.

Branch pushed for preview: **`josh-test-2026-06-16`** (commit `015994a`, builds clean).

---

## STEP 1 — Run 3 SQL migrations in Supabase (~3 min)
Supabase → your Run-Site project → **SQL Editor** → New query → paste each file's
contents → **Run**. All three are idempotent (safe even if already applied).

Run these (any order):
1. `FIX-DATABASE-8-owner-time-and-worker-mgmt.sql`  ← owner manual time entry + remove-worker
2. `FIX-DATABASE-10-worker-photos.sql`              ← lets crew add job photos (may already be applied)
3. `FIX-DATABASE-11-worker-invites-and-time-off.sql`← invite links + time-off requests

If any line errors with "already exists," that's fine — it means it was applied before.

## STEP 2 — Get the preview URL from Vercel (~1 min)
Vercel → **Run-Site** project → **Deployments** → find the build for branch
**`josh-test-2026-06-16`** → **Visit**. That's your zero-risk preview URL.
(Confirm env vars exist for Preview too: `SUPABASE_SERVICE_ROLE_KEY` is the one the
invite resolve/claim endpoints need — without it, invites won't resolve.)

## STEP 3 — Test the 4 new features on the preview (~5 min)
Use a second email for the worker (e.g. `you+worker@gmail.com`).
1. **Invite:** Owner → Workers tab → Invite a worker → name → Copy link.
2. **Worker signup via link:** open the copied link in another browser/phone →
   set password → confirm they land in the worker app, already linked to you.
3. **Clock in/out** (allow GPS) → owner sees hours + location + labor $.
4. **Schedule:** owner assigns worker to a job/day → worker sees it under Schedule.
5. **Time off:** worker files a date range + reason → owner sees it in Workers →
   Approve → worker sees "Approved."
6. **Photos:** open a job on the worker phone → Photos → confirm it offers BOTH
   "Take Photo" and "Photo Library" → add one from the library → owner sees it.
7. **Remove worker:** owner → Workers → Remove → confirm their logged hours stay on the job.

## STEP 4 — Promote to production (only after preview passes)
Two options:
- **Merge:** merge `josh-test-2026-06-16` → `main` on GitHub, then in Vercel
  **Promote** that deployment to Production (or `npx vercel --prod`).
- Make sure the live bundle changes to **`main.d429ccde.js`** and the new
  Workers-tab "Invite a worker" button appears. That confirms prod is on the new build.

> Heads-up: a past manual deploy pinned production to an old commit, so plain
> `git push` lands as a preview, not prod. You must explicitly **Promote to Production**
> in Vercel (or `vercel --prod`) for Josh's live URL to update.

## Notes
- **Billing is dormant** — the Stripe code is bundled but only paywalls if
  `REACT_APP_BILLING_ENFORCED` is on (it isn't). Josh won't hit a paywall. Leave it off.
- Hand Josh the updated **`Josh-Start-Here.md`** (now describes the invite-link flow).
- After Josh confirms on the live URL, this branch can be deleted.
