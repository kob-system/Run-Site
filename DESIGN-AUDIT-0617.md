# Run-Site — Front-End Design & UX Audit
_Overnight per-screen audit, 2026-06-17. 55 findings that survived adversarial verification against the current code._

## Summary

| Screen | High | Med | Low | Safe-to-auto-fix |
|---|---|---|---|---|
| Login / Signup / Worker invite | 1 | 0 | 0 | 1 |
| My Day / Clock tab | 1 | 0 | 0 | 1 |
| Clock tab + job cards | 1 | 0 | 0 | 1 |
| Clock tab (active shift) | 1 | 0 | 0 | 1 |
| Jobs list (active jobs) | 1 | 0 | 0 | 1 |
| Job detail > Budget tab | 1 | 1 | 0 | 2 |
| Jobs list (completed) | 1 | 0 | 0 | 1 |
| Project detail → Schedule tab + Schedule Worker modal | 1 | 0 | 0 | 0 |
| Billing (paywall + manage) | 2 | 0 | 0 | 2 |
| Signup (role chooser) | 0 | 1 | 1 | 2 |
| Login + Signup | 0 | 1 | 0 | 1 |
| Signup | 0 | 1 | 0 | 1 |
| Login / Signup | 0 | 2 | 1 | 3 |
| All tabs (top nav) | 0 | 1 | 0 | 1 |
| Clock tab status block | 0 | 1 | 0 | 0 |
| Clock tab job cards (Add Photo) | 0 | 1 | 0 | 0 |
| Top bar (all tabs) | 0 | 1 | 0 | 0 |
| Time Off tab | 0 | 1 | 0 | 1 |
| Jobs list + Budget tab | 0 | 1 | 0 | 1 |
| Job detail > Receipts / Time tabs | 0 | 1 | 0 | 1 |
| Jobs list (initial load) | 0 | 1 | 0 | 1 |
| Job detail Budget + By-Worker + Receipts | 0 | 1 | 0 | 1 |
| Job detail > Budget tab (Other Costs card) | 0 | 1 | 0 | 1 |
| Job detail header (all tabs) | 0 | 1 | 0 | 0 |
| Project detail → Time tab | 0 | 2 | 0 | 2 |
| Workers tab | 0 | 1 | 0 | 0 |
| Reports tab | 0 | 1 | 1 | 0 |
| Workers tab → Time-off requests | 0 | 2 | 0 | 1 |
| Global (App.css, Billing.js, Login.js, dashboards) | 0 | 1 | 0 | 1 |
| Global (all buttons) + Billing | 0 | 1 | 0 | 1 |
| Billing (plan cards) | 0 | 1 | 1 | 2 |
| All | 0 | 0 | 1 | 1 |
| Clock tab (Clock Out) | 0 | 0 | 1 | 0 |
| All tabs | 0 | 0 | 1 | 1 |
| History tab | 0 | 0 | 1 | 1 |
| Job detail > Change Orders tab | 0 | 0 | 1 | 1 |
| Job detail > Contract + Change Orders card | 0 | 0 | 1 | 1 |
| Job detail > Materials (Shopping List) + Punch tabs | 0 | 0 | 1 | 1 |
| Schedule Worker modal vs Add Time modal | 0 | 0 | 1 | 1 |
| Workers tab → Invite a worker | 0 | 0 | 1 | 1 |
| Invite panel vs all modals | 0 | 0 | 1 | 1 |
| Add Time modal | 0 | 0 | 1 | 1 |
| Project detail → Schedule tab | 0 | 0 | 1 | 1 |
| Time, Schedule, Reports empty states | 0 | 0 | 1 | 1 |
| Billing header | 0 | 0 | 1 | 1 |
| Billing (error state) | 0 | 0 | 1 | 1 |

---

## Login / Signup / Worker invite

### [HIGH · S · SAFE] Inputs at 14px trigger iOS auto-zoom on focus (phone-first killer)
- **Where:** `src/App.css:18`
- **Problem:** All form inputs use font-size:14px. On iOS Safari any input under 16px makes the browser auto-zoom the viewport when the field is focused, then leaves it zoomed — the page jumps and the contractor has to pinch back out. For a product whose whole pitch is 'from your phone', the very first interaction (typing email/password) feels broken on iPhone.
- **Fix:** Bump the input font-size to 16px: change `.input-group input, .input-group select, .input-group textarea { ... font-size: 14px; }` to `font-size: 16px;`. This is the standard fix to disable iOS focus-zoom. Affects all forms app-wide but is uniformly an improvement.
- **Verified at:** `src/App.css:18`

## My Day / Clock tab

### [HIGH · S · SAFE] "Clock Out" button is visually smaller and lower-priority than "Clock In"
- **Where:** `WorkerDashboard.js:660-662 (and App.css:15 .btn-danger)`
- **Problem:** The Clock In button is explicitly enlarged (fontSize 18px, padding 18px, minHeight 60px) so it's a fat, glove-friendly target. But Clock Out reuses the default .btn-danger (padding 10px 20px, font 14px, no minHeight). The single most-repeated action of the entire day - ending a shift on a job site, one-handed, often in a rush - is rendered as a smaller, harder-to-hit button than clock-in. Below Apple/Google's 44-48px comfortable target once you account for the 10px padding + 14px text (~38px tall).
- **Fix:** Give Clock Out the same prominence as Clock In: add inline style `{ fontSize: '18px', padding: '18px', minHeight: '60px', marginBottom: '8px' }` to the btn-danger at line 660. Identical hit area for the two halves of the daily loop.
- **Verified at:** `src/pages/WorkerDashboard.js:660-662 (and src/App.css:15 .btn-danger)`

## Clock tab + job cards

