# Run-Site — Engineering Handoff (high-end build)

_Last updated: 2026-06-01. Read this first; it is the single source of truth for continuing._

---

## 0. TL;DR

Run-Site is **live** as a full small-contractor toolkit (~30 features) at **runsite-pearl.vercel.app**. The next phase is to build the **"hard"/professional features** to a **high-end, production-grade standard** (real payments, accounting sync, server-sent PDF emails + e-sign, SMS automation, customer portal, drag-drop scheduling, dashboards, integrations). The owner (JP) explicitly wants **expert app-building, not a beginner bolt-on.**

---

## 0.5 OVERNIGHT AUTONOMOUS RUN — night of 2026-06-01

JP is asleep; Claude works autonomously to perfect every inch of the app. JP is leaving **Chrome open + logged in** so logged-in screens can be verified.

**Operating rules (critical):**
- **Verify EVERY deploy against the LOGGED-IN owner dashboard** (his session persists in Chrome localStorage; open a new tab to runsite-pearl.vercel.app → same origin → logged in). After each deploy: reload, confirm the OWNER DASHBOARD renders (a TDZ/render bug in OwnerDashboard white-screens ONLY the logged-in app — the login page renders fine, so checking the login page does NOT catch it).
- **If the app shows logged-out** (his session dropped): STOP deploying. Switch to non-deploy work (audit/read code, write tests, update this log). Never leave the live client demo broken/unverified.
- Small, build-checked (`CI=true`), individually-verified commits. Keep the demo data intact. End commit msgs with the Co-Authored-By line.
- The big OwnerDashboard refactor: incremental only, green build + logged-in verify each step.

**Plan (priority):** (1) drag-drop scheduling · (2) whole-app bug/edge-case audit → fix · (3) accessibility pass · (4) WorkerDashboard polish · (5) consistency + copy + empty/error/loading states · (6) tests (money, CSV/QBO builders) · (7) incremental OwnerDashboard refactor.

**PROGRESS LOG (newest last) — update after every item:**
- ✅ QuickBooks CSV export. Deployed + build-verified. Logic now UNIT-TESTED (`src/features/quickbooks.test.js`) → export verified independent of a browser; logged-in eyeball now just nice-to-have.
- ✅ Insights dashboards (bundle 94014b79). Deployed + build-verified. Logged-in eyeball PENDING.

--- Night of 2026-06-01 (autonomous) ---
- ⚠️ **BLOCKER → NON-DEPLOY MODE:** TWO Chrome browsers are connected ("Browser 1" + "Browser 2"); the browser tool REQUIRES the user to pick one before any browser action. JP is asleep → asking would stall the loop, so I CANNOT verify logged-in this run. Per the operating rule I switched to NON-DEPLOY work: anything that changes the app bundle is committed **LOCALLY but NOT pushed** (held for a ~30-sec logged-in verify in the morning). True no-ops (tests) get pushed. `git log origin/main..main` lists everything held.
- ✅ Tests: added `src/utils/csv.test.js` + `src/features/quickbooks.test.js`. Suite 36/36 green (was 17). **PUSHED `ba53467`** (no bundle change → zero deploy risk).
- ✅ Audit: deep read-only bug/a11y audit of `OwnerDashboard.js` (delegated to a subagent for context economy). Backlog below.
- ✅ Fix batch 1 (crash/null safety) — **LOCAL-ONLY `5c35214`** (ahead of origin 1), build-checked: `estSubtotal` Array.isArray guard (fixes a real white-screen if `est.items` is ever a non-array), `confirmScan` null guard, `parseInt(…,10)` radix.

- ☑️ MODE CONFIRMED (JP, leaving for work): **bank-changes mode** — keep banking tested, build-checked LOCAL commits all day; DO NOT deploy. Live demo stays exactly as-is (safe to show Josh anytime). JP will **remote into this computer** to reach this session; computer stays on + plugged in. The 2-browser ambiguity is moot until we deploy together.

**WHEN JP REMOTES IN (deploy session):** push held commits ONE AT A TIME, reload the LOGGED-IN owner dashboard after each, confirm it renders (not white). Then continue the audit backlog.

