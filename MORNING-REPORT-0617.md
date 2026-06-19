# Run-Site — Morning Report (overnight 2026-06-17)
_Worked while you slept. Branch `claude/overnight-0617` — nothing merged to `main`, nothing deployed. Your live site is untouched._

## TL;DR
You asked for three things overnight: **competitor intel**, **post-mortems on apps built with AI/Claude Code** (and whether Run-Site has those problems), and a **front-end design pass**. All three are done:

- **92-agent research fleet** ran (~49 min): 12 competitors profiled, 33 real launch pitfalls researched, **18 cross-referenced against your actual code**, 55 design findings — each adversarially verified before it counted.
- **Design: shipped 4 commits** of verified fixes — every one of the 9 high-severity findings plus the key mediums. Production build clean, **36/36 tests pass**, Login + Signup screenshot-verified.
- **Honest status on the 20th:** the *code* is in good shape. What stands between you and live is still the **~15 min of owner-only setup** (key rotation, env vars, SQL, Resend, deploy) — I can't do those for you. I made them safer and added a build badge so you can *prove* prod updated. Details below.

---

## 1. What I shipped tonight (design — on the branch)

All verified: clean production build + 36/36 tests. Login/Signup also screenshot-checked at phone size.

**Foundation (every screen benefits)**
- Found and fixed a real bug: **`index.css` was never imported** — your design tokens were dead code and the body font was silently coming from `App.css`. Now imported, so a shared color/spacing/radius system actually applies.
- Buttons got hover/active/disabled states; inputs bumped to **16px (stops iOS auto-zoom on focus)**; **44px minimum tap targets**; a keyboard focus ring; a loading spinner.

**Login / Signup** _(screenshot-verified)_
- Friendly error messages (no more raw Supabase wording), **show/hide password**, keychain/autocomplete hints, autofocus, bigger role-toggle buttons, a password length hint, and a card shadow so it reads premium, not like a default React app.

**Worker app** _(build-verified — see "not screenshot-verified" note)_
- **Clock Out** is now as big/tappable as Clock In (end-of-day is the most important tap; it was the smaller button).
- While clocked in, the screen now shows **which job + address** (was just a bare timer).
- Darkened washed-out grays that fail in sunlight on a job site.

**Owner dashboard** _(build-verified)_
- **Projected-profit hero at the top of the Budget tab** with live margin % (it was buried as the last of six cards).
- **Job-list cards now show profit** — projected profit on active jobs, final profit on completed jobs (previously the one number that matters was hidden).
- Stopped showing routine in-budget spending in alarm-red.

**Deploy confidence**
- **Build-version badge** on the login screen (`build <sha> · <time>`). After you promote, open the prod URL and confirm the SHA matches what you shipped — this directly kills your documented "is prod even updated?" problem.

> **One caveat:** the worker & owner dashboards are **build-verified but not screenshot-verified**, because I don't have a test login to your shared Supabase and I won't create accounts in your production DB unprompted. The changes are additive markup using data the code already uses. **Eyeball them on the Vercel preview before promoting.**

---

## 2. Research delivered (3 reports in the repo)
- **`COMPETITORS-0617.md`** — Jobber, Housecall Pro, ServiceTitan, FieldPulse, Workiz, Joist, etc. + a positioning brief.
- **`LAUNCH-RISKS-0617.md`** — 33 pitfalls, 18 checked against your code, with file:line evidence and exact fixes.
- **`DESIGN-AUDIT-0617.md`** — all 55 verified design findings by screen (I implemented the high-severity + key mediums; the rest are your backlog).

### Competitor wedge (the short version)
Every rival has the **same three weak spots** you can attack on a cold call:
1. **Per-seat pricing that punishes growing crews** (Jobber +$29/user/mo; ServiceTitan $250–500/*tech*/mo). Run-Site = flat, workers included.
2. **The add-on trap & surprise bills** (Housecall Pro advertised at $59 routinely hits $1,600+/mo; cancellation horror stories). Run-Site = honest flat price, one-click Stripe cancel.
3. **Nobody does live per-job profit** — they're quoting/scheduling tools. Run-Site's "see your margin on every job, materials/labor/profit" is a genuine differentiator. Lead with it.

---

## 3. Top launch risks = YOUR gate (can't be fixed in code alone)
From the code cross-reference. Full detail + exact SQL/commands in `LAUNCH-RISKS-0617.md`.

**Must verify before the 20th:**
1. **Receipt/photo storage — confirm the private-bucket fix is live.** Read-exposure was patched in `FIX-DATABASE-4`, but if that SQL was never run on prod, every contractor's receipts are world-readable. Run the verify query in the report. _(Also: a cross-tenant **upload** policy is still loose — I did **not** auto-write the migration because the naive fix breaks worker photo uploads; it needs a decision first. Flagged in the report.)_
2. **RLS helper functions** (`is_owner_of_project` / `is_worker_on_project`) exist only in the live DB, in no committed migration — a fresh re-provision would fail and you can't prove they're recursion-safe. The report has the exact `pg_proc` query to confirm the live versions, and the correct `plpgsql` definitions to commit.
3. **Rotate the leaked Anthropic key** (still outstanding from the May audit) and set Vercel env vars.

**Should do soon (not a 20th blocker):**
4. **No rate limiting** on `scan-receipt` (real $) and `notify-owner` (email spam). Report has a no-new-infra Supabase-counter approach. Minimum: set a hard spend cap in the Anthropic console as a backstop tonight.
5. The stale-deploy trap itself — the new build badge is the detection fix; the report also suggests a `vercel.json` to remove the manual-promote step.

---

## 4. Go-live path for the 20th (your ~15 min)
1. Push the branch → Vercel makes a **Preview** (zero risk). `git push -u origin claude/overnight-0617`
2. On the preview: log in, check the new login polish, the worker clock screen, and the profit hero/job-card profit. Confirm nothing's off.
3. Run the `LAUNCH-RISKS` verify queries in Supabase (items 1–2 above). Apply `FIX-DATABASE-4` if it was never run.
4. Rotate the Anthropic key; confirm Vercel env vars; set the Anthropic spend cap.
5. Merge to `main` → **Promote to Production** → open prod and confirm the **build badge SHA** matches.

---

## 5. What I deliberately did NOT do
- No merge, no deploy, no production-DB writes, no key rotation — your gates.
- Didn't auto-write the storage-upload migration (known footgun — breaks worker photos until reconciled).
- Left the design backlog (lower-severity findings in `DESIGN-AUDIT-0617.md`) for a future pass.

_Commits: `b68e7b5` (foundation+Login+Billing), `da75788` (worker+owner profit), `316ce08` (build badge). Review with `git diff 015994a`._
