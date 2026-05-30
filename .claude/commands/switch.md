---
description: Save current focus state and prep a clean context switch to another client/task
---

JP wants to switch work focus to: **$ARGUMENTS**

Do this now:
1. Write a concise handoff of the CURRENT focus to `docs/session-state/<current-focus>.md` containing:
   - What we were working on
   - Decisions made
   - Next steps (numbered)
   - Open questions
   - Key files touched
2. Then tell JP exactly: **"✅ State saved. Run `/clear`, then say: `load $ARGUMENTS`"**
3. Do NOT begin the new work yet — wait for the fresh context after the clear.

If $ARGUMENTS is empty, ask what we're switching to before saving.