**AUDIT BACKLOG — work through, mark done as you go:**
- CRASH — [x] est.items non-array crash → FIXED (5c35214, held). [ ] VERIFY-ONLY: `fetchProjectDetails` line ~449 `time_entries .select('*, profiles(full_name)')` is a BARE embed; likely safe (table seems to have a single profiles FK) but its CREATE TABLE isn't in repo migrations — if `time_entries` has BOTH owner_id+worker_id FKs this returns HTTP 300 and the Time tab blanks → then add `profiles!time_entries_worker_id_fkey(full_name)`. Confirm FK count against live DB FIRST (a wrong hint name breaks it).
- DATA-WRONG (money — review before deploy) — [ ] `acceptEstimate` ~712: tax is in `total` but profit = total−materials−labor, so sales tax is absorbed as profit and inflates the job's profit target. Fix: profit from PRE-TAX subtotal, budget = subtotal. DECISION NEEDED: should contract price include sales tax? Flag for JP. [ ] Tax Pack "TOTAL INCOME" ~1099 = contract value of completed jobs, NOT cash received (misleading for cash-basis). Safe fix: relabel; better: base on paid invoices. [ ] `fetchWorkerStats` ~268: month boundary computed local then ISO→UTC, string-compared → entries in first/last hours of a month can land in the wrong month for a non-UTC owner; parse both sides to Date.
- UX — [ ] `fetchProjectDetails` ~444: doesn't clear detail arrays before the awaits and ignores per-query errors → opening job B flashes job A's data; a failed sub-query leaves stale data silently. Fix: reset arrays at top (SAFE part) + check each error. [ ] `selectedProject` goes stale after edits (hand-merged) → re-select fresh row from refreshed `projects`. [ ] Secondary tabs (estimates/invoices/compliance/warranties/calendar) show empty-state with no loading flag → flash of "No X yet"; add per-tab loading flag (SAFE-ADDITIVE). [ ] Receipt scan: cancel after scan-upload orphans the storage file; best-effort remove on cancel (low pri).
- A11Y (all SAFE-ADDITIVE except modals) — [x] icon-only buttons (×, ←, delete) aria-label → DONE. [x] clickable `<div className="card">` rows role="button"+tabIndex+onKeyDown → DONE. [x] click-to-cycle status pills role="button"+tabIndex+aria-label+keydown → DONE. (All 18 edits in held commit, build-checked.) [ ] form `<label>`s not associated to inputs (no htmlFor/id) → associate via id/htmlFor (NOT wrapping — wrapping restructures DOM). [ ] modals: role="dialog"/aria-modal + focus trap + Escape + restore focus (MODERATE — needs logged-in verify).
- AUDIT CONFIRMED CLEAN (no bug): TDZ ordering, date off-by-one (T00:00:00 already used for date-only cols), divide-by-zero guards, change-orders flow into contract price, `warranties` has only one profiles FK (no embed ambiguity).

## 1. Current state (verify before building)

