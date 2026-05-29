# 🚚 MOVING FROM BASE 44

**Goal:** Get all websites off Base44 ($100/mo), own everything outright, and cut the bill.
**Status:** Planned — starting this week.
**Owner:** JP

---

## Why we're doing this
- Base44 charges **$100/mo** and **locks you in** (it hosts the sites + owns the backend).
- Claude Code (already included in the **$100 Claude Max** plan) can build/maintain the sites instead — **no new tool cost**.
- End state costs **~$45/mo** (Vercel Pro $20 + Supabase Pro $25; GitHub free) → **saves ~$55/mo (~$660/yr)** and everything is owned by JP.

---

## The tools (plain-language map)
| Tool | Role | Analogy |
|---|---|---|
| **GitHub** | Stores the code + full revision history; the hub everything connects to | The plan room / document control |
| **Vercel** | Hosting — runs the live site for visitors | The finished building, open to the public |
| **Supabase** | Database + logins (only for pump-puff-club) | The back-office records + security desk |
| **Claude Code** | Edits, imports, deploys, wires backends | The contractor doing the work |

**The pipeline:**
```
Base44 --(export)--> GitHub --(Claude pulls/edits)--> Vercel (hosting)
                                                  \--> Supabase (DB/logins, app only)
```
The **only manual handoff** is JP clicking "Export to GitHub" in Base44. After that, Claude does the rest.

---

## What we're moving
- **4–6 mostly-static live sites** → easy (no backend).
- **1 draft** → easy, lowest risk.
- **pump-puff-club.base44.app** → the hard one: has customer accounts, purchase history, staff. Needs a real backend rebuilt (Supabase + Stripe). **Move LAST.**

**Domains:** mostly **Namecheap**, one in **Wix**.
**Accounts ready:** GitHub ✅, Vercel ✅, Supabase ✅ (already used for Run-Site).

---

## ⚠️ Golden rules (do not break these)
1. **Never cancel Base44 until a site is fully migrated AND verified live elsewhere.**
2. **For pump-puff-club: export the DATA (customers, purchases, staff) BEFORE anything else.** Once Base44 is gone, that data is gone.
3. **Free to build, paid to go live** — only subscribe Vercel Pro / Supabase Pro when a site actually goes live commercially.

---

## PHASE 1 — Static sites

### Step 0 — Pick the PILOT site
Choose the **simplest, lowest-stakes** static site to move first (proves the recipe before doing the rest).

### The recipe (per site)
| # | Who | Action |
|---|---|---|
| 1 | **JP** | In Base44: open the site → **Export → GitHub**. Note the repo name. |
| 2 | **Claude** | Pull the repo, audit the code, flag any hidden Base44 backend (e.g. contact forms). |
| 3 | **Claude** | Fix anything broken; swap Base44-dependent forms for a free service (Formspree / serverless). |
| 4 | **Claude** | Add Vercel config, push, deploy to a **preview URL**. |
| 5 | **JP + Claude** | Open preview, click through, confirm everything works. |
| 6 | **JP** | Point the domain at Vercel using the exact DNS records Claude provides. |
|   |   | → **Namecheap:** Domain List → Manage → Advanced DNS → add/replace records. |
|   |   | → **Wix site:** Wix holds that domain — either move DNS to Vercel or point via Wix DNS settings. |
| 7 | **Both** | Verify live on the real domain (HTTPS works, pages load). ✅ Off Base44. |

### Scale
Once the pilot works, export sites #2–#6 to GitHub and Claude runs them through the same recipe **in parallel**.

### Go-live billing trigger
When the first live site is pointed at a real domain → **subscribe Vercel Pro ($20/mo)** (Hobby tier bans commercial use). One Pro account covers ALL static sites.

---

## PHASE 2 — pump-puff-club (the app)

| # | Who | Action |
|---|---|---|
| 1 | **JP** | **Export ALL data first** — customers, purchase history, staff (CSV/JSON). SAFETY STEP. |
| 2 | **JP** | In Base44: export the frontend code → GitHub. |
| 3 | **Claude** | Stand up Supabase: database schema + auth (logins) for customers & staff. |
| 4 | **Claude** | Wire payments (Stripe) + rebuild purchase/order logic. |
| 5 | **Claude** | Import JP's exported data into Supabase. |
| 6 | **Both** | Hard-test: logins work, purchase history shows, staff access works, payments process. |
| 7 | **JP** | Point domain (Namecheap/Wix) at Vercel. |
| 8 | **Both** | Final verification with real flows. |

### Go-live billing trigger
Right before pump-puff-club reopens to real customers → **subscribe Supabase Pro ($25/mo)** (free tier pauses after 7 days inactivity — unacceptable for a live store).

---

## PHASE 3 — Close out
1. Confirm every site verified live off Base44.
2. (Optional) Downgrade Base44 to a cheaper tier while only pump-puff-club remains, to save during the rebuild.
3. **Cancel Base44.** 🎉 Bank the savings.

---

## Other subscriptions (decided)
- **GoHighLevel ($100)** — KEEP if actively used for client CRMs (no free replacement; it's the comms/CRM engine). Pause only if idle.
- **ChatGPT (~$10–20)** — KEEP as Claude-overflow backup + image/video generation. Verify the price tier.

---

## ▶️ First home session = the PILOT
**JP brings:** chosen pilot site + Namecheap login.
**Fire order:** Step 1 (export to GitHub) → tell Claude the repo name → Claude runs 2–4 → verify → point domain → live.
