# Run-Site — Bug Hunt / Full-Utilization Test (2026-06-21)
_Driving the live app as a contractor to find what breaks before cold-calling. Owner under test: kobrossisystems+demo@gmail.com_

## Definition of "ready"
Every core feature exercised end to end with: no crashes / blocking errors, money math correct, exports work, multi-user (owner vs worker) isolation holds.

## Findings
| # | Area | Severity | What broke | Status |
|---|------|----------|------------|--------|
| 1 | Job Money / Dashboard | 🔴 High | "Projected Profit" = contract price − **actual** spend, so a fresh job shows the FULL contract as profit at "100% margin" (Deck Build: $12,500 / 100% instead of $2,500 / 20%). Dashboard "Proj. profit" sums these, overstating wildly ($41k = sum of contract prices). Should forecast contract − **projected** costs (budget until actuals exceed it). | ✅ FIXED — new `computeProjectedProfit()` in money.js + profitOf() in OwnerDashboard; 5 new unit tests pass. Pending deploy. |

## Sections tested
- [ ] Dashboard / home
- [ ] Jobs (list + detail + create + edit)
- [ ] Receipts (add, categories, scan)
- [ ] Time / labor
- [ ] Workers (invite, manage, remove)
- [ ] Estimates
- [ ] Invoices
- [ ] Clients
- [ ] Calendar / schedule
- [ ] Payroll
- [ ] Reports + CSV export
- [ ] Worker-side app (separate login)