- **Production:** `main` → `runsite-pearl.vercel.app` (Vercel team `kobrossisystems-4821s-projects`, project `runsite`). Auto-deploys on push to `main`.
- **Repo:** github.com/kob-system/Run-Site. Local: `C:\Users\Jpkob\Desktop\run-site` (primary). Second main-only clone at `C:\Users\Jpkob\vibe code\Run-Site`.
- **Stack:** Create React App (CRA) + Supabase (Postgres/Auth/Storage/RLS, ref `yvwpesvjfdofsxvtooha`) + Vercel serverless (`api/`) + Resend (email) + Claude API (receipt OCR). PWA.
- **Demo login (seeded, don't wipe):** `Firstclasspropertyservices7@gmail.com` / `FirstClass2026`. Workers: `mike@firstclassdemo.com`, `dave@firstclassdemo.com` / `demo-pass`.
- **DB:** migrations `FIX-DATABASE-4..7.sql` all applied. ~19 tables, all owner-RLS. Files (photos/docs) live in the private `receipts` storage bucket.
- **Verify quickly:** load the site, confirm it renders (not a white screen), check `main` HEAD == deployed bundle. `git log --oneline -5`.

## 2. Mission & quality bar

Build the following to **professional standard**. "Professional" here means:
- **Proper backend.** Payments/webhooks/PDF/email/SMS run in `api/` serverless functions, never the client. Verify webhook signatures. Make all money-affecting handlers **idempotent** (Stripe retries; use the event id / a processed-events table).
- **Secrets discipline.** Every key is a Vercel env var, server-side only. **Never** prefix a secret with `REACT_APP_` (that ships it in the client bundle — a live Anthropic key was leaked exactly this way and had to be rotated). Add a `.gitignore`d `.env.local` for local dev.
- **Security review** of the two new attack surfaces: the **public customer portal** (unauthenticated, token-scoped) and **payment webhooks**. Threat-model token guessing, replay, IDOR, amount tampering.
- **Engineering hygiene:** loading/empty/error states everywhere, optimistic UI where safe, accessibility (labels, focus, contrast, 44px targets), performance (code-split heavy libs like the calendar/charts/PDF), and **tests** for money math + webhook handlers.
- **Refactor where it earns it.** `src/pages/OwnerDashboard.js` is now **~2,400 lines in one file**. Before adding the portal/scheduling/dashboards, extract feature modules/components (e.g. `features/invoices`, `features/estimates`, `components/`) and shared hooks. Do it incrementally with a green build at each step — do NOT big-bang rewrite the working app.

## 3. Per-feature professional design

### A. Real payment processing — **Stripe** (recommended over Square)
- **Flow:** Invoice → "Collect payment" → server creates a **Stripe Checkout Session** (or Payment Intent) for that invoice's amount, metadata `{invoice_id, owner_id}` → client/portal redirects to Stripe → on success, **webhook** `checkout.session.completed` → mark invoice `paid` + record a `payments` row (store `stripe_payment_intent`, fees, net). Idempotent on event id.
- **New table:** `payments(id, owner_id, invoice_id, amount, fee, net, stripe_payment_intent, created_at)`. Add `invoices.stripe_session_id`, `paid_via`.
- **Endpoints:** `api/create-checkout.js`, `api/stripe-webhook.js` (raw body + `stripe.webhooks.constructEvent` signature check).
- **Needs from JP:** a **Stripe account** + `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (Vercel env). Publishable key can be client-side. Build in **test mode** first.
- **Safety:** build the integration; never enter card/bank numbers or move funds manually. The app + Stripe process payments; JP owns the Stripe account.

### B. QuickBooks — **CSV export, NOT live API sync** (decided 2026-06-01)
JP confirmed Josh uses QBO but prefers export→import over a live integration — kills the heaviest piece. QBO **natively imports CSV/Excel**: invoices (≤100/batch, ≤1000 rows, no credit-memos), customers, products/services; expenses are partial-native (often need a bank-import/3rd-party path).
- **Build a "QuickBooks export"** (in Reports / near Invoices) generating QBO-import-formatted CSVs: **Invoices** + **Customers** are the clean native imports (primary value: Josh's billings → QBO). Mirror QBO's exact sample-file column headers (download samples from a real QBO account to match field names). Expenses can ride the existing **Tax Pack** or a bank-import CSV — don't over-promise native expense CSV.
- **No accounts, no Intuit app, no OAuth, no production review** → **buildable NOW** (it's a formatted CSV like the Tax Pack).
- Tradeoff vs the old live-API design: manual periodic export→import instead of real-time auto-sync — fine at this scale. The live-API approach (OAuth, webhooks, token refresh, Intuit review) is parked; revisit only if JP later wants full automation.

### C. Server-sent emails + PDF + e-signature
- **Email:** replace the `mailto:` shortcuts with **Resend** server sends (`api/send-document.js`) — HTML email + **PDF attachment**. (`api/notify-owner.js` already shows the Resend pattern; today it uses `onboarding@resend.dev` + `NOTIFY_OVERRIDE_TO` because no domain is verified.)
- **PDF:** generate server-side. Options: `pdf-lib` (lightweight, programmatic) or `@react-pdf/renderer` (JSX templates) or Puppeteer/Chromium-on-Vercel (heaviest). Recommend `@react-pdf/renderer` for branded estimate/invoice docs.
- **E-signature:** estimate email contains a tokenized portal link → client reviews → draws/types signature on a `<canvas>` → store `estimates.signed_at`, `signature_png`, `signed_name`, `signed_ip`. (Full DocuSign-grade is overkill; a captured signature + audit trail is the right bar for this market.)
- **Needs from JP:** a **domain** (he didn't have one) to verify in Resend (DNS records) so email sends from `you@hisdomain.com` and the portal lives on a real URL. This **gates C-email + the portal** going live.

### D. Automated comms / SMS — **DROPPED (JP, 2026-06-01)**
Cut from scope. (Would have been Twilio reminders + auto review-requests, gated on A2P 10DLC.) Do not build unless JP re-requests.

### E. Customer portal (public, tokenized)
- **What:** unauthenticated pages at `/p/<token>` where a client can view their estimate or invoice, **approve & e-sign** (C), and **pay** (A) — no account needed.
- **Security:** opaque high-entropy token per document (NOT the row UUID); server-side resolution only; read-only except the approve/pay actions; rate-limit; never expose other rows (IDOR). Use a Supabase `security definer` RPC or a serverless resolver with the service-role key, scoped to the token.
- This ties A+C+E into the "send quote → client approves & pays online" loop that makes it feel like Jobber/Housecall.

### F. Drag-drop scheduling
- Replace/augment the agenda Calendar with a real calendar grid + drag-drop to create/move crew assignments. Lib: **FullCalendar** (resource-timeline view = crew columns) or `react-big-calendar`. Code-split it (don't bloat the main bundle). Writes to existing `schedule_entries`.

### G. Reporting dashboards
- Charts (recharts/visx/Chart.js): revenue over time, **AR aging** (owed buckets), job profitability, estimate win-rate, labor-cost trend. Keep the existing CSV/Tax Pack exports. New "Insights" screen (or upgrade Reports).

## 4. Build order (revised per JP 2026-06-01)
**Start now — needs ZERO external accounts:**
1. **Refactor pass** (extract OwnerDashboard into feature modules; green build at each step).
2. **B — QuickBooks CSV export** (QBO-formatted invoices + customers CSVs; like the Tax Pack). Quick, high value for Josh.
3. **G — reporting dashboards** (charts: revenue, AR aging, job profitability, estimate win-rate).
4. **F — drag-drop scheduling** (FullCalendar/react-big-calendar; code-split).

**At the end — JP sets up Stripe + a domain, then:**
5. **C — server PDF emails** (Resend on the verified domain).
6. **A — Stripe payments** + **E — customer portal** + **C-e-signature** (the "send → approve → e-sign → pay online" loop).

**SMS — dropped.**

## 5. What JP must provide (gating — "at the end", per JP)
- **Stripe** account → `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (payments). Build in test mode meanwhile.
- **A domain** → verify in Resend (DNS) for the real "from" + the customer-portal URL. Biggest single unblocker (gates email + portal).
- **QuickBooks:** nothing needed — it's a **CSV export** (§3B), not the live API. Builds now, no accounts.
- ~~Twilio / SMS~~ — dropped.
All keys go in **Vercel env vars** (server-side only).

## 6. Codebase facts & gotchas (do not relearn the hard way)
- **`OwnerDashboard.js` is one ~2,400-line file.** Patterns: state at top; `useCallback` fetchers; a `selectedProject` detail view with a scrollable sub-tab bar (`.tabs-scroll` in `src/App.css`); main tabs `['home','jobs','estimates','invoices','clients','calendar','workers','payroll','reports','more']`. Money helpers in `src/utils/money.js` (`computeProfit/Margin/ContractPrice/roundCents`).
- **React TDZ trap:** any `useEffect` whose dep array references a `useCallback` MUST appear AFTER that callback is declared, or production white-screens with `Cannot access 'X' before initialization`. (Bit us once — fetchInvoices.) Build-check (`CI=true npm run build`) compiles fine but does NOT catch TDZ — **always reload the deployed app and confirm it renders.**
- **Migration before deploy:** apply the SQL migration (Supabase) BEFORE pushing code that reads new tables, or prod breaks. (Bit us once.)
- **RLS pattern:** every table = `owner_id uuid references profiles(id)`, RLS on, policy `for all using (owner_id = auth.uid()) with check (owner_id = auth.uid())` + indexes. `schedule_entries`/`warranties` have TWO FKs to profiles → PostgREST embeds MUST hint the FK: `profiles!schedule_entries_worker_id_fkey(full_name)` (ambiguous embed returns HTTP 300 + empty render).
- **Storage:** uploads go to the private `receipts` bucket under `${profile.id}/...`; view via short-lived `createSignedUrl`. `photo_url`/`file_url` may also be a full external URL (the `JobPhoto` component + doc opener handle both).
- **Build/deploy:** `cd Desktop\run-site; $env:CI='true'; npm run build` (CRA; `.env.production` sets `DISABLE_ESLINT_PLUGIN=true`). Push `main` → Vercel deploys in ~20–60s. Bundle hash changes on real source changes.
- **Driving Supabase SQL editor via Claude-in-Chrome:** Monaco; synthetic paste blocked. Inject SQL as UTF-8 base64 → decode → `model.setValue()` (checksum-guard the embed). DROP/UPDATE/ALTER show a "Potential issue detected" dialog → click its **Run query** (find by button text via `javascript_tool` if `computer` screenshots time out — they do intermittently).
- **Secrets already in Vercel:** `REACT_APP_SUPABASE_URL`, `REACT_APP_SUPABASE_ANON_KEY` (public), `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `RESEND_FROM`, `NOTIFY_OVERRIDE_TO`, `ANTHROPIC_KEY` (server-side; rotated after a prior leak — keep server-only).

## 7. Demo / data notes
- The demo account is fully populated for client walkthroughs; **don't wipe it.** Seeds were one-off idempotent SQL DO-blocks (skip-if-exists). New features should seed a small realistic sample too.
- Job photos use real Unsplash URLs (no CSP, so external images load). The "payment link" on the Kitchen "Progress draw" invoice is a placeholder Stripe test URL — replaced by real Stripe in feature A.

---

_End of handoff. Start at §4 step 1 (refactor) unless JP directs otherwise._
