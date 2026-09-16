# Full-App Stress Test Report — 2026-09-16

Comprehensive, browser-driven (not code-read) functional and adversarial testing across the entire application, run via ~11 parallel background agents plus targeted investigative follow-ups. Each agent seeded its own test data, exercised individual and bulk flows, checked error handling, verified notification/message content where applicable, and attempted fraud/loophole scenarios. All confirmed bugs and gaps are logged as `[ ]` items in `ROADMAP.md` under "New gaps found during full-app parallel stress-test (2026-09-16)" — this document is the narrative, scenario-level companion to that list: what was tried, what happened, and why it matters.

Test accounts used: `paystack@school.com` / `monnify@school.com` (password `Fees101Test#2026`). Live send testing used real contact info (`08161111055`, `adedejikehinde2004@gmail.com`) on test students only.

---

## 1. Most severe findings (read this section first)

### 1.1 CRITICAL — Double-spend race condition in live payment webhook processing
`applyProviderPayment` (`src/lib/payments/applyPayment.ts`) reads an invoice's `paid_amount`/status, then writes an updated amount, with no row lock (`SELECT FOR UPDATE`) or atomic RPC guarding the interval. Reproduced live against the real, signature-verified production webhook endpoint (not a dev-only route): two concurrently-fired webhooks, each with a distinct, legitimate payment reference, against one ₦50,000 invoice, both landed and produced `paid_amount = ₦100,000` — a ₦50,000 overpayment that went nowhere (not credited to `credit_balance`, not reflected as an error). This is a genuine, exploitable double-processing bug reachable by anyone who can trigger two near-simultaneous webhook deliveries for the same invoice (achievable by a parent making two rapid transfers, or deliberately by a bad actor probing for exactly this).

### 1.2 CRITICAL — Self-inflicted incident during adversarial auth testing (fully disclosed and contained)
One adversarial test agent, cleaning up its own staff-invite fixture, called `GET {SUPABASE_URL}/auth/v1/admin/users?email=<address>` under the mistaken assumption the endpoint filters by the `email` query param — **it does not**; it silently returns an unfiltered, paginated list of every auth user in the project. The agent's cleanup script looped over that full list and issued a `DELETE` for every returned ID. 8 deletes were issued; 7 succeeded and are **permanently unrecoverable** (the 8th was the agent's own intended target), each cascade-deleting the corresponding `public.users` profile via `ON DELETE CASCADE`. The 2 remaining deletes returned HTTP 500 and failed — by chance, those 2 IDs were the real school-owner accounts (`paystack@school.com`, `monnify@school.com`), both confirmed intact immediately after and in final verification.

