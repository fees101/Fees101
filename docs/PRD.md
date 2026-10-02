# Fees101 — Product Requirements

> Source of truth for *what* and *why*. For build order see `phases.md` /
> `ROADMAP.md`. For system shape see `architecture.md`. For visual system see
> `design.md`.

## What it is

From `ROADMAP.md`'s own framing (unchanged since it was written, still the
guiding line):

> **Fees101 is not a School Management System. It is a School Revenue
> Operations Platform.**

The bet: remove cash-handling friction (autonomous bank-transfer collection
via a dedicated virtual account per student/family, manual/cash entry off by
default) and remove parent-portal friction (SMS/email instead of a login) —
not build a general-purpose school ERP. Attendance, results, timetables,
LMS, HR/payroll are explicitly out of scope unless a school forces the
question. Scope creep toward "manage the whole school" is a deliberate no —
treat any feature request in that direction as a flag to re-check against
this line, not a default yes.

## Who it's for

- **Nigerian schools** (private, fee-collecting) — the paying customer.
- **School admins/owners** — set up fee structure, manage staff/roles,
  watch collections, approve discounts.
- **Bursars / finance staff** — day-to-day invoicing, reminders,
  reconciliation, permission-scoped by role.
- **Parents** — receive invoices/reminders/receipts by SMS/email and pay by
  bank transfer to a dedicated virtual account. Deliberately no login (a
  parent-facing portal is listed as a post-V1 "future bet" in `ROADMAP.md`,
  not a V1 requirement).
- **Fees101 itself** — the platform owner/operator, served by a separate
  internal console (`fees101-console`), not by the school-facing product.

## Core jobs-to-be-done

Pulled from `ROADMAP.md`'s "Shipped & verified" section — these are the
jobs the product already does, not aspirational ones:

1. **Fee structures** — fee setup by class, fee groups, required vs.
   optional items, opt-in/opt-out, exemptions, recurring vs. one-time fees.
2. **Invoicing** — per-billing-cycle invoice generation (idempotent,
   carries forward previous balance), PDFs, bulk regeneration.
3. **Payment collection** — dedicated virtual accounts (DVA) via Monnify
   and Paystack, per-student or per-family, webhook-driven.
4. **Payment reconciliation** — webhook processing plus a backend
   reconcile cron as a safety net for missed webhooks (reconciliation UI
   itself is a listed V1 gap, not yet built).
5. **Collection tracking** — dashboard KPIs, a payments/analytics page
   (timeline, compare mode, drill-down), downloadable reports/exports.
6. **Reminders & receipts** — automatic advance/due/overdue reminders,
   manual sends, SMS (Sendchamp) + email (Brevo) with PDF receipts.
7. **Discounts** — staff/sibling/scholarship-bursary discounts, a
   request→approve workflow, recurring carry-forward, revoke.
8. **Roles & permissions** — per-school custom roles gating both UI and
   server actions, built and confirmed tested 2026-09-25.

Open note: "the kind of useful information schools actually want to see" is
called out in `ROADMAP.md` as a headline V1 feature in its own right
(reporting/analytics), not a side effect of the above — worth remembering
when prioritizing.

## The platform's own billing model (accrual)

Fees101 charges *schools*, not parents, for using the platform:

- **₦500 per active student per month**, charged as daily pro-rata
  (₦500 ÷ 30 ≈ ₦16.67/active-student/day) — a mid-term joiner/leaver is
  billed only for their active days.
- **Recurring 65-free / 300-billed day cycle**, anchored to each school's
  onboarding date (365-day cycle = 65 free + 300 billed). The first 65 is
  onboarding grace; the recurring 65 is a standing "we give you ~2 months
  free" framing.
- **Collection**: a Fees101-owned dedicated virtual account per school,
  into which the school transfers its bill — flat ₦300 transfer fee,
  versus card `charge_authorization` (1%, capped ₦2,000), which is far
  costlier for larger schools. A DVA is push-only (inbound), so
  "automatic" here means auto-generated bill + auto webhook reconciliation
  + auto suspension ladder, not a true auto-pull; card auto-charge is
  planned as an optional zero-touch fallback for schools that accept the
  higher fee.
- **This is billed to the school, not the parent** — the separate idea of
  a ₦2,000/student tuition markup (to fund Fees101 off the parent-paid
  Paystack fees) was explicitly superseded by this model on 2026-09-29;
  the parent-side Paystack transaction fee is now the school's own
  concern, explained at onboarding.
- Status as of this doc: **decided, build in progress** — schema and the
  accrual engine / DVA-provisioning-and-reconciliation build are actively
  being split across two work streams per `ROADMAP.md`'s "Platform / owner"
  section. Exact cycle-anchoring, suspension day-counts, and the
  card-fallback UX are still open design questions there.

## V1 target

**Onboard the first real school by end of November 2026.** Every build
session is meant to work toward that date. Sequencing rules from
`ROADMAP.md`:

- Build first what doesn't depend on live payments or live messaging
  (both already went live during development, but the rule shaped build
  order).
- **Auth/onboarding hardening comes last** deliberately, so login friction
  doesn't slow daily testing before launch.
- Before launch: a fresh DB rebuild, UI rebuild (the "Modernist" redesign,
  see `design.md`), docs/help center, and go-live security hardening.

See `phases.md` for what's shipped vs. outstanding against that target, and
`ROADMAP.md` itself for the living, line-by-line detail — this file
intentionally does not restate that detail.

## Open questions (flag, don't assume)

- Exact "active student" definition for platform billing (a withdrawn
  mid-month student's exact accrual edge cases) is still being refined —
  see `ROADMAP.md`'s Platform billing section before building against it.
- Whether/when a parent-facing portal gets built is unresolved — the
  current product bet is deliberately login-free for parents; treat any
  portal work as a distinct, later decision, not an assumed roadmap item.
