# Run-Site — Go-Live Checklist (2026-06-21)
_The single source of truth. Supersedes NIGHT-REPORT / MORNING-REPORT / DEPLOY-RUNBOOK._

**Where it stands:** Code is done and green (36/36 tests, clean build). The last hardening
pass (private-storage lockdown, RLS helpers, rate limits, pre-tax profit) is committed on
branch `claude/overnight-0617` — **one merge away from production**. Everything left is
owner-only: things only you can do (DB, secrets, merge). ~20 min total.

Do them in this order.

---

### 1. Rotate the leaked Anthropic key  _(5 min — do first)_
- Anthropic Console → API Keys → **revoke** the old key → create a new one.
- Console → Billing → **Usage limits** → set a hard monthly cap (e.g. $20) as a backstop.

### 2. Set Vercel env vars (Production)  _(3 min)_
Vercel → Run-Site → Settings → Environment Variables. Confirm all exist for **Production**:
`REACT_APP_SUPABASE_URL` · `REACT_APP_SUPABASE_ANON_KEY` · `SUPABASE_SERVICE_ROLE_KEY` ·
`RESEND_API_KEY` · `ANTHROPIC_KEY` (← paste the NEW key from step 1).

### 3. Run the database bundle  _(3 min)_
Supabase → SQL Editor → New query → paste **all of `RUN-THIS-IN-SUPABASE.sql`** → Run.
Then read the 4 verify results at the bottom against their "WANT:" notes. The ones that matter:
- **Bucket private** → `public = false`.
- **Storage policies** → NO "Receipt photos are publicly viewable" row left (that was a real cross-tenant leak found 2026-06-20).
- **RLS on every table** → that last query returns **zero rows**.

### 4. Merge to main = auto-deploy  _(2 min)_
Merge `claude/overnight-0617` → `main` on GitHub. Prod auto-deploys now (no manual Promote).

### 5. Confirm prod actually updated  _(2 min)_
Open **runsite-pearl.vercel.app** in an incognito window. On the login screen, the
**build badge** at the bottom should show the SHA you just merged. If it matches, prod is live on the new code.

### 6. Smoke-test on the live URL  _(5 min)_
- Sign up as owner → make a job → snap a receipt (tests the new Anthropic key + scanner).
- Invite a worker (Workers tab → Copy link), open on your phone, set password, clock in/out → confirm you see hours + location + labor.
- Reports → CSV export downloads.

---

### Then hand Josh `Josh-Start-Here.md`
That's the pilot. Goal = first real Run-Site user on a real job before **July 1**.

---

**Resend note:** clock-in emails currently send from `onboarding@resend.dev`, which only
delivers to your own Resend account email. To email Josh's address, verify a sending domain
in Resend. Not a launch blocker — everything else works without it.