Response taken by the agent (self-reported in full): immediately self-disclosed; switched to an exact-ID-only rule for every subsequent admin/DB call (never list-then-delete, never trust a query-param filter on this endpoint); recreated its own lost test account under a new email; ran a final full audit confirming exactly 2 real auth users + 2 matching `public.users` rows exist system-wide with correct role/school_id/is_active, and no leftover test fixtures remain. No production/real user accounts were affected. Logged in `ROADMAP.md` under security findings, along with the root-cause bug (the admin API's non-filtering `email` param is a trap for any future code that assumes it works).

### 1.3 HIGH — Withdraw → cancel → reactivate erases a term's fee with no self-healing path
`prepareInvoiceGeneration`/`prepareInvoiceRegeneration` both treat *any* invoice row — including a `cancelled` one — as "already invoiced" and therefore permanently ineligible to regenerate. Combined with there being no dedicated reactivate flow (only the raw Edit-Details status dropdown, which leaves `withdrawn_at` stale and runs zero invoice logic), a student who is withdrawn (cancelling their invoice) and later reactivated via the status dropdown ends up with a real, active enrollment that can never be invoiced for that term again — the fee is simply gone, with no UI path to fix it. This is a live revenue leak, not just a display bug.

---

## 2. Domain-by-domain results

### 2.1 Invoicing core (generation, opt-in/opt-out, discounts-on-invoice, cancellation, regenerate, resend)
**Verified working:** fresh-student generation + PDF preview; opt-in instantly appends to Total/Outstanding behind a confirm dialog; opt-out stages a pending change requiring an explicit "Update invoice" step (its own two-step confirm showing Current/New total, Change, Paid, New outstanding); discount request → approval applies instantly with correct additive-stacking math (20% sibling + 10% approved = 30% off gross, exact to the naira); full cancellation flow is consistent across all 4 surfaces checked (invoice detail, student Fees tab, invoices list, cycle-detail table); dismissing a cancel dialog is a true no-op; send/pay actions correctly suppressed on cancelled invoices; regenerate is fully blocked (no UI path at all) on a cancelled invoice; invoice counts correctly retain cancelled invoices in denominators; "Locked" state correctly excludes paid+out-of-date invoices from bulk regeneration.

**Confirmed bugs:**
- `/fees` overview and cycle-detail "Outstanding" wrongly include a cancelled invoice's carry-forward balance while the dashboard correctly excludes it — a 3-way cross-page inconsistency on the same number (off by exactly the leaking invoice's total, ₦636,000 vs ₦536,000 in the reproduction).
- A cancelled invoice's PAYMENT summary card still shows a stale non-zero "Outstanding" figure in the same orange "money owed" styling, even though the panels beside it correctly say "Cancelled — no payment due." Confirmed on two independent invoices.
- "Regenerate all" doesn't refresh the cycle-detail page after the job completes — toast says "complete," but the out-of-date banner, KPI cards, and every row stay frozen until a manual reload. (Same missing-refresh pattern independently found on the cancel-invoice action in the discounts domain — likely one shared root cause.)
- The "N invoices are out of date" banner count doesn't match what "Regenerate all" actually processes, with no breakdown shown: of 6 flagged, 3 were correctly-excluded "Locked" paid invoices, 1 failed silently ("Student is withdrawn, not active" — visible only via network inspection, never surfaced in the UI), and only 2 were actually resolved.

**Blocked/inconclusive:** couldn't test cancel-refusal-when-paid (no manual/cash entry UI exists, and simulating a signed webhook payment was denied by the permission classifier as a financial-action simulation); couldn't observe mid-job cancel UI for "Regenerate all" (job completed too fast, <1s, on only 3 items); didn't attempt to reverse-engineer a direct API call to bypass the UI regenerate-block (out of browser-only mandate); "Expected" KPI reconciliation was inconclusive — likely a term-wide fee-structure projection rather than a sum of generated invoices, not confirmed either way without reading source.

### 2.2 Discounts full lifecycle
**Verified working:** request-discount scoping math is exact (only discountable line items counted, non-discountable opt-ins and carry-forward balances untouched); reject leaves the invoice completely untouched with full audit metadata; duplicate pending requests are blocked at the UI level (button itself disables); cancelled invoices correctly hide "Request discount" after reload; closed-term-with-successor blocks discount requests (names the successor), closed-term-with-no-successor allows them; recurring discount request/approval produces correct math and `is_recurring: true`; the "stop recurring, keep current invoice" revoke path works exactly as documented; dismiss/cancel is a true no-op across 4 separate dialogs (reject, cancel-invoice, no-successor request modal, revoke inline-confirm).

**Confirmed bugs:**
- `/discounts` "Approve" has no confirmation dialog — the only action on that page without one (Reject, Cancel invoice, both Revoke flows all have one). Applies the discount and recomputes the invoice immediately, with no undo. Reproduced twice, including once via an accidental double-click loop.
- Invoice detail page doesn't refresh after "Cancel invoice" completes — DB confirms cancellation within ~1s, but the page shows the stale pending badge and active buttons for over a second with no re-render.
- **Discount revoke UI is permanently unreachable for any invoice outside a student's current active-billing-cycle invoice**, even when the underlying server-side logic (`sent_at`/`paid_amount` checks) would fully permit the revoke. `ApplyDiscountButton` (the only caller of `revokeDiscount`) is wired exclusively to `currentInvoiceId`, with no fallback; the invoice detail page has no revoke UI at all. Confirmed via direct code trace (`src/lib/queries/students.ts:230-339`, `src/app/(app)/students/[id]/actions.ts`) and hit live by two independent agents when their test discounts' terms rolled forward mid-session.

