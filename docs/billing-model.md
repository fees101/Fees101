# Platform billing model (how Fees101 bills schools)

How Fees101 charges schools for using the platform. This is distinct from how schools
charge parents (that is the app's core job). This doc covers the platform's own revenue:
the billing agreement, the setup fee, and the recurring monthly debit.

Companion to the ROADMAP.md "Platform billing model" item. Settled decisions are below;
open decisions are flagged and must be closed before the accrual engine is built.

---

## Settled decisions (2026-10-01, owner)

1. **Drop the legacy card model.** The Paystack card-capture + per-term card charge path
   is retired. Do not build on it.

2. **Collection is by Paystack Direct Debit mandate, not manual transfer.** The school
   authorizes a recurring mandate once. After that, Fees101 auto-debits the school's bank
   account. This is the "automatic transfer as a billing agreement" the owner wants: no
   manual transfer, no card, no reminders, no risk of a school forgetting and being
   suspended. See "Fee reality" below: Direct Debit was chosen for the automation, not the
   fee (the cheap-bank-rail assumption turned out to be wrong).

3. **A one-time, nonrefundable setup fee of ₦10,000.** Charged at onboarding. It does
   double duty: the first debit establishes the mandate, and it is real day-one revenue.

4. **The setup fee gates entry.** If the ₦10k debit fails, the owner cannot proceed into
   the app. A successful charge is what proves billing is live for that school.

5. **65 free days, then billing starts.** After the free period, the recurring monthly
   debit runs automatically on the established mandate.

6. **Agreement is clickwrap, not a per-school signed contract.** The school explicitly
   accepts billing terms (recurring debit + nonrefundable setup fee) at the "Connect
   billing" step. Record who accepted, when, and which terms version. The mandate itself
   is the legal authorization for recurring debits. Extend the existing marketing-site
   Terms with the billing-specific clauses.

## Fee reality (researched 2026-10-01, confirmed from Paystack's own docs)

The original reason for picking Direct Debit was a belief it used a cheap ~₦300 bank rail
vs ~₦2,000 for cards. **That is wrong under current Paystack pricing.** Paystack now bills
Direct Debit in the same bucket as cards:

| Rail | Fee | Cap |
|---|---|---|
| Direct Debit | 1.5% + ₦100 | ₦2,000 |
| Local cards | 1.5% + ₦100 | ₦2,000 |
| DVA inbound transfer | 1% | ₦300 |

The old DD-specific "0.5%, cap ₦500" line no longer exists; it was folded into the standard
"all local channels, including Direct Debit" rate. The cheapest inbound rail Paystack offers
is actually the DVA (1%, cap ₦300), which is the one the v2 design was moving away from.

**Decision (owner, 2026-10-01): keep Direct Debit anyway.** The deciding factor is
collection reliability, not fee. DVA is a manual push (the school has to remember to transfer
in each month); Direct Debit is an automatic pull. The autonomous cash model depends on never
having to chase, remind, or suspend a school, which only the pull delivers. The cost delta is
~₦1,700/month per school at the ₦2,000 cap (roughly 1-2% of a typical bill) and can be passed
to schools if needed.

Direct-Debit-specific notes: ~6h after authorization before the first charge is possible
(mandate activation depends on the school's bank); a ₦50 account-validation debit happens at
mandate setup (refund status not confirmed); Nigeria-only; must be enabled on the Paystack
account; test mode returns `fees: 0`, so sandbox will not show the real fee.

---

## Open decisions

- **Monthly recurring amount.** RESOLVED: ₦500 per active student per month (the v2 accrual
  engine already uses this; `platform_billing.price_per_student_month` default 500).
- **Billing cycle anchor.** RESOLVED: `onboarding_at` is set at connect-billing time (when
  the setup fee + mandate succeed), not at school-row creation. See the callback route.
- **What the 65 free days cover vs. the setup fee.** The ₦10k is charged on day 0 purely as
  setup; the free period is still fully free and the first monthly debit lands after day 65.
  (Assumed yes unless changed.)
- **Dunning policy.** Still open, belongs to slice 2. What happens when a monthly debit
  fails: retry schedule, grace period, then suspension. (The suspension ladder scaffolding
  already exists in `fees101-console/src/lib/billing.ts`.)

---

## The flow (where each piece lives)

1. **Create school + owner** - platform console `/onboarding`. (Built.)
2. **Owner sets password** - fees101-web `/set-password` via invite link. (Built.)
3. **Connect billing** - fees101-web, required onboarding step, first screen after
   password. The owner:
   - reviews the billing terms and explicitly accepts (clickwrap, recorded),
   - authorizes the direct-debit mandate,
   - is charged the ₦10,000 nonrefundable setup fee (this establishes the mandate),
   - cannot enter the app until this succeeds.
4. **65 free days start** once billing is connected (`onboarding_at` set here).
5. **Automatic monthly debits** run on the mandate after the free period.

The console shows, per school, whether the mandate is active and whether the setup fee was
paid (same read-only pattern as the setup checklist and owner-access panels already built).

## Build sequence

1. **Billing anchor + schema** - confirm/extend `platform_billing` (mandate id/status,
   setup-fee-paid flag, terms-accepted record, `onboarding_at` set at connect-billing time).
2. **Connect-billing step** (fees101-web) - terms acceptance, mandate authorization, ₦10k
   charge, entry gate.
3. **Accrual engine** - ₦500 per active student per month. Daily pro-rata into a per-school
   running balance. (The v2 engine already does this.)
4. **Recurring debit + reconciliation** - monthly debit on the mandate, reconcile against
   the balance.
5. **Dunning / suspension ladder** - on failed debit.

## Provider note

Provider is Paystack Direct Debit (settled). Slice 1 uses a separate platform Paystack
account via `PLATFORM_PAYSTACK_SECRET_KEY`; the setup-fee checkout both charges the fee and
creates the reusable mandate (`channels:['bank']`, `custom_filters.recurring:true`). Direct
Debit must be enabled on that Paystack account, and it is Nigeria-only. Test mode simulates
the flow but returns zero fees.
