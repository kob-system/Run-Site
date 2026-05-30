# Run-Site — Owner's Launch Checklist
_Everything that's YOURS to do to get to production-perfect. The code is done on branch `claude/night-hardening-0530` (17/17 tests pass, build clean)._

## 🚨 1. Rotate the leaked Anthropic key (do first)
- Go to **console.anthropic.com → Settings → API Keys**.
- **Revoke** the old key, **create a new one.**
- The new key goes ONLY in Vercel as `ANTHROPIC_KEY` (step 2) — never in `.env` with a `REACT_APP_` prefix again. (Code already enforces this.)
- _Optional hygiene (later, do together):_ scrub the old key from git history with BFG / git-filter-repo + force-push. Once rotated the old key is worthless, so this is cleanup, not urgent.

## ⚙️ 2. Vercel → Project → Settings → Environment Variables (Production)
Make sure ALL of these exist:
- `REACT_APP_SUPABASE_URL`
- `REACT_APP_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_KEY`  ← the new one
- `RESEND_API_KEY`
- `RESEND_FROM`  ← optional, set after step 4 (e.g. `Run-Site <notifications@yourdomain.com>`)

## 🗄️ 3. Supabase → SQL Editor
- Paste & run **`FIX-DATABASE-4-audit-hardening.sql`** (the audit DB fixes: assignment-bound worker writes, no-duplicate-shifts index, RLS helpers, private receipts bucket).
- **Email confirmation** (Authentication → Email): ON or OFF both work now. OFF = instant signup, simplest for a crew.

## 📧 4. Resend (so clock-in emails actually arrive)
- Verify a sending **domain** in Resend, then set `RESEND_FROM` (step 2) to an address on it.
- Until you do, clock-in/out emails only deliver to your own Resend account email — everything else works fine.

## 🚀 5. Deploy (the gate — fixes the stale-production problem too)
> ⚠️ **Run step 3's SQL FIRST.** The new offline-sync code relies on the
> `client_id` column + unique index from that migration. If the code goes live
> before the SQL runs, clock-in/sync will error until you run it. (There's one
> shared Supabase DB, so running the SQL covers both the preview and production.)
1. `git push -u origin claude/night-hardening-0530`
2. Vercel auto-builds a **Preview** URL (zero risk to your live site).
3. Test on the preview (step 6).
4. Merge to `main` + **Promote to Production** (or `npx vercel --prod`).
5. Confirm the live bundle hash changes off `main.d308d8c5.js` and the **"Edit Job Details"** button appears.

## 🧪 6. Test on the preview before promoting
Functional (9-step): job shows Projected Profit $2,000 + Edit Job Details · add materials receipt $300 → 30% bar · add "other" $100 → profit $1,600 · scan a receipt photo · edit job → contract $2,500 · delete the "other" → profit +$100 · worker signup (different email) → clock in (allow GPS) → clock out → owner sees location + labor $ · delete a time entry → labor drops · mark complete → Reports → CSV downloads.

Audit-specific: **airplane-mode** clock in → clock out → turn wifi back on → exactly ONE entry appears (no dupes, nothing lost) · open the tax CSV → the TOTALS row adds up to the rows above · open a receipt photo → it still displays · a worker only sees jobs they're assigned to.

## 📋 Known small leftovers (low priority, not blockers)
- A few OwnerDashboard modal `<label>`s still need `htmlFor`/`id` (a11y) — Login + Worker screens are done.
- The `find-owner` signup endpoint can't be hard rate-limited without adding Vercel KV/Upstash — it's the one intentionally-public endpoint; low risk.
