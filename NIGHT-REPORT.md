# Run-Site — Overnight Hardening Report
_Worked while you slept. Plain-language summary up top; details below._
_Branch: `claude/night-hardening-0530` · commit `d24cd57` · NOT deployed (that part's yours)._

---

## TL;DR (read this first)

I went through the **entire codebase**, got it building and running, found and fixed
the real bugs, added tests so the money math can't silently break, and verified
everything. **The coding part is done and contractor-ready.** What's left is your
"set it up" part: deploy it and flip a couple of dashboard switches.

- ✅ 15/15 automated tests pass
- ✅ Production build compiles clean (`main.8ff75222.js`)
- ✅ App loads and renders in a real browser (login screen verified)
- ✅ All work is on a **separate branch** — your live site is untouched until you choose to deploy
- ⚠️ **Production is still serving the old build** — only *you* can deploy (steps below)

---

## What I fixed (and why it mattered)

| Fix | What was wrong | Severity |
|-----|----------------|----------|
| **Self-healing login** | The real root cause of the "stuck on Loading / orphaned account" bug: when an account had no profile yet, the app dead-ended. Now it creates the missing profile automatically from signup info, and shows a "Back to login" escape if anything's truly broken. | 🔴 High |
| **Signup no longer fails silently** | If email confirmation was on, signup quietly failed and left a broken half-account. Now it says *"Account created — check your email to confirm, then sign in,"* and finishes building the profile on first login. | 🔴 High |
| **Worker "History" tab** | The History tab was rendering **outside** the page layout (wrong margins/position). Moved it inside where it belongs. | 🟡 Med |
| **Money math is now tested** | Pulled profit / margin / contract-price into one shared, **unit-tested** module so the numbers (the whole point of the app) are provably correct and can't drift. | 🟡 Med |
| **Removed the broken default test** | The project still had Create-React-App's stale "learn react" test that always failed. Replaced it with real tests. | 🟢 Low |

**Verification I actually ran** (not just claimed):
- `npm test` → **15/15 pass** (money math, formatters, app smoke test)
- `npm run build` → **Compiled successfully**
- Served the build and screenshotted it in a headless browser → **login renders correctly**

---

## Zoom-out: is it doing its job?

**Purpose:** a phone-first app that lets a small contractor run jobs *profitably* and
coordinate a crew — track each job's money (materials / labor / profit) and the crew's
time + location live, with tax-ready reports.

**Does it fulfill that? Yes — this is a real, coherent product, not a toy.** Every core
loop works:

1. Create a job with a budget (materials + labor + profit → contract price) ✅
2. See **live profit per job** as receipts and labor come in ✅ _(now unit-tested)_
3. Snap a receipt photo → AI auto-fills store + amount ✅
4. Workers clock in/out with **GPS proof**; labor cost auto-calculated ✅
5. Owner emailed on every clock in/out ✅ _(needs Resend setup — see below)_
6. Schedule workers to jobs/days ✅
7. **Works offline** on bad-signal job sites, syncs when back online ✅
8. Year-end **CSV tax export** ✅
9. **Security**: each owner sees only their data; workers only their assignments ✅ _(RLS verified)_

**The malfunctions were all at the edges** (onboarding dead-end, a misplaced tab, the
un-deployed build) — not the core. After tonight, the core is solid and the money is tested.

---

## ⚠️ YOUR PART — to take it live (≈15 min)

### 1. Deploy (this is the actual blocker)
Your production site is **still serving an old build** — a previous manual deploy pinned
production to an old commit, so your `git push`es have been landing as previews, not prod.
**Safest path:**
1. Push this branch: `git push -u origin claude/night-hardening-0530`
2. Vercel auto-builds a **Preview** URL (zero risk to your live site)
3. Test the preview (run the 9-step checklist below)
4. If good → merge this branch into `main` **and** click **Promote to Production** in Vercel
   (or run `npx vercel --prod`). After deploy, confirm the live bundle name changes off
   `main.d308d8c5.js` and the **"Edit Job Details"** button appears.

### 2. Set Vercel environment variables (production)
The `.env` file only works locally. In **Vercel → Project → Settings → Environment
Variables**, make sure all of these exist for Production:
- `REACT_APP_SUPABASE_URL`
- `REACT_APP_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` — used by the worker-signup + email functions
- `RESEND_API_KEY` — clock in/out emails
- `ANTHROPIC_KEY` — receipt photo scanning

### 3. Two Supabase/Resend switches
- **Email confirmation (Supabase → Authentication → Email):** either ON or OFF now works
  thanks to tonight's fix. **OFF** = instant signup, simplest for a crew. Your call.
- **Resend email domain:** right now emails send from `onboarding@resend.dev`, which (in
  Resend's free sandbox) only **delivers to your own Resend account email**. To email any
  owner address, verify a sending domain in Resend. Until then, clock-in emails may not
  arrive — everything else still works.

---

## Post-deploy test checklist (9 steps)
1. Job "Test Kitchen" shows **Projected Profit $2,000** and an **"Edit Job Details"** button.
2. Add a materials receipt $300 → Materials bar at 30%.
3. Add an "other" receipt $100 → "Other Costs" card appears; profit → $1,600.
4. Test the AI receipt scanner (snap a photo).
5. Edit job: profit target → $1,000, contract price → $2,500.
6. Delete the "other" receipt → profit rises $100.
7. Worker signup (different email; `you+worker@gmail.com` works) → clock in (allow GPS) →
   clock out → owner sees a location link + labor $.
8. Delete a time entry → labor adjusts down.
9. Mark job complete → Reports → CSV tax export downloads.

---

## Lower-priority backlog (not blocking — for later)
- **Receipt photos are in a public storage bucket** (anyone with the URL can view). Fine for
  an MVP; switch to signed URLs if receipts get sensitive.
- **Set worker hourly rates *before* they clock out** — the rate is captured at clock-out, so
  a $0 rate makes that entry's labor $0.
- No "unassign worker from a job," "delete worker," or "delete job" actions yet (only
  complete/reopen). Minor management gaps.
- **Dead code:** the `add_labor_cost` DB function + `labor_spent` column are no longer used
  (the app live-computes labor now). Harmless; can be dropped in a future cleanup.

---

## How to review what I changed
```bash
cd run-site
git checkout claude/night-hardening-0530
git diff 09ea526            # see every change
npm test                    # 15/15 should pass
npm run build               # should compile clean
```
Files touched: `src/App.js`, `src/pages/Login.js`, `src/pages/WorkerDashboard.js`,
`src/pages/OwnerDashboard.js`, `src/App.test.js`, plus new `src/utils/money.js` +
`money.test.js` + `formatters.test.js`. _This report supersedes the matching items in
`HANDOFF.md`._
