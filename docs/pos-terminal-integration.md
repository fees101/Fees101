# Fees101 × Paystack Terminal (in-person card POS) — Implementation Plan

> How Fees101 adds an **in-person card/USSD/transfer collection rail** using the
> **Paystack Physical Terminal (Morefun MF960)**, reconciled automatically through
> the existing webhook pipeline so **no bursar ever types a payment amount by hand**.
>
> Status: **planning / research** (2026-10-04). Nothing built yet. Written for the
> owner + the coworker Claude session. Build against this doc.

---

## 1. Why this exists (the real gap)

Fees101 already has two auto-reconciled rails:
- **Per-student DVA** (bank transfer → webhook → applied). Covers "parent transfers."
- **Platform Direct Debit** (platform billing only, not school fees).

What neither covers: **a parent walking into the school office and paying by CARD
(chip/tap) in person.** The Paystack Terminal is the only thing that adds a real
**card reader**. It also does USSD + transfer, but those overlap with DVAs — **card
acceptance is the unique value.**

**Data-integrity win (the owner's core motivation):** every terminal payment is a
real Paystack transaction that fires a webhook. The bursar initiates the charge but
**never enters the amount/paid-status into Fees101 manually** — so no one can
fabricate or mis-key a payment. This lets us tighten/audit the manual-payment path,
because the legitimate in-person case is now a verified rail.

**Scope:** Paystack schools only (Terminal is a Paystack product). Monnify schools
don't get this initially — note as an open question, don't block on it.

---

## 2. Integration model — Model A only ("Push Payment Request")

The **live MF960 does NOT allow installing custom apps** (confirmed on Paystack's
product page: *"you will not be able to install any apps on this device"*). So the
on-device custom-app model (Model B) is **out**. We use **Model A**: our server
creates a payment request and **pushes it to the registered terminal**; the device
shows the amount; the parent pays; Paystack webhooks back. No app on the device.

### The Paystack flow (per Terminal API docs)
1. **Create a payment request (invoice)** — `POST /paymentrequest` with amount,
   customer, description, and **our own reference / metadata** we can resolve later.
   Returns an `id` and an `offline_reference`. (Fires `paymentrequest.pending`.)
   **✅ Confirmed by Paystack (2026-10-05):** you *can* attach a reference/metadata
   field when pushing a payment request, to tie the resulting charge back to internal
   records — i.e. the whole reconciliation design in §3.3 is supported by their API.
2. **Push to the device** — `POST /terminal/:terminal_id/event`:
   ```json
   { "type": "invoice", "action": "process",
     "data": { "id": <paymentrequest id>, "reference": <offline_reference> } }
   ```
   A 200 means *queued to the device*, not *received*.
3. **Confirm delivery** — `GET /terminal/:terminal_id/event/:event_id` (Terminal
   Event Status) to confirm the device actually got it (show "sent ✓" vs "couldn't
   reach terminal, retry").
4. **Parent pays** on the device (card / USSD / transfer).
5. **Webhooks fire** to our existing endpoint:
   - `charge.success` — the money event (amount, reference, customer, card).
   - `paymentrequest.success` — the invoice-level confirmation (carries our ref).
   - failure path: `invoice.payment_failed` / no success within TTL.
   - **✅ Confirmed by Paystack (2026-10-05, Deborah):** the `reference` we pass is in
     **`data.reference`**, and any metadata we attach is returned in
     **`response.metadata`** — **both present on `charge.success` AND
     `paymentrequest.success`.** So we can match reliably from either event.
6. **List terminals** — `GET /terminal` lets us auto-discover a school's registered
   `terminal_id`(s) from their key (no manual ID entry).

---

## 3. Fees101 architecture — where each piece lands

### 3.1 Provider layer (`src/lib/payments/paystack.ts`)
Add methods to `PaystackProvider`, all using `this.creds.secretKey` via the existing
`paystackRequest(secretKey, method, path, body)` helper:
- `listTerminals()` → `GET /terminal`
- `createPaymentRequest({ amount, customer, reference, description, lineItems })` →
  `POST /paymentrequest`
- `pushEventToTerminal(terminalId, { paymentRequestId, offlineReference })` →
  `POST /terminal/:id/event`
- `getTerminalEventStatus(terminalId, eventId)` → `GET /terminal/:id/event/:eventId`

Only Paystack implements these; `getPaymentProviderForSchool` already returns the
right provider per school. A Monnify school calling this path returns "not supported."

### 3.2 Schema (new `db/pos_terminal.sql`)
- **`school_terminals`** — one row per physical device a school owns: `school_id`,
  `terminal_id` (Paystack), `serial`, `label` (e.g. "Front desk"), `status`,
  `last_seen_at`. A school can have several (multi-desk / multi-campus).
- **`terminal_payment_requests`** — one row per push, the heart of reconciliation:
  `school_id`, `student_id`, `invoice_id`, `family_id?` (support family DVA-style
  multi-child later), `terminal_id`, `paystack_payment_request_id`,
  `offline_reference`, **`reference`** (our resolvable key), `amount`, `status`
  (`pending → sent → paid | failed | expired`), `event_id`, `pushed_by` (bursar),
  timestamps, `expires_at`. This row is what the UI polls and what the webhook flips.

### 3.3 Reconciliation (extend `src/lib/payments/paystackWebhookProcessor.ts`)
Today: `charge.success` → `resolveDvaOwner(supabase, schoolId, customerCode)` →
`applyProviderPayment`. **Terminal payments won't have a DVA customer_code match** —
they carry **our `reference`**. So:
1. On `charge.success` (and/or `paymentrequest.success`), **first try to match on
   `data.reference`** (Paystack-confirmed location) — and, as a belt-and-braces,
   `response.metadata` (we'll also stash the invoice/request id there) — against a
   `terminal_payment_requests` row. If found → that's a terminal payment → apply to its
   `invoice_id` via the same `apply_payment_to_invoice` RPC (gross credit, idempotent),
   mark the row `paid`. **Both events carry these fields (confirmed 2026-10-05), so
   whichever arrives first can reconcile; the second is deduped by idempotency.**
2. If no terminal-request match → fall through to the existing `resolveDvaOwner`
   DVA path (unchanged).
   This keeps DVA behaviour untouched and adds terminal as a parallel resolver —
   same pattern as `resolveDvaOwner`'s student-then-family fallback.
3. **Idempotency** stays as-is (the processor already dedupes by reference /
   `apply_payment_to_invoice` locks per invoice), so a duplicate webhook can't
   double-apply.

### 3.4 Notifications — reuse, don't rebuild
Because the terminal payment flows through **`applyProviderPayment`**, the existing
receipt path fires automatically: **the parent gets the normal payment SMS/email +
receipt PDF**, identical to a DVA payment. **No new notification templates needed**
(respects [[feedback_account_for_existing_automation]] — don't add redundant
notifications). The only *new* feedback is **on-screen for the bursar** (below).

### 3.5 UI — where the bursar pushes a charge
**Anchor it to an invoice** (the owner's instinct is right — tying it to an invoice
makes the amount + reference unambiguous and reconciliation clean):
- **Primary home:** a **"Charge on Terminal"** button on the **invoice detail page**
  (`src/app/(app)/money/invoices/[id]/page.tsx`) and on **`StudentFeesTab.tsx`**
  beside an outstanding invoice.
- **Flow:** click → (if >1 terminal) pick device → confirm amount (default =
  outstanding, editable down for a partial) → push → a modal shows **"Sent to
  [Front desk]… waiting for payment"** with **live status** (poll the
  `terminal_payment_requests` row, which the webhook flips to `paid`) → on success
  **"Paid ✓ — receipt sent."** Partial amounts just ride the existing oldest-first
  waterfall.
- **Settings:** a **Terminals** section under payment settings that calls
  `listTerminals()` to **auto-discover + label** the school's devices (no manual ID
  typing) and shows each device's status.
- **Optional later:** a dedicated "Collect payment" page (search student → pick
  invoice → charge) for a till-style workflow. Not needed for v1.

### 3.6 Money & fees
Settles to the **school's own Paystack account** (their key, their terminal) — Fees101
never holds funds, consistent with the whole model. Credit the invoice **gross**
(Paystack's terminal fee — card 0.5% capped ₦1,000; USSD/transfer 1.5%+₦100 capped
₦2,000 — is the school's cost, not deducted from the invoice), **same as the DVA
rail** so behaviour is consistent.

---

## 4. Edge cases to handle
- **Device offline / event not delivered** → event-status check fails → "couldn't
  reach terminal, retry," don't leave the row stuck on `sent`.
- **Parent cancels / fails on device** → `invoice.payment_failed` or TTL hit → mark
  `failed`/`expired`, allow re-push.
- **Timeout** → `expires_at` on the row; a sweep (reuse the job-sweep pattern) expires
  stale `pending`/`sent` requests.
- **Double push** → idempotent on our `reference`; webhook apply is already idempotent.
- **Reconcile backstop** → extend `reconcile.ts` to also sweep open
  `terminal_payment_requests` against Paystack transactions, mirroring how it already
  backstops DVA webhook misses.
- **Wrong amount edited up** → cap the editable amount at the invoice outstanding (or
  allow overpay → credit_balance, same as DVA overflow — decide in build).

---

## 5. Testing strategy — updated after Paystack correspondence (2026-10-05)
**There is NO test/developer device available** (confirmed by Paystack twice, 2026-10-05):
no self-serve test device, no email-request dev device, and the push-payment-request
flow **requires a physical device even in test mode** (there is no device-free sandbox
for the push leg). Paystack say they are "actively working on acquiring test devices"
and will notify us — so plan without one for now.

So the realistic path:
1. **Server/webhook leg — synthetic, no device (do this now):** build the flow, then
   POST **signed synthetic `charge.success` / `paymentrequest.success`** payloads
   carrying a terminal `reference` to the local handler and assert matching +
   `apply_payment_to_invoice` + receipt — the **exact method already proven on the DVA
   + family-DVA webhooks.** Covers resolution, waterfall, idempotency, gross credit.
   This validates everything *except* the physical create→push→device round-trip.
2. **Real round-trip — requires buying a LIVE device:** since no test unit exists,
   validating the actual push-to-device + pay leg means ordering a **live MF960**
   (₦86,000, store: https://paystack.shop/paystack-terminal-store; delivery 5–7 working
   days Lagos/Abuja, 7–14 other states; registered Nigerian business only). A live
   device charges real money, so test with a **tiny real amount** (e.g. ₦100) against a
   real invoice, then refund/reconcile. Point the webhook at production.
   - **✅ Paystack confirmed (2026-10-05) buying a live device and running test
     transactions on it is allowed** — but the account **can be flagged** by their
     fraud monitoring if we're careless. Their cautions, so we test cleanly:
     keep **amounts small**, use **valid real cards** (not invalid/expired/blocked —
     repeated failed card attempts trip fraud checks), avoid **unusual patterns**
     (high-volume low-value or rapid successive charges), and keep **customer details
     consistent** with the business. In short: a few small, real, spaced-out
     transactions — not a stress-test hammering the device.
3. **Roll out** once the live round-trip is confirmed.

> Trade-off to accept: the create-request + webhook-reconcile logic is fully testable
> now without hardware; only the final "device lights up and takes a card" leg needs a
> paid live device. That leg is thin and well-documented, so the risk of buying one
> live unit to confirm it is low — but it is a real ₦86k commitment, not a free test.

---

## 6. School-facing setup (the "how a school uses it" instructions)
1. School orders a **Paystack Terminal** from their own Paystack dashboard (or Fees101
   guides them). Device is tied to **their** Paystack account.
2. In **Fees101 → Payment settings → Terminals**, click **Refresh** — Fees101
   auto-discovers the device via `listTerminals()`; the school **labels** it
   ("Front desk").
3. To collect: open the student's **invoice** → **Charge on Terminal** → pick device →
   confirm amount → hand the parent the terminal → they pay by card/USSD/transfer →
   Fees101 marks it paid and sends the receipt automatically.
No manual payment entry; nothing to type after the parent pays.

---

## 7. Build sequencing
1. **Schema** (`db/pos_terminal.sql`: `school_terminals`, `terminal_payment_requests`).
2. **Provider methods** on `PaystackProvider` (list/create/push/status).
3. **Webhook reconciliation** — reference-match resolver in
   `paystackWebhookProcessor.ts`, before the DVA fallback. **Synthetic-test here.**
4. **Server actions** — create-request + push + poll-status; `listTerminals` settings.
5. **UI** — "Charge on Terminal" on invoice detail + StudentFeesTab; status modal;
   Terminals settings section.
6. **Reconcile backstop + expiry sweep.**
7. **Dev-device round-trip test → live.**

---

## 8. Open decisions (owner)
- **Overpay on a terminal charge** → block at outstanding, or allow → `credit_balance`
  (reuse DVA overflow behaviour)?
- **Family terminal payment** (one card charge across siblings) — mirror the family-DVA
  waterfall, or keep terminal strictly single-invoice for v1? (Recommend single-invoice
  v1; family later.)
- **Monnify schools** — do they get an equivalent (Monnify has its own terminal), or is
  in-person card a Paystack-only feature of Fees101 for now?
- **Who buys the device** — school buys their own (keeps per-school account model), or
  Fees101 bulk-orders and resells/leases as an onboarding add-on?

---

## Appendix — Paystack bug to report (when emailing for the dev device)
In **Test mode**, the Terminals page offers "request a physical device → Visit
compliance," which routes an **already-verified** account through the **full
compliance flow again** (pre-filled but with no indication it's unnecessary); it
returns "submitted for review" despite the business already being verified. There is
also **no indication that test mode has no self-serve device** (you must email
`terminal@paystack.com`). Suggested fixes: skip/label compliance for verified
accounts, and make clear in test mode that a dev device is requested by email. Fold
this into the dev-device request email.
