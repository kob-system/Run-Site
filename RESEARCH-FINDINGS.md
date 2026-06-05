# Run-Site — Research + Critique Findings (overnight 2026-06-01→02)

> Produced by an 8-agent research+critique workflow: 4 web-research agents (field-service app IA, crew adoption, mobile UX, PWA/a11y) → 3 adversarial critics → 1 synthesizer. The agents critiqued our own planned tab-grouping and found a stronger approach. Full prioritized list below; **the 3 highest-impact changes are at the bottom.**

---

## TIER 1 — DO TONIGHT (SAFE-ADDITIVE, high impact)

**1. Visible sync-status layer** (offline pill + per-item pending/synced/failed badges + one-tap retry). The worker app has the correct offline queue but NO UI for it; an invisible queue "feels like a black hole" and crews revert to texting in dead zones. Reads existing queue state — no change to the sync engine. *(S–M · high · SAFE)*

**2. GPS WIIFM microcopy** at every GPS touchpoint (Time, Mileage, worker Clock-In). GPS is the single most-resisted feature (~61% oppose movement tracking). One line: *"Your location only stamps your start/stop so your hours are never disputed — it's off when you're clocked out,"* plus a GPS on/off dot tied to clock state. Pure copy. *(S · high · SAFE)*

**3. Worker "My Day" home** — big clock-in/out button on top, then a low-density list of today's jobs (address · start time · one-line note). Merges Clock-In + Schedule into one glanceable home base. *(M · high · SAFE)*

**4. Read-only job-detail card for the worker** — full address + one-tap "Get Directions" (Maps deep-link), scope/notes in large text, gate/lockbox codes. Pulls existing owner-side fields; stops the "5 calls a day to the office." *(M · high · SAFE)*

**5. Persistent floating "+" (context-aware quick-create)** — FAB on every screen: Jobs→New Job, in-job→Add Photo/Receipt/Log, Estimates→New Estimate, worker home→Add Photo/Receipt/Note. Routes to existing forms. *(S–M · high · SAFE)*

**6. First-class "Take Photo" button** on worker home + job view — opens camera directly, auto-stamps GPS+time+job. Photo documentation is the #1 fastest-adopting feature (protects the crew from callback disputes). Don't bury it in a bucket. *(S–M · high · SAFE)*

**7. Voice-to-text** (mic button via Web Speech API) on Daily Log, Punch items, job notes — gloved hands can't type; documentation must be in-flow, not homework. *(S · med–high · SAFE)*

**8. Glove-grade touch targets + bottom-nav for the worker app** — bottom tab bar (Home/Time/More), buttons ≥56px with ≥12px gaps, icon+text labels, high-contrast for sunlight. *(M · high · SAFE; worker app is only 3 screens)*

## TIER 2 — THIS WEEK

**9. Re-cut the job buckets by LIFECYCLE, not data-type.** Our planned Daily/Lists/Money/Docs groups by *kind of thing* (the model that loses). Winners group by lifecycle. New cut: **Today's Work** (Time, Photos, Daily Log, Receipts, Mileage) · **Plan & Lists** (Schedule, Shopping, Punch) · **Money** (Budget, Change Orders) · **Docs** (Documents, Permits). *(S — fold into tonight's reorg · SAFE)*

**10. Promote the 3 daily actions ABOVE the buckets.** Bucketing trades wide-but-flat for deep-but-tidy, and depth is what got ServiceTitan dinged. Render **Clock · Photo · Daily Log** as always-visible buttons; buckets organize the long tail below. *(S–M · high · SAFE)*

**11. Role-gate the Money bucket (Budget/profit) away from the crew.** Showing a crew the margin on their own labor is a morale landmine. Never render profit on a worker view; auto-assign cost codes. *(M · med · needs-care — RLS/role boundary, verify)*

**12. Per-job notes thread + one-tap status ("On my way"/"On site"/"Done").** Cuts coordination off personal SMS. *(M–L · med–high · needs-care — new table + RLS)*

**13. Smart defaults / carry-over** so logs are a 10-second confirm, not a blank form (prefill date/job/GPS/last cost code). *(M · med · SAFE)*

**14. Merge true-overlap destinations** — fold Permits into Docs; rename in-job "Schedule" → "Job Timeline" (collides with top Calendar); auto-compose the Daily Log draft from that day's Time+Photos+Receipts. *(M · med · needs-care)*

## TIER 3 — INFRASTRUCTURE

**15. IndexedDB repository + Background Sync** (UI → local DB → background sync; never localStorage for the queue). The integrity backbone under #1. *(L · high · needs-care)*
**16. Performance budget for cheap Android** (code-split routes, lazy-load, Brotli, CI bundle budget; LCP≤2.5s/INP<200ms). *(M–L · med · SAFE)*
**17. Gated PWA install prompt** fired after "job completed," not on load (~6x install rate). iOS needs a Share→Add-to-Home coaching banner. *(S–M · med · SAFE)*

---

## THE 3 SINGLE MOST IMPACTFUL CHANGES
1. **Worker "My Day" home + read-only job card + first-class camera** (#3+#4+#6) — converts the worker app from a surveillance/data tool into something with real WIIFM. Highest leverage; adoption is won crew-first.
2. **Visible sync-status layer** (#1) — the correct offline architecture is wasted without it; load-bearing for trust on bad connectivity.
3. **GPS-WIIFM reframe + hide profit from the crew** (#2+#11) — neutralizes the two biggest *emotional* abandonment triggers that no tab-grouping can fix.

**Net:** tonight's nav reorg is necessary but it reorganizes the *owner* console — a lateral move. The Tier-1 worker/in-job items are where the research says adoption is actually won.
