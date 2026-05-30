# Run-Site

Contractor job-tracking app. Owners manage projects/budgets/workers; workers clock in/out and log receipts from the field (mobile-first, offline-capable).

## Stack
- **React 18** via **Create React App** (`react-scripts`) — *not* Next.js. No TypeScript.
- **Supabase** — auth + Postgres (`@supabase/supabase-js`). Client in `src/supabaseClient.js`.
- **Serverless functions** in `/api` (Vercel-style `export default async function handler(req, res)`).
- **Hosting:** Vercel.

## Commands
- `npm start` — dev server
- `npm run build` — production build
- `npm test` — react-scripts/Jest tests
- ⚠️ Do not run `npm run eject`.

## Architecture
- `src/App.js` — root. Reads Supabase session → loads `profiles` row → routes by `role`:
  - `role === 'worker'` → `WorkerDashboard`
  - otherwise (owner) → `OwnerDashboard`
  - no session → `Login`
- `src/pages/Login.js` — email/password auth. Owners sign up directly; **workers link to an owner by entering the owner's email** (looked up in `profiles` where `role='owner'`).
- `src/pages/OwnerDashboard.js` — projects, budgets, receipts (with photo viewer), worker oversight.
- `src/pages/WorkerDashboard.js` — clock in/out timer, schedule, history. **Offline-first**: entries cached in `localStorage` (`runsite_offline_entry`) and synced on reconnect (up to `MAX_RETRIES`).
- `src/components/` — `BudgetBar`, `Toast`. `src/utils/` — `formatCurrency`, `formatTime`.
- `/api/notify-owner.js` — emails the owner on clock in/out via **Resend** (`RESEND_API_KEY`).
- `/api/scan-receipt.js` — OCRs a receipt photo via **Claude Haiku** (`claude-haiku-4-5-20251001`, Anthropic API, `ANTHROPIC_KEY`) → returns store + amount.

## Data model (Supabase)
- `profiles` — `id` (= auth user id), `email`, `role` ('owner' | 'worker'), `name`, `company`, owner linkage for workers. Created on signup (App.js retries fetch once after 2s to handle creation lag).
- Other tables referenced by dashboards: projects, time entries, receipts (confirm in Supabase before changing schema).

## Conventions
- Functional components + hooks only.
- **Inline styles** are the norm (see Toast/PhotoViewer); match that rather than introducing a CSS framework.
- Mobile-first UI: bottom-centered toasts, bottom-sheet modals, large tap targets.
- Supabase access via the shared `supabase` client — never re-create it.

## Environment variables
- Frontend (CRA, must be prefixed `REACT_APP_`): `REACT_APP_SUPABASE_URL`, `REACT_APP_SUPABASE_ANON_KEY`
- Serverless (Vercel env): `RESEND_API_KEY`, `ANTHROPIC_KEY`
- `.env` is gitignored — never commit secrets.

## Gotchas
- CRA env vars are baked at build time and must start with `REACT_APP_`.
- Worker signup fails clearly if the owner email doesn't exist yet — owner must sign up first.
- Offline sync: test online/offline transitions when touching `WorkerDashboard` clock logic.