### [HIGH · S · SAFE] Critical field microcopy uses low-contrast gray that washes out in direct sunlight
- **Where:** `WorkerDashboard.js:623,628-629,633,638,674-676,691-692`
- **Problem:** Job-site phones are read in bright sun. Key text - the status line (#6B7280), GPS line, 'Tap the big button...' prompt (#6B7280), the job address (#6B7280), and especially the privacy/trust footer (#9CA3AF on white at 11px, line 674) - sits well below WCAG AA. #9CA3AF on #FFFFFF is ~2.5:1; at 11px it's effectively invisible outdoors. The GPS-trust copy is the thing that makes a worker comfortable being tracked, and it's the least legible element on the screen.
- **Fix:** Darken the trust footer to at least #4B5563 and bump to 12px (line 674); raise body/status grays from #6B7280 to #374151 and #9CA3AF to #6B7280 where used as primary microcopy. These are color/size-only CSS changes.
- **Verified at:** `src/pages/WorkerDashboard.js:623,628-629,633,638,674-676,691-692`

## Clock tab (active shift)

### [HIGH · S · SAFE] Timer is large but the 'who/where' context disappears once clocked in
- **Where:** `WorkerDashboard.js:631-633`
- **Problem:** When clocked in, the card shows 'Currently clocked in' + a 48px timer, but NOT the job name you're clocked into. A worker assigned to multiple sites can't glance and confirm they're tracking time against the right job - a real payroll/billing error risk. The job name only appears in the un-clocked state (line 639) and in the separate 'Your jobs' list below.
- **Fix:** Add the active job name under the status line when currentEntry exists, e.g. a 16px bold '📍 {job name}' line, reusing currentEntry.job_name or projects.find(...).name. Glanceable confirmation that the right job is on the clock.
- **Verified at:** `src/pages/WorkerDashboard.js:631-633`

## Jobs list (active jobs)

### [HIGH · S · SAFE] Job list cards hide the one number that matters: profit
- **Where:** `src/pages/OwnerDashboard.js:2244-2259`
- **Problem:** Each active job card shows the job name, client, and two budget bars (Materials, Labor) but never shows the job's projected profit or contract price. A contractor scanning the list cannot tell which jobs are making money without tapping into each one. The most load-bearing number in the whole product (profitOf(p), already computed and used in the header stat at line 2233) is absent from the card itself.
- **Fix:** Add a profit/contract row to each active card. Inside the card, after the name/status header (around line 2249) add a right-aligned money line, e.g. <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:'8px'}}><span style={{fontSize:'12px',color:'#888'}}>Projected profit</span><span style={{fontWeight:'800',fontSize:'18px',color:profitOf(p)>=0?'#16A34A':'#DC2626'}}>{formatCurrency(profitOf(p))}</span></div>. profitOf and contractOf are already in scope.
- **Verified at:** `src/pages/OwnerDashboard.js:2244-2259`

## Job detail > Budget tab

### [HIGH · M · SAFE] Budget detail tab buries Projected Profit as the last of six identical gray cards
- **Where:** `src/pages/OwnerDashboard.js:1525-1572`
- **Problem:** The Budget tab renders Materials, Labor, Other, Profit Target, and Projected Profit as five visually identical white cards with the same 12px gray uppercase label and similar number sizes. There is no visual hierarchy: the single number the owner cares about most (Projected Profit, line 1569-1570) looks the same weight as the Materials spend card and sits at the bottom, below the fold on a phone. Compare with the Mileage and Change-order tabs which DO give their key total a dark hero card (lines 1648, 1747).
- **Fix:** Promote Projected Profit to a hero card at the TOP of the budget tab (above the Materials/Labor cards), matching the dark-card treatment used at line 1648: background '#1C2B3A', white label, and a large 30-34px green/red value. Keep the smaller breakdown cards below. This gives the money screen a clear focal point.
- **Verified at:** `src/pages/OwnerDashboard.js:1525-1572 (Projected Profit card at 1568-1572; dark hero pattern to match at 1648 and 1747)`

### [MEDIUM · S · SAFE] Profit Target vs Projected Profit are unrelated cards with no comparison
- **Where:** `src/pages/OwnerDashboard.js:1564-1572`
- **Problem:** Profit Target and Projected Profit sit in two separate cards with no relationship drawn between them. The owner has to mentally subtract to know 'am I ahead of or behind my target?' — the exact judgment this screen exists to support.
- **Fix:** In the Projected Profit card add a one-line delta vs target, e.g. const delta = projProfit - (selectedProject.profit_target||0); then render <p style={{fontSize:'12px',color:delta>=0?'#16A34A':'#DC2626',marginTop:'4px'}}>{delta>=0?'On track — '+formatCurrency(delta)+' above target':formatCurrency(Math.abs(delta))+' below your target'}</p>. Purely additive copy/markup.
- **Verified at:** `src/pages/OwnerDashboard.js:1564-1572`

## Jobs list (completed)

### [HIGH · S · SAFE] Completed-job cards drop all financial context
- **Where:** `src/pages/OwnerDashboard.js:2268-2278`
- **Problem:** Completed job cards show only name, client, completed date, and a Done pill. The actual profit the owner made on the finished job — the single most satisfying and useful retrospective number, and already computed via profitOf(p) and charted in Insights (line 1453) — is missing. A contractor reviewing past work can't see what each job earned.
- **Fix:** Add final profit to the completed card, right-aligned next to the Done pill, e.g. <span style={{fontWeight:'800',color:profitOf(p)>=0?'#16A34A':'#DC2626'}}>{formatCurrency(profitOf(p))}</span> with a tiny 'profit' caption. Reinforces the product's core value on every glance.
- **Verified at:** `src/pages/OwnerDashboard.js:2268-2278`

## Project detail → Schedule tab + Schedule Worker modal

