# 🧩 Working Patterns & How to Prompt Claude — JP

> Your two project types, their ideal architecture patterns, and the prompting style that gets the best results.
> Goal: a consistent way of working so every build is fast + professional. Last updated 2026-05-29.

## You do two kinds of work — each has a pattern

### Type 1 — Local business site (most of your work: maintenance, granite, car wash, deli…)
**Architecture pattern:**
- Component-based single site: `Hero → Services/Menu → About → Reviews → Contact → Footer`.
- Content-driven (no backend). Forms → Formspree or a tiny serverless function. Maps/links embedded.
- Stack: Next.js + Tailwind + shadcn/ui → **Vercel**. Cloned from your starter template.

**Build pattern (the right logic for this work):**
1. **Content first** — fill the Client Intake Brief before any building (kills back-and-forth).
2. **Clone the template**, then build/adjust **section by section** — small, reviewable steps.
3. **Plan Mode** for any non-trivial section.
4. **Review each diff**, commit per section.
5. Deploy preview → client review → point domain.

### Type 2 — App with backend (pump-puff-club, Run-Site)
**Architecture pattern:**
- React/Next frontend + **Supabase** (auth + Postgres) + **Stripe** (payments) + Vercel serverless functions.
- **Run-Site is your reference architecture** — same shape, already working.

**Build pattern (the right logic):**
1. **Schema first** — define the database tables before features.
2. **Auth next** — logins/roles (owner vs staff vs customer).
3. **Feature by feature** — one flow at a time, test each.
4. **Review every diff**, commit per feature.

---

## 🗣️ How to chat with me (your cheat sheet)
1. **One focus at a time.** Don't mix clients/tasks in one thread. (Use "switch to X" — see below.)
2. **Be specific.** ❌ "make a contact section" → ✅ "add a contact section: name/email/message form → Formspree, dark-green button matching the hero, phone click-to-call below."
3. **Give context:** name the file (`@file`) or the site, and any constraint, upfront.
4. **Be concise.** Skip the pleasantries — get to the point.
5. **Plan Mode for features**, review the plan, then let me build.
6. **Review every diff.** Never ship a client site you didn't look at.
7. **`/clear` between clients, `/compact` within a build** — or just say **"switch to X"** and I handle the handoff.

## 🤝 My job: I'll coach you
When your prompt is vague or mixing concerns, I'll **suggest a tighter version** before running — so over time your prompting gets sharper and your builds get faster. You don't have to remember all this; I'll nudge.
