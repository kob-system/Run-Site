# ⚡ Claude Code Playbook (distilled from Mosh Hamadani's course + tuned to JP)

> How to build faster, cheaper, and at professional quality with Claude Code.
> Source: "Claude Code course" first hour (Mosh / codewithmosh). Tuned for JP: solo, client sites/apps, $100 Claude plan, limited time.
> Last updated 2026-05-29.

## The headline
- Anthropic engineers write **up to 90% of their code** with Claude Code.
- Mosh built a **full-stack support-ticket app in ~2 days** that would take **2–3 weeks** by hand.
- The catch: **it's not "VIP coding."** You review every line, refactor constantly, keep solid practices. AI does the mechanical part; **you stay the engineer.**

## 1. The golden discipline (this is what separates pro from slop)
- **Review every change.** Don't let Claude touch hundreds of files blindly — you lose the ability to review = the "VIP coding trap."
- **Set patterns early with SMALL tasks.** Claude copies patterns. Give it small, reviewable tasks first to establish your style; *then* it repeats that style across the app. Big chunks up front → it goes off the rails with inconsistent patterns.
- **Fix root causes, not symptoms.** When Claude patches a bug, check if it fixed the real cause. (Mosh's example: it converted a string→float to hide a bug; the real fix was storing the number correctly.) Push back with a follow-up prompt.

## 2. The core loop
1. **Plan Mode** (Shift+Tab) for any new feature → Claude drafts a plan, changes nothing until you approve. Review it, ask for changes ("add a confirmation dialog"), then accept.
2. **Break big features into small ones** so you can actually review.
3. **Build → review in source control → commit** after each task (so diffs stay comparable).
4. **Commit often.** Either via the source-control panel (fast) or by prompting `commit` (slower, costs tokens, but you get clean messages).

## 3. Prompting rules (huge quality lever)
- **Be specific:** ❌ "add a contact form" → ✅ "add a contact form with name, email, message; submit to Formspree; match the dark-green button style on the hero."
- **Give context:** reference files with **`@filename`**; an **open file is auto-referenced**; **select code** and ask "explain the selected code."
- **Be concise.** No "hey Claude, could you kindly…" — it's an agent, not a coworker. Short + clear = better output.

## 4. Context & cost management (this directly protects your $100 plan)
- Context window = Claude's working memory (~200k tokens). **Fills up → it hallucinates + quality drops + costs more.**
- **`/clear`** when switching to an **unrelated** task (wipes conversation, fresh start).
- **`/compact`** when on **related** tasks but getting full (keeps a summary). Auto-compacts ~70%.
- **`/context`** to see usage; **`/usage`** (subscription) to track your plan; **`/cost`** (API).
- **Keep CLAUDE.md lean** — it's sent with *every* request. Only architecture, structure, patterns, conventions, commands.

## 5. Power tools to adopt
- **MCP servers** = give Claude new abilities. Only add what you need (each one eats context/cost). For JP:
  - **Supabase MCP** → I build/query the database directly (pump-puff-club rebuild).
  - **Playwright MCP** → I **open and test sites in a real browser** = I can visually verify each client site myself.
  - **GitHub MCP** → issues, PRs (already connected on web).
- **Run via prompt:** say `run this app` and Claude auto-installs deps + fixes startup issues (vs you debugging `npm` errors).
- **Sub-agents / background jobs / checkpoints:** break up big tasks, run things in the background, undo when needed.

## 6. The killer one for JP's recurring revenue 💰
**GitHub Actions + Claude:** a client emails a change → you log it as a **GitHub issue** → Claude fixes it → you review + merge → **auto-deploys to production.**
> This means your **Care Plan** maintenance work becomes near-automated. Client requests → mostly hands-off fixes → recurring $$ for minimal time. This is the workflow that makes the $99/mo Care Plan almost pure profit.

## 7. Subscription note
Mosh hit Pro limits fast with heavy use → moved to **Max** and loves it. JP's $100 Claude plan = Max-tier; manage context well (§4) to stretch it.

---

## ✅ JP's adoption checklist (start doing these)
- [ ] Use **Plan Mode** for every new feature/page before letting it build.
- [ ] Start each client site with **small pattern-setting tasks**, review, then scale.
- [ ] **`/clear` between clients**, `/compact` within a build — protect the plan + quality.
- [ ] Keep every project's **CLAUDE.md lean** and update it after structural changes.
- [ ] Tighten prompts: specific + `@file` context + concise.
- [ ] Add **Playwright MCP** (self-verify sites) + **Supabase MCP** (pump-puff-club) on the laptop.
- [ ] Set up **GitHub Actions auto-deploy** so Care Plan edits run issue → fix → merge → live.
- [ ] **Review every diff.** Never VIP-code a client's site.
