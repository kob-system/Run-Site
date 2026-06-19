# CLAUDE.md — Run-Site

Guidance for Claude Code when working in this repo. Read this first, then
`HANDOFF.md` (the detailed engineering source of truth).

## What this is

**Run-Site** — a done-for-you toolkit app for small contractors (job tracking,
estimates, invoices, clients, scheduling, workers/payroll, receipt OCR,
reporting). Live at **runsite-pearl.vercel.app**. It is a flagship product of
**KS Digital** (John Paul Kobrossi's Capital Region NY agency). Originally built
for Josh / First Class Property Services.

## The bigger picture (the "brain")

The full company knowledge base — agency operations, clients, sales system,
pricing, and the Run-Site product roadmap — lives **privately in Notion** under
the **"AI Second Brain"** workspace:

- `00 — KS Digital Master Operating Doc (v3.0)` — agency source of truth
- `01-Company` · `02-Team` · `03-Marketing` · `04-Client` sub-brains
- `05 — Run-Site App Brain` — the deep build doc for THIS app

> **At the start of a business/agency-related session, pull context from Notion**
> via the Notion tools (search "AI Second Brain"). Client names, balances,
> contacts, and financials are intentionally kept in Notion and **must NOT be
> committed to this public repo.**

## Stack

CRA (Create React App) + Supabase (Postgres/Auth/Storage/RLS) + Vercel
serverless (`api/`) + Resend (email) + Claude API (receipt OCR). PWA.
`main` auto-deploys to Vercel.

## Quality bar

- Payments/webhooks/PDF/email run in `api/` serverless, **never the client**.
  Verify webhook signatures; make money handlers **idempotent**.
- **Secrets:** every key is a Vercel env var, server-side only. **NEVER** prefix
  a secret with `REACT_APP_` (that ships it in the public bundle — a live
  Anthropic key leaked exactly this way once).
- Loading/empty/error states everywhere; accessibility (labels, focus, contrast,
  44px tap targets); code-split heavy libs (calendar/charts/PDF); tests for
  money math + webhook handlers.

## Gotchas (don't relearn the hard way)

- **React TDZ trap:** any `useEffect` whose deps reference a `useCallback` must
  appear *after* that callback, or production white-screens. The build check
  does NOT catch this — **always reload the deployed app and confirm it renders.**
- **Run the SQL migration in Supabase BEFORE** pushing code that reads new
  tables, or prod breaks.
- **RLS:** every table has `owner_id`, RLS on, owner-scoped policy. Tables with
  two FKs to `profiles` (`schedule_entries`, `warranties`) need an explicit
  PostgREST embed hint or the query 300s.
- `src/pages/OwnerDashboard.js` is ~2,400 lines — extract feature modules
  incrementally with a green build at each step; do **not** big-bang rewrite.

## Build order (per JP, 2026-06-01)

Start now (no external accounts): **1)** refactor pass **2)** QuickBooks CSV
export **3)** reporting dashboards **4)** drag-drop scheduling.
At the end (after JP sets up Stripe + a domain): **5)** server PDF emails
(Resend) **6)** Stripe payments + customer portal + e-signature.
SMS is **dropped**.

See `HANDOFF.md`, `AUDIT-REPORT.md`, and `LAUNCH-CHECKLIST.md` for full detail.