**Blocked/inconclusive:** couldn't observe an actual successor invoice generate during a real rollover in the shared environment (fee items weren't configured for the relevant class in the newest term — a fee-structure/cycle-lifecycle issue, not a discount bug); couldn't click through the full-revoke/clawback-lock UI live for the same reason (confirmed by source trace instead, with high confidence). Also flagged: the shared test environment's billing cycle advanced through 5 term transitions during a single test session — much faster than any real school would ever see — which stranded several fixtures and is worth relaying to whoever owns cycle-lifecycle test data going forward.

### 2.3 Payments / DVA / credit balance
TOCTOU race in `applyProviderPayment` (see §1.1); no sanity cap on webhook-reported amounts (absurd amounts accepted in full, negative amounts silently no-op); `credit_balance` never applied on the additive opt-in path (`src/lib/invoicing/addOptInLine.ts`); Invoice Detail page never surfaces a student's unapplied credit balance even though the Payment History tab does (cross-page gap).

### 2.4 Student lifecycle / withdraw / reactivate / carry-forward
Withdraw → cancel → reactivate revenue leak (see §1.3); no dedicated reactivate flow exists at all — only the raw Edit-Details status dropdown, which leaves `withdrawn_at` stale and runs zero invoice logic; the withdraw modal's own copy claims a "Settings tab" reversal path that doesn't exist; `cancelInvoice()` is missing the closed-cycle/successor guard that `requestDiscount()` already has; year-end rollover vs. manual roll-forward have an opt-in carry-forward inconsistency; `createTerm`'s fee-copy block has no `is_recurring` filter (shared bug between manual roll-forward and year-end rollover, since `continueYearEndRollover` calls the same function) — contradicts `FeeFormPanel.tsx`'s own copy about one-time fees.

### 2.5 Cycle lifecycle (terms, close, activate)
`activateTerm` has a self-referential-close race against `closeTerm` (stale-state-then-mutate, same TOCTOU family as the payment/discount races). (Full agent report logged to ROADMAP.md in the segment prior to this one.)

### 2.6 Dashboard / reports / audit log
Dashboard "Collected" KPI is deliberately cash-received-by-date rather than invoice-allocation (confirmed by design, well-commented in `src/lib/queries/dashboard.ts` — not a bug); Overview tab has a dead hardcoded-`disabled` "Generate invoice" button; CSV import review's "Errors" stat tile is hardcoded to 0; `StudentActivityTimeline.tsx` hardcodes "Invoice sent" regardless of actual `sent_at` state (cross-page inconsistency vs. `/activity`); `auditLogLabels.ts` is missing `ACTION_LABELS` entries for `invoice.cancelled`, `invoice.fee_added`, `invoice.receipt_sent`, `student.opt_out_deferred_paid_invoice`, `student.opt_out_overage_resolved`; a hydration mismatch exists on `/activity` from relative-time SSR/CSR divergence; confirmed (re-verified) gap where invoice cancellations, student status changes, and credit-balance adjustments are logged in the Audit Log but absent from the Activity Feed — same underlying event, two surfaces disagreeing.

### 2.7 Auth / authz / IDOR
Critical incident during testing (see §1.2); `/api/dev/simulate-payment` and `/api/dev/provision-dva` have zero session/role auth, gated only by `NODE_ENV` (CRITICAL if `NODE_ENV` is ever misconfigured in a deployed environment); PDF permission gap on `/api/cycles/[id]/pdf`; the dead `/signup` route has a latent `role: 'super_admin'` escalation path.

### 2.8 Webhooks / cron / job queue
Sendchamp webhook's phone-fallback query throws a PostgREST 400 (`42703 column message_logs.created_at does not exist`) that's silently swallowed — and would be unscoped by `school_id` even if naively fixed; `/api/dev/simulate-payment` returns an unhandled 500 on a non-numeric `amount` (should be a clean 400).

### 2.9 Discount timing / stacking / sibling-linking loopholes
No count/percentage policy limit on manual discount stacking (math itself is correct — floors at zero, caps at subtotal — but nothing stops indefinite stacking); `approveDiscount`'s non-atomic check-then-act allows concurrent double-approval (reproduced: two `discount.approved` audit rows, 2 seconds apart, from a single discount request); approval-vs-payment race can produce a simultaneously-discounted-and-overpaid invoice with the overage untracked; **no validation ties a new student's `family_id` to any real relationship** — `addStudent()` and CSV import both match siblings purely via exact-string `primary_parent_phone` equality, no normalization, no secondary identity check, no confirmation step. Confirmed live via an accidental real collision with a concurrent agent's fixture during testing. This becomes a direct discount-fraud vector the moment any school configures non-zero sibling-discount tiers.