### [HIGH · S · needs-care] Schedule modal saves blank/invalid entries; list then renders an empty card
- **Where:** `OwnerDashboard.js:1109-1118, 1857-1868, 1811-1817`
- **Problem:** addSchedule only requires worker_id + scheduled_date. Task, start, and end are all optional and unvalidated. A user can save a row with no task and no times. The list card at 1811-1817 only renders start_time when present, so such a row shows just a date + worker name with a blank body — looks broken. There is also no check that end_time is after start_time (unlike addTimeEntry, which does validate). A contractor scheduling a crew member to a 1pm-9am shift gets no warning.
- **Fix:** In addSchedule, after the existing guard add: if start_time and end_time are both set, parse `${scheduled_date}T${start_time}` / `...T${end_time}` and `if (end <= start) return setInlineError('End time must be after start time')`. Mirror the addTimeEntry pattern at 536-539. In the list card (1816) always show a time line: when start_time/end_time are blank render a muted `All day` instead of nothing, so no card is ever empty. Optionally make Task required if you want every entry to carry a description.
- **Verified at:** `OwnerDashboard.js:1110 — after the existing guard `if (!scheduleForm.worker_id || !scheduleForm.scheduled_date) return setInlineError('Worker and date are required')`, add: `if (scheduleForm.start_time && scheduleForm.end_time) { const start = new Date(\`${scheduleForm.scheduled_date}T${scheduleForm.start_time}\`); const end = new Date(\`${scheduleForm.scheduled_date}T${scheduleForm.end_time}\`); if (end <= start) return setInlineError('End time must be after start time') }` (mirrors addTimeEntry at lines 536-539). In the list card at line 1816, always render a time line, showing a muted 'All day' when start_time/end_time are blank so no card is ever empty.`

## Billing (paywall + manage)

### [HIGH · S · SAFE] Billing CTA buttons use navy, not the app's orange primary — the upgrade screen looks off-brand
- **Where:** `src/pages/Billing.js:31-33 (btn), 71,79,80,93`
- **Problem:** Across the entire app the primary CTA color is orange #E07B2A: .btn-primary in App.css:13, the Login 'Create Account' button (Login.js:184), the active nav state (.bottom-nav button.active App.css:8), and 39 orange uses in OwnerDashboard. But Billing.js styles every button navy #1C2B3A (btn at line 32). The result is that the single most revenue-critical screen — the paywall the owner sees before they can pay — does not use the brand's signature CTA color at all. Both plan buttons are identical navy, so there's also no visual lead between Monthly and the Yearly 'best value' plan. A paying contractor coming from the orange-accented login/dashboard lands on a flat navy screen that reads as a different, lower-effort product.
- **Fix:** Change the primary `btn` background to the brand orange #E07B2A (color #fff) so the 'Choose monthly/yearly' CTAs match .btn-primary. Keep navy as the secondary/outline treatment: the 'Manage billing' button at line 93 should become the bordered secondary style (border 2px #E07B2A, transparent bg, color #E07B2A) to mirror .btn-secondary in App.css:14. Optionally make only the recommended Yearly button solid orange and the Monthly button the orange outline, to steer toward the higher-value plan.
- **Verified at:** `src/pages/Billing.js:30-33 (btn style: background '#1C2B3A'), reused at lines 74 and 83; secondary navy at line 93`

### [HIGH · S · SAFE] Billing screen hardcodes generic 'sans-serif' instead of the app system font stack
- **Where:** `src/pages/Billing.js:53`
- **Problem:** The outer container sets fontFamily: 'sans-serif', which resolves to the browser's default sans (often Arial) rather than the -apple-system/Segoe UI/Roboto stack used by body in App.css:2 and index.css:3. On the owner's actual phone the paywall renders in a visibly different, less-refined typeface than every other screen, undermining the premium feel exactly where they're deciding to pay.
- **Fix:** Remove the `fontFamily: 'sans-serif'` override from the wrapper style on line 53 entirely so it inherits the body font stack, or set it to the same -apple-system stack. No other change needed.
- **Verified at:** `src/pages/Billing.js:53`

## Signup (role chooser)

### [MEDIUM · S · SAFE] Role toggle + buttons fall below 44px touch target
- **Where:** `src/pages/Login.js:168`
- **Problem:** The 'Contractor / Owner' and 'Worker' toggle buttons use padding:'10px' with no min-height, rendering ~36-38px tall — under Apple's 44px minimum tap target. This is the first decision a new signup makes on a phone and the buttons are easy to fat-finger. The app already uses 44px elsewhere (.tab, .topbar button), so this is inconsistent.
- **Fix:** Add `minHeight: '44px'` to both role-button style objects (lines 168 and 169). Same one-property add.
- **Verified at:** `src/pages/Login.js:168`

### [LOW · S · SAFE] Role toggle buttons lack aria-pressed (a11y)
- **Where:** `src/pages/Login.js:168`
- **Problem:** The owner/worker selector is built from two <button> elements whose only selected indicator is color. Screen readers get no state — a VoiceOver user can't tell which role is active, and there's no semantic grouping. The visual-only selection also has no focus ring distinct from the active border.
- **Fix:** Add `aria-pressed={role === 'owner'}` and `aria-pressed={role === 'worker'}` to the two buttons, and wrap them in a container with `role="group" aria-label="I am a..."`. Additive attributes only.
- **Verified at:** `src/pages/Login.js line 168`

## Login + Signup

### [MEDIUM · S · SAFE] No password manager / keychain autocomplete hints
- **Where:** `src/pages/Login.js:182`
- **Problem:** The email and password inputs have no autoComplete attributes. iOS Keychain, 1Password, and Chrome won't reliably offer to save or fill credentials, and on signup they won't suggest a strong password. For a paying contractor who lives on their phone, having to re-type a password every login (or not being offered to save it) is friction that reads as amateur.
- **Fix:** Add autoComplete to inputs: email -> `autoComplete="email"`; password -> `autoComplete={isSignup ? 'new-password' : 'current-password'}`; name (line 173) -> `autoComplete="name"`. Also add `inputMode="email"` to the email fields. Purely additive attributes.
- **Verified at:** `src/pages/Login.js:182`

## Signup

### [MEDIUM · M · SAFE] No password visibility toggle or length hint on signup
- **Where:** `src/pages/Login.js:183`
- **Problem:** The password field is type=password with placeholder dots and zero affordance to reveal it or know requirements. On a phone keyboard, mistyped passwords are common and the user can't verify what they typed; if Supabase rejects a too-short password they only find out after submit via a raw API error. This feels generic-CRA, not premium.
- **Fix:** Add a show/hide eye button that toggles the input type between 'password' and 'text', and add a small helper line under the signup password (e.g. 'At least 6 characters') styled like the muted label color #666. Toggle is additive markup/state; helper text is pure copy.
- **Verified at:** `src/pages/Login.js:183`

## Login / Signup

### [MEDIUM · M · SAFE] Submit button shows plain 'Loading...' text, no spinner
- **Where:** `src/pages/Login.js:184`
- **Problem:** During auth the button just swaps its label to 'Loading...' with no spinner and no visual disabled treatment beyond the native disabled attribute (which on .btn-primary doesn't dim it — there's no :disabled style in App.css:13). On a slow contractor connection the button looks the same as enabled, inviting double-taps and reading as low-effort.
- **Fix:** Add a `.btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }` rule in App.css, and replace the 'Loading...' text with a small inline CSS spinner + label (e.g. 'Signing in…'). The disabled style is safe cosmetic; spinner is additive markup.
- **Verified at:** `src/pages/Login.js:184`

### [MEDIUM · M · SAFE] Raw Supabase error messages surfaced verbatim to users
- **Where:** `src/pages/Login.js:54`
- **Problem:** `setError(error.message)` (line 54, also 106 and 138) dumps Supabase's raw strings like 'Invalid login credentials' or 'Password should be at least 6 characters' straight into the alert. These are functional but terse/technical and the profile-error case (line 138) concatenates a DB error message — a contractor seeing a Postgres error string undermines the premium feel.
- **Fix:** Map the common cases to friendly copy: invalid credentials -> 'That email or password doesn't match. Try again or reset your password.'; already-registered -> 'An account with this email already exists — try signing in.'; weak password -> 'Pick a password with at least 6 characters.' Keep a generic fallback. Copy-only change in the catch/if branches.
- **Verified at:** `    if (error) setError(error.message === 'Invalid login credentials' ? "That email or password doesn't match. Try again or reset your password." : 'Something went wrong signing in. Please try again.')`

### [LOW · S · SAFE] No autoFocus on the first field
- **Where:** `src/pages/Login.js:182`
- **Problem:** Neither the email field (login) nor the name/role field (signup) is auto-focused. On desktop the user must click before typing; combined with no keyboard affordance it adds a step to every visit. Minor but the kind of polish that separates premium SaaS from a CRA template.
- **Fix:** Add `autoFocus` to the email input on login and to the first signup field. Keep it conditional so it doesn't fight the role toggle. Additive attribute.
- **Verified at:** `src/pages/Login.js:182`

## All tabs (top nav)

### [MEDIUM · S · SAFE] Four full-word tabs are cramped at quarter-width; "Clock In/Out" wraps/truncates
- **Where:** `WorkerDashboard.js:608-613 (and App.css:36 .tab)`
- **Problem:** .tabs splits 4 buttons evenly with flex:1, padding 12px 8px, font 13px. On a ~360px phone each tab is ~85px wide, but the label "Clock In/Out" needs far more than that - it wraps to two lines or clips, looking broken, while the most important tab is the hardest to read. The scrollable `.tabs-scroll` variant already exists in App.css:39-41 but is not used here.
- **Fix:** Shorten the label to "Clock" (the icon/context makes "In/Out" redundant) at line 609, OR switch the container to `className="tabs tabs-scroll"` at line 608 so tabs keep their natural width and scroll. Shortening labels (Clock / Schedule / History / Time Off) is the higher-glanceability fix.
- **Verified at:** `src/pages/WorkerDashboard.js:608-613 (and src/App.css:36 .tab, .tabs-scroll at 39-41)`

## Clock tab status block

### [MEDIUM · S · needs-care] GPS status reads "GPS on" even when the shift was saved offline with no GPS captured
- **Where:** `WorkerDashboard.js:628-629 (with clockIn 392-400)`
- **Problem:** The line shows '📍 GPS on - stamping your start/stop' whenever currentEntry exists. But geolocation can silently fail (the try/catch at 395-400 swallows errors, leaving gps_lat/lng null), or the worker may have clocked in offline before a fix. The app then tells the worker GPS is on/stamped when no location was actually recorded - a direct trust/accuracy problem for a feature whose whole pitch (line 675) is 'your hours can never be disputed.'
- **Fix:** Drive the label off the actual data: if `currentEntry.gps_lat == null` show '📍 No location recorded' in amber (#E07B2A) instead of green 'GPS on'. Honest stamping status builds the trust the footer promises.
- **Verified at:** `{currentEntry ? (currentEntry.gps_lat == null ? '📍 No location recorded' : '📍 GPS on — stamping your start/stop') : '📍 GPS off'}  // with color: currentEntry ? (currentEntry.gps_lat == null ? '#E07B2A' : '#16A34A') : '#9CA3AF' at line 628`

## Clock tab job cards (Add Photo)

### [MEDIUM · M · needs-care] Photo upload gives no visible confirmation on the card - only a transient toast
- **Where:** `WorkerDashboard.js:699-702,314`
- **Problem:** After a worker sends a jobsite photo the only feedback is a 3s green toast ('Photo sent to your boss'). The card itself shows no thumbnail, count, or checkmark. A worker glancing back 10 seconds later (or after the toast auto-dismisses) has no way to know the photo went through, leading to anxious re-sends or 'did it work?' calls to the boss. No sense of how many photos were sent today.
- **Fix:** After a successful insert (line 313), set a per-project sent-count in state and render a small persistent '✓ N sent today' label next to the Add Photo button. Even a static checkmark that persists for the session is a large trust gain. Mark not-safe because it needs new state.
- **Verified at:** `WorkerDashboard.js:314 (toast), 699-702 (Add Photo button/card), 141 (3000ms auto-dismiss)`

## Top bar (all tabs)

### [MEDIUM · S · needs-care] Sign Out sits immediately beside the sync-status pill and is easy to fat-finger
- **Where:** `WorkerDashboard.js:593-605 (App.css:5)`
- **Problem:** The Sign Out button (40px tall, transparent, top-right) is adjacent to the sync pill in a tight 8px-gap flex row. On a glove-on, one-handed thumb reach the top-right corner is a common accidental-tap zone, and signing out while a shift is mid-tracking is disruptive. The confirm guard only fires when an unsynced offlineEntry exists (line 134) - a worker actively clocked-in-and-synced gets signed out with no warning.
- **Fix:** Either move Sign Out behind a small menu/icon, or extend the confirm guard at line 134 to also warn when `activeEntry` exists ('You're still clocked in. Sign out anyway?'). Copy/logic-light; the guard extension is the quick win.
- **Verified at:** `src/pages/WorkerDashboard.js:133-136 (guard), 591-605 (topbar row); App.css:5`

## Time Off tab

### [MEDIUM · S · SAFE] Date inputs for time-off are small native controls with no min-height for gloved taps
- **Where:** `WorkerDashboard.js:736,740 (App.css:18)`
- **Problem:** The first/last day-off `<input type="date">` controls inherit .input-group input (padding 10px 12px, font 14px) giving ~40px height - below the 44-48px comfortable touch target, and native date pickers have tiny tap zones. Same applies to the datetime-local edit modal inputs (lines 826,830). Filling these one-handed with gloves on is fiddly.
- **Fix:** Bump input min-height to 48px and font-size to 16px for these inputs (16px also prevents iOS auto-zoom on focus). Add a worker-app-scoped CSS rule or inline style. Pure CSS, safe.
- **Verified at:** `src/pages/WorkerDashboard.js:736,740,826,830 (App.css:18)`

## Jobs list + Budget tab

### [MEDIUM · S · SAFE] Budget bars never show overage amount when a job goes over
- **Where:** `src/pages/OwnerDashboard.js:1384, 2255-2258`
- **Problem:** getBudgetPct caps the bar at 100% (Math.min(...,100)). When a job is 130% over on materials, the bar reads full and the label shows e.g. '$1,300 / $1,000' — but nothing quantifies the overage in plain terms. The 'Over budget' pill (line 2252) is binary; an owner can't see HOW far over at a glance.
- **Fix:** When spent > budget, append the dollar overage next to the bar label, e.g. show {formatCurrency(s.materials - p.materials_budget)} over in red. Keep the capped bar (correct visually) but surface the real overage number, since dollars-over is the actionable figure.
- **Verified at:** `src/pages/OwnerDashboard.js:1384, 2250-2258`

## Job detail > Receipts / Time tabs

### [MEDIUM · S · SAFE] Empty states for receipts/time are bare one-liners with no call-to-action
- **Where:** `src/pages/OwnerDashboard.js:1601, 1640`
- **Problem:** Receipts empty state is just 'No receipts yet' and Time is 'No time entries yet' — flat, unhelpful, and inconsistent with the much warmer, action-oriented empty copy already written for Punch ('Nothing left on the punch list...'), Materials ('Build your shopping list...'), and Change Orders (line 1721, 1739, 1765). The two most-used money tabs have the weakest empty states.
- **Fix:** Upgrade to guiding copy that points at the existing '+ Add' button, e.g. receipts: 'No receipts yet. Snap a photo of a receipt and we'll scan the amount, store, and tax for you.' time: 'No hours logged yet. Add time manually, or your crew's clock-ins land here automatically.' Pure copy change.
- **Verified at:** `src/pages/OwnerDashboard.js:1601, 1640`

## Jobs list (initial load)

### [MEDIUM · M · SAFE] Loading the job list shows the literal word 'Loading…' instead of skeletons
- **Where:** `src/pages/OwnerDashboard.js:2283`
- **Problem:** During initialLoading the only feedback is a centered 'Loading…' text in an empty-state block. For a premium field-service tool this reads cheap and causes a jarring layout pop when real cards replace the centered text. Same pattern repeats for Workers (line 2378).
- **Fix:** Render 2-3 skeleton card placeholders instead: gray rounded blocks (background:'#eef1f5', height matching a card, borderRadius:'12px', a subtle pulse via existing CSS or inline opacity animation). Keeps layout stable and feels modern. Additive markup only.
- **Verified at:** `src/pages/OwnerDashboard.js:2283 (jobs) and src/pages/OwnerDashboard.js:2378 (workers)`

## Job detail Budget + By-Worker + Receipts

### [MEDIUM · S · SAFE] Spending numbers are red everywhere, including healthy in-budget jobs
- **Where:** `src/pages/OwnerDashboard.js:1551, 1597, 1626`
- **Problem:** Cost figures (worker labor cost 1551, receipt amount 1597) are hard-coded red (#DC2626). Red universally signals danger/overage, but a $300 receipt on a job that's well under budget is not a problem. Constant red desensitizes the owner so real over-budget red (the alert banners at 1473-1474) loses its punch.
- **Fix:** Make routine spend neutral dark (#1C2B3A or #4B5563) and reserve red strictly for over-budget / negative-profit states. The labor cost in the time entry card (line 1626) already correctly uses neutral #1C2B3A — match that everywhere for non-alarm spend.
- **Verified at:** `src/pages/OwnerDashboard.js:1551 — `<p style={{ fontWeight: '700', color: '#1C2B3A', fontSize: '14px' }}>{formatCurrency(w.cost)}</p>` (use neutral #1C2B3A for routine spend, matching line 1626; apply the same to the receipt amount on line 1597)`

## Job detail > Budget tab (Other Costs card)

### [MEDIUM · M · SAFE] Materials breakdown stops at totals — receipts within a category aren't reachable from Budget
- **Where:** `src/pages/OwnerDashboard.js:1557-1563`
- **Problem:** The 'Other Costs' card lumps gas/permits/tools/subs into one red number with a parenthetical list, but offers no way to see what's inside. By-Worker labor (1534-1555) gets a nice breakdown; non-materials spend gets none. An owner who sees an unexpected $900 in Other has to leave to the Receipts tab and mentally filter.
- **Fix:** Add a small per-category breakdown under Other Costs (group receipts by category like the By-Worker block does), or make the card tappable to jump to the Receipts tab pre-context. Minimum viable: render the category subtotals (materials excluded) as label/amount rows reusing the existing RECEIPT_CATEGORIES/CATEGORY_LABELS maps already imported.
- **Verified at:** `src/pages/OwnerDashboard.js:1557-1563`

## Job detail header (all tabs)

### [MEDIUM · M · needs-care] Job detail tab system stacks three rows of buttons, eating ~40% of first screen
- **Where:** `src/pages/OwnerDashboard.js:1478-1497`
- **Problem:** Above any content there are three stacked control rows: 3 quick-action buttons (48px), a bucket tab row, and a sub-tab row — plus the topbar and up to two alert banners. On a phone the actual tab content (e.g. the Budget numbers) starts very low, and the 4 buckets + duplicated quick tabs (time/photos/log appear both as quick buttons AND inside 'Today's Work') create redundancy and visual noise.
- **Fix:** Tighten vertical rhythm: reduce quick-button minHeight to 44px and the gap/margins (lines 1480,1482); since time/photos/log are already promoted as quick buttons, drop them from the 'Today's Work' bucket tab list (line 28) to remove the duplication and shorten the sub-tab row. Verify bucket-active logic still resolves (activeBucket fallback at 1476 handles it).
- **Verified at:** `src/pages/OwnerDashboard.js:1477-1497`

## Project detail → Time tab

### [MEDIUM · S · SAFE] Time-entries list omits the actual hours worked window and end time
- **Where:** `OwnerDashboard.js:1608-1627`
- **Problem:** Each time card shows the date and a duration (`formatTime`) but never the start/end clock times. A contractor reviewing a worker's day cannot tell WHEN the 6 hours were — 7am-1pm vs 11am-5pm matters for disputes and overlapping jobs. The clocked_in_at/clocked_out_at data is already on the row.
- **Fix:** Under the date line (1613), add a time-of-day line: `<p style={{fontSize:'12px',color:'#717171'}}>{new Date(t.clocked_in_at).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}{t.clocked_out_at ? ` – ${new Date(t.clocked_out_at).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}` : ''}</p>`.
- **Verified at:** `src/pages/OwnerDashboard.js:1613-1614`

### [MEDIUM · M · SAFE] Time tab has no running total of hours/labor for the job
- **Where:** `OwnerDashboard.js:1605-1641`
- **Problem:** The Time tab lists every entry but never sums them. To know total labor hours/cost on the job the owner has to mentally add cards or jump to the Budget tab's By-Worker block. A header total is standard in time-tracking UIs and the data is already loaded.
- **Fix:** Add a summary card directly under the +Add Time button: total minutes = sum of t.total_minutes, total cost = sum of t.labor_cost over clocked-out entries. Render `formatTime(totalMins) · formatCurrency(totalCost)` in a dark card matching the Mileage tab's deduction card at 1647-1655 for visual consistency.
- **Verified at:** `OwnerDashboard.js:1605-1641`

## Workers tab

### [MEDIUM · L · needs-care] Worker card never shows which jobs they're assigned to; 'Assign' gives no persistent feedback
- **Where:** `OwnerDashboard.js:2344-2375, 1130-1144`
- **Problem:** The Assign button writes a project_workers row, but the worker card shows only name/email/rate/hours — never the jobs the worker is currently on. After assigning, the only confirmation is a transient toast; reopen the tab and there's no way to see or undo assignments. An owner managing a 4-person crew can't answer 'who is on the Dutch Village job?' from this screen.
- **Fix:** Fetch project_workers for the crew (join projects(name)) and render an assignments line on each worker card, e.g. `On: Dutch Village, Maple St` as small pills, with the Assign action also able to unassign. At minimum add a muted line listing current job names so the assignment is visible and verifiable.
- **Verified at:** `src/pages/OwnerDashboard.js:2344-2375 (worker card render), 1130-1144 (assignWorkerToProject)`

## Reports tab

### [MEDIUM · M · needs-care] Tax Pack and Job profit report buttons disappear when there are no completed jobs, but QuickBooks exports stay — inconsistent gating
- **Where:** `OwnerDashboard.js:2531-2537`
- **Problem:** exportQboInvoices/exportQboCustomers buttons are always shown (outside the reportJobs guard) while the Tax Pack and Profit CSV buttons are inside the `reportJobs.length > 0` block. So the QB buttons appear for users with no data and then toast an error when clicked. The grouping is confusing — three export buttons split across two visibility rules with no explanation of the difference between 'Tax Pack', 'Job profit report', and the QB CSVs.
- **Fix:** Group all four exports under one labeled section with a one-line description of each ('Tax Pack = everything your accountant needs', 'QuickBooks = import into QBO'). Gate the QB invoice button on invoices.length so it isn't a dead button. Add a sectionLabel header above the export buttons for scannability.
- **Verified at:** `src/pages/OwnerDashboard.js:2528-2537`

### [LOW · M · needs-care] Reports tab shows the QuickBooks export card and year picker even with zero data
- **Where:** `OwnerDashboard.js:2520-2533, 2575-2577`
- **Problem:** When there are no completed jobs the page still renders the Year selector and the full 'Send to QuickBooks' card with two CSV buttons, then a tiny 'No completed jobs in {year}' empty state below. A brand-new contractor's first view of Reports is a wall of QuickBooks export controls that produce empty/no files (exportQboInvoices toasts 'No invoices to export'). This buries the one helpful message.
- **Fix:** When reportJobs.length === 0 AND there are no invoices, lead with a single friendly empty state ('Finish a job to see profit reports and tax exports here') and hide or de-emphasize the QuickBooks card. Keep the QuickBooks card visible only once invoices exist. At least move the empty-state copy above the QB card so it's the first thing seen.
- **Verified at:** `src/pages/OwnerDashboard.js:2520-2533 (QB card + year picker, unconditional), 2575-2577 (empty state below)`

## Workers tab → Time-off requests

### [MEDIUM · S · SAFE] Time-off approve/deny buttons use raw inline styles, missing min tap-height used elsewhere
- **Where:** `OwnerDashboard.js:2336-2337`
- **Problem:** The Approve/Deny buttons use `padding:'6px 14px'` with no minHeight, while comparable action buttons in this file (Mark Paid 2412, delete entry 1633) enforce minHeight 40px for reliable thumb taps on mobile. On a phone these two decision buttons are smaller than the 44px touch-target guideline — easy to mis-tap Approve vs Deny on a payroll-affecting action.
- **Fix:** Add `minHeight:'40px'` (and bump padding to `8px 16px`) to both buttons at 2336-2337 to match the app's other primary actions. Consider extra horizontal gap between Approve and Deny to reduce mis-taps.
- **Verified at:** `OwnerDashboard.js:2336-2337`

### [MEDIUM · M · needs-care] Decided time-off requests vanish with no history; only pending shown
- **Where:** `OwnerDashboard.js:2325-2343`
- **Problem:** The time-off block filters to `status === 'pending'` only, so the moment an owner approves/denies a request it disappears entirely. There's no record that Mike's Jun 18-20 was approved — the owner can't later confirm what they decided, and the worker's approved days aren't visible when scheduling. decideTimeOff already keeps the row in state with its new status, but nothing renders it.
- **Fix:** Below the pending list, add a collapsed 'Recent decisions' list of approved/denied requests (worker name, date range, a green Approved / muted Denied pill). Data is already in `timeOff`. Keeps the decision auditable and informs scheduling.
- **Verified at:** `OwnerDashboard.js:2325-2343`

## Global (App.css, Billing.js, Login.js, dashboards)

### [MEDIUM · M · SAFE] No shared design tokens — color palette, radii, and spacing are re-typed as magic numbers everywhere
- **Where:** `src/index.css:1-13 (no :root); src/App.css:1; src/pages/Billing.js:26-33`
- **Problem:** There is no design-token layer. The same hex values are hand-typed across files: navy #1C2B3A appears 86 times across 5 files, orange #E07B2A 86+ times, the muted-text gray exists as at least four near-duplicates (#667085 in Billing, #6B7280 in App.css:34, #4B5563 App.css:12, #666 in Login.js:186, #888 App.css:44). Border radius ranges ad-hoc from 6/7/8/10/12/14/16/20px and the orange has a hover/active state nowhere defined. This makes consistency drift inevitable (it already produced the navy-vs-orange Billing mismatch above) and any rebrand a multi-file find-replace.
- **Fix:** Add a :root token block in index.css and consume it everywhere: --navy:#1C2B3A; --navy-700 for hovers; --orange:#E07B2A; --orange-600 (e.g. #C96A1E) for :active/:hover; --text:#1C2B3A; --text-muted:#667085 (pick one gray and retire #6B7280/#4B5563/#666/#888); --bg:#f4f6f9; --surface:#fff; --border:#e3e8ef; --radius-sm:8px; --radius-md:12px; --radius-lg:16px; --space-1..4 on a 4px scale. Convert App.css class rules and the Billing inline `card`/`btn` objects to reference these. Start with color + radius tokens (mechanical, low risk); spacing can follow.
- **Verified at:** `src/index.css:1-13 (no :root block — confirmed); src/App.css:1-50 (magic values throughout); src/pages/Billing.js:26-33 (inline card/btn objects). Note: navy #1C2B3A actually appears 49 times across 5 files and orange #E07B2A 39 times across 4 files, not the ~86 claimed.`

## Global (all buttons) + Billing

### [MEDIUM · S · SAFE] Buttons have no hover, active, focus-visible, or disabled styling — feels unresponsive and fails keyboard a11y
- **Where:** `src/App.css:13-15; src/pages/Billing.js:74,83,90`
- **Problem:** .btn-primary/.btn-secondary/.btn-danger (App.css:13-15) and the inline Billing buttons define only a resting state. There is no :hover, no :active, no :focus-visible ring, and disabled buttons in Billing (disabled={!!busy}) get no visual change beyond the browser default — so when an owner taps 'Choose yearly' and it shows 'Starting…' the button looks unchanged and tappable, inviting double-clicks on a checkout flow. On desktop the CTAs feel dead because nothing reacts to the cursor.
- **Fix:** Add to App.css: `.btn-primary:hover{background:var(--orange-600)} .btn-primary:active{transform:translateY(1px)} button:focus-visible{outline:2px solid var(--orange);outline-offset:2px} .btn-primary:disabled,button[disabled]{opacity:.6;cursor:not-allowed}`. In Billing, give the busy/disabled button reduced opacity and cursor:not-allowed via the existing `btn` object (e.g. spread `...(busy?{opacity:.6,cursor:'not-allowed'}:{})`).
- **Verified at:** `src/App.css:13-15; src/pages/Billing.js:74,83,90 (lines correct; note the fix's var(--orange)/var(--orange-600) tokens are undefined in this repo — App.css uses hex #E07B2A, so use the hex value instead)`

## Billing (plan cards)

### [MEDIUM · S · SAFE] Yearly plan's '2 months free / Save $400' value prop is under-emphasized; no 'recommended' badge
- **Where:** `src/pages/Billing.js:79-86`
- **Problem:** The Yearly card is the better-margin plan for the business (annual cash up front) but is differentiated only by a 2px navy border and tiny green '· 2 months free' text at 13px (line 80). There's no clear 'Best value' / 'Recommended' badge, no anchoring of the $400 saving against the $2,400 monthly-equivalent, and both buttons read identically, so the screen doesn't actually steer the buyer toward yearly.
- **Fix:** Add a small pill badge to the Yearly card header (e.g. absolutely-positioned 'BEST VALUE' pill reusing .status-pill styling in brand orange) and make its CTA the solid-orange primary while Monthly uses the orange-outline secondary. Optionally show a struck-through '$2,400' next to '$2,000/yr' to anchor the saving. Cosmetic/markup only.
- **Verified at:** `src/pages/Billing.js:79-86`

### [LOW · S · SAFE] Plan price uses tabular emphasis but spacing/baseline of the /mo suffix is cramped
- **Where:** `src/pages/Billing.js:72,81`
- **Problem:** The price '$200/mo' sets the suffix inline at fontSize 15 directly against the 28px number with no left margin, so '$200/mo' reads as one run. Minor but it cheapens the headline price, which is the focal element of a pricing card.
- **Fix:** Add marginLeft:2-4px and verticalAlign:'baseline' to the suffix <span> on lines 72 and 81, e.g. style={{ fontSize:15, fontWeight:500, color:'var(--text-muted)', marginLeft:3 }}. Pure cosmetic.
- **Verified at:** `src/pages/Billing.js:72 ($200/mo) and src/pages/Billing.js:81 ($2,000/yr) — suffix spans use color:'#667085' (hardcoded), not var(--text-muted)`

## All

### [LOW · S · SAFE] Card has no shadow/elevation — looks flat vs. the rest of the app
- **Where:** `src/pages/Login.js:152`
- **Problem:** The white auth card uses borderRadius:16 but no box-shadow, sitting flat on the navy background. Every other surface in the app (.card, .stat-card) carries `box-shadow: 0 1px 3px rgba(0,0,0,0.08)`. On the login screen — the literal first impression — the card reads as a plain CRA box rather than a lifted, premium panel.
- **Fix:** Add `boxShadow: '0 10px 30px rgba(0,0,0,0.25)'` to the card style object on line 152 for a clear lift against the dark backdrop. Pure cosmetic.
- **Verified at:** `src/pages/Login.js:152`

## Clock tab (Clock Out)

### [LOW · M · needs-care] Clock-out confirmation uses a native window.confirm, breaking the app's polished modal pattern
- **Where:** `WorkerDashboard.js:438 (and 134)`
- **Problem:** Ending a shift triggers `window.confirm('End your shift now?')`. Native confirm dialogs are tiny, vary by browser, have small default buttons (poor for gloves), can't be styled for sunlight contrast, and look cheap next to the otherwise custom .modal-sheet UI used elsewhere (line 821). For the single most consequential daily tap, a styled bottom-sheet with a big 'End shift' button would be both clearer and far easier to hit accurately.
- **Fix:** Replace the window.confirm at line 438 with the existing .modal-sheet bottom-sheet pattern showing elapsed time and a large confirm button. Higher effort but matches house style; alternatively at minimum keep confirm but this is the place to invest.
- **Verified at:** `src/pages/WorkerDashboard.js:438 (and 134)`

## All tabs

### [LOW · S · SAFE] Duplicate/competing sync indicators add noise instead of one clear status
- **Where:** `WorkerDashboard.js:594-603 vs 618`
- **Problem:** There are two sync UIs: the always-on pill in the topbar ('⏳ Saving…' / '✓ All saved') at 598-602, and a separate centered '⏳ Syncing (attempt N)...' banner at line 618. While syncing, both show at once saying the same thing in two places/styles, which reads as jittery rather than reassuring. The pill is the better, persistent pattern.
- **Fix:** Drop the standalone syncing banner at line 618 (the pill already conveys 'Saving…'), or fold the retry-attempt detail into the pill. Removing the redundant banner is a safe, additive-by-subtraction change.
- **Verified at:** `src/pages/WorkerDashboard.js:594-603 (topbar pill) vs 618 (standalone syncing banner)`

## History tab

### [LOW · S · SAFE] 'This week' history hero hides pay behind a placeholder and never shows a per-entry pay breakdown
- **Where:** `WorkerDashboard.js:778-782,803-808`
- **Problem:** The week hero shows total hours and approx pay, but individual history cards (803-808) show only duration, never the dollar value of that shift. Workers care most about money; showing hours-only per entry misses the highest-value glance. Also the big '—' placeholders (lines 780-781) before historyLoaded look like an error/empty state rather than 'loading'.
- **Fix:** Add a small '≈ $X' under each completed entry's duration at line 805 when profile.hourly_rate exists (reuse labor_cost). Replace the '—' placeholders with a subtle 'Loading…' or skeleton. Additive display of existing data.
- **Verified at:** `WorkerDashboard.js:778-782 (week hero with '—' placeholders), 803-808 (per-entry cards showing duration only)`

## Job detail > Change Orders tab

### [LOW · S · SAFE] Change-order status pill uses semantically wrong colors
- **Where:** `src/pages/OwnerDashboard.js:1758`
- **Problem:** The status pill maps 'declined' to status-start and 'pending' to status-mid by reusing the JOB lifecycle pill classes. A declined change order (money you will NOT collect) and a pending one render in lifecycle colors that don't carry the right meaning — declined should read muted/neutral, not the same as a brand-new job stage.
- **Fix:** Introduce explicit semantic styles for change-order status rather than borrowing job-stage classes: approved=green, pending=amber, declined=gray/strikethrough. Add small dedicated classes in App.css or inline style by status. Improves scannability of which extras actually count toward the contract.
- **Verified at:** `src/pages/OwnerDashboard.js:1758`

## Job detail > Contract + Change Orders card

### [LOW · S · SAFE] Money numbers use float-based two-column layout that can overlap on long values
- **Where:** `src/pages/OwnerDashboard.js:1520-1522`
- **Problem:** The contract breakdown rows use CSS float:right on the amount inside a <p> for the label. With long client/large dollar values or accessibility text scaling, float layout can wrap or overlap, and floats inside flex-free <p> are fragile. Adjacent cards in the same file already use clean flex space-between (e.g. 1546, 2255).
- **Fix:** Convert the three rows to flex space-between like the By-Worker rows: wrap each label+amount in <div style={{display:'flex',justifyContent:'space-between'}}> instead of float:right spans. More robust and consistent with the rest of the file.
- **Verified at:** `                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#4B5563' }}><span>Base contract</span><span style={{ fontWeight: '600' }}>{formatCurrency(selectedProject.budget)}</span></div>`

## Job detail > Materials (Shopping List) + Punch tabs

### [LOW · S · SAFE] Shopping-list / punch items give no progress feedback (e.g. '3 of 8 bought')
- **Where:** `src/pages/OwnerDashboard.js:1725-1740, 1708-1722`
- **Problem:** Both checklists render a flat list with checkboxes but no count of remaining/done items. On a long shopping list a contractor at the supply yard can't see at a glance how much is left, and there's no separation of bought vs still-needed.
- **Fix:** Add a small header summary above the list, e.g. const bought = materialItems.filter(i=>i.bought).length; render <p style={{fontSize:'12px',color:'#888'}}>{bought} of {materialItems.length} bought</p> (and equivalently 'N left' for punch). Optionally sort unchecked first so remaining items float to top. Additive.
- **Verified at:** `src/pages/OwnerDashboard.js:1708-1722 (punch), 1725-1740 (materials)`

## Schedule Worker modal vs Add Time modal

### [LOW · S · SAFE] Schedule modal has no live duration/cost preview while Add Time does
- **Where:** `OwnerDashboard.js:1857-1868 vs 1897-1906`
- **Problem:** The Add Time modal shows a helpful live preview (`formatTime(mins) · formatCurrency(cost)`) as the owner picks times. The Schedule modal, which has the identical Start/End time inputs, shows nothing — so the owner can't see at a glance that they scheduled a 6-hour day. Inconsistent polish between two near-identical sheets.
- **Fix:** Add the same IIFE preview block used at 1897-1906 below the End Time input in the schedule modal: compute minutes from start/end and render `<p style={{fontSize:'12px',color:'#888',marginBottom:'8px'}}>{formatTime(mins)} scheduled</p>`. No cost needed (scheduling isn't billed), just the duration.
- **Verified at:** `src/pages/OwnerDashboard.js:1865 (End Time input in Schedule modal; preview should be inserted after this line, mirroring the IIFE at lines 1897-1906)`

## Workers tab → Invite a worker

### [LOW · S · SAFE] Invite name input lacks autofocus and Enter-to-submit
- **Where:** `OwnerDashboard.js:2299-2307`
- **Problem:** Opening the invite panel doesn't focus the name field, and pressing Enter in the single text input does nothing (no form/onKeyDown), so the owner must reach for the mouse to click 'Create invite link'. On a phone this is extra friction for the most common worker-onboarding action.
- **Fix:** Add `autoFocus` to the invite-name input (2301) and an `onKeyDown={e => { if (e.key === 'Enter') createInvite() }}`. Both are additive and match expected single-field form behavior.
- **Verified at:** `OwnerDashboard.js:2301 — <input id="invite-name" type="text" autoFocus value={inviteName} onChange={e => setInviteName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') createInvite() }} placeholder="Mike Reyes" />`

## Invite panel vs all modals

### [LOW · M · SAFE] Inconsistent error styling between invite panel and every other form
- **Where:** `OwnerDashboard.js:2303 vs 1866, 1908, 2604`
- **Problem:** The invite panel renders errors via `<div className="alert-danger">` while every other form in this file renders inline errors as `<p style={{color:'#DC2626',fontSize:'13px'...}}>`. Two visual treatments for the same shared `inlineError` state means the error looks different depending on where it surfaces — a subtle inconsistency a detail-oriented user notices.
- **Fix:** Pick one. Either switch the invite panel to the inline-`<p>` style used elsewhere, or (better) standardize all forms on the `alert-danger` class. Given inlineError is reused everywhere, extract a small `<FormError msg={inlineError} />` component and use it in all modals.
- **Verified at:** `OwnerDashboard.js:2303 (invite panel uses div.alert-danger) vs 1866, 1908, 2604 (and ~12 others) using inline <p> style`

## Add Time modal

### [LOW · S · SAFE] Add Time worker dropdown shows rate but warns about missing rate only after selection; no rate-missing flag in the option
- **Where:** `OwnerDashboard.js:1893, 1905`
- **Problem:** The worker option text appends `— $X/hr` only when hourly_rate is set (1893), so a rate-less worker shows as a bare name with no hint that picking them yields $0 labor cost. The warning only appears after selecting them and entering times (1905). For an owner with several crew, it's not obvious which workers still need a rate before their time will cost anything.
- **Fix:** In the option label (1893), when hourly_rate is missing append a visible marker like ` — no rate set` instead of nothing, so the dropdown itself flags which workers won't accrue labor cost.
- **Verified at:** `OwnerDashboard.js:1893 (option label), 1905 (post-selection warning)`

## Project detail → Schedule tab

### [LOW · S · SAFE] Schedule date label can be misread; no 'Today'/'Tomorrow' relative cue
- **Where:** `OwnerDashboard.js:1813`
- **Problem:** Schedule cards show the full weekday/month/day ('Monday, Jun 23') with no relative anchor. For a field tool whose top job is 'what's happening today/tomorrow', the owner has to compute whether a date is imminent. Minor but high-frequency friction.
- **Fix:** Compute a relative prefix: if scheduled_date === today show 'Today · ', if tomorrow show 'Tomorrow · ', else nothing, prepended to the existing formatted date in the schedule-day line. Purely presentational.
- **Verified at:** `OwnerDashboard.js:1813`

## Time, Schedule, Reports empty states

### [LOW · S · SAFE] Empty states are terse and offer no next action across audited tabs
- **Where:** `OwnerDashboard.js:1640, 1819, 2576`
- **Problem:** 'No time entries yet', 'No schedule yet', 'No completed jobs in 2026' are dead ends with no guidance, unlike the richer empty states elsewhere in the same file (e.g. estimates 2453, invoices 2513 which explain the value + next step). Inconsistent and less helpful for a first-time contractor.
- **Fix:** Match the fuller pattern: e.g. 'No time logged yet. Tap + Add Time, or workers can clock in from their app.' for 1640; 'Nothing scheduled. Tap + Schedule Worker to put a crew member on this job for a day.' for 1819. Copy-only change.
- **Verified at:** `OwnerDashboard.js:1640, 1819, 2576`

## Billing header

### [LOW · S · SAFE] Billing wordmark 'RUN-SITE' is a plain dark h2 — inconsistent with the orange wordmark used at login
- **Where:** `src/pages/Billing.js:54 vs src/pages/Login.js:149`
- **Problem:** Login renders the wordmark as orange #E07B2A, 32px, weight 800 (Login.js:149) establishing the brand lockup. Billing renders 'RUN-SITE' as a default-size navy h2 (line 54), so the brand mark looks different on the two screens an unpaid owner sees most. There's also no logo/visual anchor on the paywall.
- **Fix:** Style the Billing h2 to match the wordmark treatment: color var(--orange), fontWeight 800, letterSpacing ~0.5px, and bump size for presence. Keeps the brand lockup consistent between Login and the paywall.
- **Verified at:** `src/pages/Billing.js:54 vs src/pages/Login.js:149`

## Billing (error state)

### [LOW · S · SAFE] Error banner and card colors in Billing are one-off hexes not shared with the app's alert system
- **Where:** `src/pages/Billing.js:64; src/App.css:42-43`
- **Problem:** App.css already defines .alert-danger (#FEE2E2 bg / #DC2626 border / #991B1B text, App.css:43), and Login reuses it (Login.js:154). Billing instead hand-rolls a different red banner (#fde8e8 bg, #9b1c1c text, line 64) and a card border #e3e8ef that doesn't match the app's other border grays. Two different 'danger red' treatments appear depending on screen.
- **Fix:** Replace the inline error <div> on line 64 with className="alert-danger" (drop the inline style) so billing errors match login/dashboard error styling, and route the card border through the shared --border token.
- **Verified at:** `src/pages/Billing.js:64 (error banner) and src/pages/Billing.js:27 (card border '#e3e8ef'); shared style is src/App.css:43 (.alert-danger). Note: no '--border' CSS token exists in App.css.`