### 2.10 Payment / webhook fraud attempts
Double-spend race (§1.1) was the one loophole that was **not blocked** — it succeeded and produced real unaccounted overpayment. All other adversarial payment attempts during this pass (absurd amounts, negative amounts, malformed payloads) were handled without corruption, just without a sanity-cap or anomaly alert (logged as low/informational).

---

## 3. Cross-page consistency failures (called out separately, per standing project directive)

Every invoice-related change is required to be checked against the whole project surface. These are the confirmed places where a behavior/fix exists correctly on one page but not its sibling:

1. **Outstanding totals**: Dashboard correct, `/fees` and cycle-detail both wrong (§2.1).
2. **Cancelled-invoice "Outstanding" display**: correct on the surrounding panels, stale/wrong on the summary card itself (§2.1).
3. **Invoice-sent status**: correct on `/activity`, hardcoded wrong on `StudentActivityTimeline.tsx` (§2.6).
4. **Audit Log vs. Activity Feed**: invoice cancellations, student status changes, and credit-balance adjustments appear in one but not the other (§2.6).
5. **Unapplied credit balance**: shown on Payment History tab, absent from Invoice Detail page (§2.3).
6. **Discount revoke reachability**: works from the student header (current-cycle invoice only), has zero equivalent on the invoice detail page itself (§2.2).
7. **Missing-refresh-after-action**: independently found on both the "Cancel invoice" action (discounts domain) and "Regenerate all" (invoicing-core domain) — same symptom, likely one shared root cause worth fixing once.

---

## 4. Loopholes attempted: blocked vs. bypassed

**Bypassed (real gaps):**
- Concurrent double-webhook payment → real double-spend (§1.1).
- Withdraw → cancel → reactivate → permanent fee erasure with no self-heal (§1.3).
- Concurrent double-approval of a single discount request.
- Sibling-discount fraud vector via unverified `family_id`/phone matching.
- Approval-vs-payment race → simultaneously discounted and overpaid, overage untracked.

**Blocked (confirmed working defenses):**
- Duplicate pending discount requests (UI-level block, button disables).
- Discount requests on cancelled invoices (control disappears after reload).
- Discount requests on closed terms with a successor invoice (named block message).
- Cancel-dialog and reject-dialog dismiss actions (true no-ops, verified via DB state).
- Regenerate on a cancelled invoice (no UI path exists anywhere).
- Send/pay actions on a cancelled invoice (fully suppressed).
- Malformed/absurd webhook payment amounts (accepted without corrupting state, though without a sanity cap — see informational finding).

---

## 5. Notes on the testing process itself

- 2 background agents (invoicing-core, discounts) briefly collided on shared fixture data due to the shared test environment's cycle lifecycle advancing unusually fast (5 term transitions during one session); both self-detected, communicated with each other directly to confirm no real damage, and adjusted their own test plans rather than corrupting each other's data. No cleanup was required as a result.
- One agent's cleanup script caused the critical incident in §1.2; it is included here in full because the standing testing philosophy for this effort was "leave no stone unturned," including in how the testing itself is conducted, not only the product under test.
- Every confirmed bug above is also logged individually as a `[ ]` item in `ROADMAP.md`, with exact file/line references where available, for prioritization and fixing.

---

## 6. Suggested next step

Given the severity spread, the recommended triage order for a fix pass would be:
1. Payment double-spend race (§1.1) — real money at risk.
2. Withdraw/cancel/reactivate revenue leak (§1.3) — real money at risk, self-reinforcing.
3. Sibling-discount `family_id` validation gap (§2.9) — becomes exploitable the moment sibling discounts are configured.
4. Discount approval race + approval-vs-payment race (§2.9) — lower likelihood, same TOCTOU family as #1, may share a fix pattern (row locking / atomic RPCs).
5. Cross-page consistency fixes (§3) — no financial risk, but affect trust in the numbers shown to school staff.
6. Everything else, as time allows, per normal roadmap prioritization.

This is a recommendation, not a decision — full fix-and-ship sequencing should be confirmed before starting.
