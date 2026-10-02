# Fees101 — Build Phases

> Summary of build sequencing, in the shape `ROADMAP.md` already uses. This
> file is a map, not a duplicate — for full detail, line-by-line status, and
> reasoning behind each decision, go to `ROADMAP.md` itself (grep its `##`
> headers; it's ~500KB, meant to be searched, not read start to finish).

`ROADMAP.md`'s own legend: `[ ]` not started · `[~]` partial/in progress ·
`[x]` done. Last reviewed against the codebase per its own header:
**2026-07-31** (the file has moved on considerably since, per its own
entries dated into late September 2026 — check individual entries' own
dates, not the header, for freshness).

**Target**: onboard the first real school by **end of November 2026**.

## Shipped & verified (`## ✅ Shipped & verified`)

The core product loop is built and in use: student management + CSV
import, academic structure, fee setup (groups/required/optional/opt-ins/
exemptions), billing cycles/terms, invoice generation + PDFs, payments via
Monnify DVA (sandbox), Paystack as a second provider (live), discounts
(staff/sibling/scholarship, request→approve, revoke), messaging (Sendchamp
SMS + Brevo email), automatic + manual reminders, receipts, a dashboard,
year-end rollover (resumable, no-double-run), a reconcile cron, and roles &
permissions (per-school custom roles, enforced across UI + server actions +
RLS, confirmed tested 2026-09-25).

## Pre-production rebuild (`## 🧱 Pre-production rebuild`)

Foundational hardening before real school data goes in: a full RLS audit
across every table (found and fixed the same "literal role check instead of
`has_permission()`" bug repeatedly), a self-escalation/deactivation-lockdown
fix (a user could self-promote to `school_admin` via a missing `WITH CHECK`
clause — fixed), and the in-progress "Modernist" full UI redesign (see
`design.md`) — largest single ongoing effort, screen by screen.

## V1 gaps (`## 🚧 V1 gaps — needed before onboarding a real school`)

Still needed before the first real school:

- **Optional manual/cash payment entry** — deliberately off by default,
  gated behind a per-school toggle + liability agreement, itself dependent
  on the owner/admin dashboard existing.
- **Refunds/credits workflow** — deferred to v2 entirely; today only a
  "review for possible refund" warning exists.
- **Reconciliation UI** — the reconcile cron works; there's no UI yet for a
  bursar to review/match/resolve.
- Roles & permissions, discount revocation, and dashboard-for-narrow-roles
  are done and confirmed (see Shipped above) — they're listed here in
  `ROADMAP.md` for historical context, not as open gaps.
- A long tail of invoice-lifecycle edge cases (stale/out-of-date invoices
  beyond the term-detail page, non-active-term fee editing, the
  "why did my total change" financial-audit gap) are deliberately deferred,
  several explicitly pending the whole-app redesign so the UI work isn't
  thrown away.

## Reporting, analytics & data (`## 📊 Reporting, analytics & data`)

Called a **headline V1 feature**, not an afterthought. Mostly shipped: a
full `/payments` analytics page (timeline explore mode, period-over-period
deltas, multi-select compare, fee-price-over-time, drill-down to students,
discount waterfall), a categorized activity feed, and a `/reports` export
page (six report types, scoped, audited, UTF-8 BOM for Excel/₦). Open:
an "incoming-payment feed" (chronological live view of payments landing).

## Scale & reliability (`## ⚡ Scale & reliability`)

Aimed at schools of 500–1,000+ students on Vercel serverless, with no new
infra (still just Next.js + Supabase + Vercel). Shipped: the
`background_jobs` pattern (see `architecture.md`) applied to invoice
generation/regeneration, CSV import, bulk DVA, bulk send, and term close;
server-side pagination on the Students page and cycle-detail invoice list;
an N+1 fix in the core invoice-computation path (`buildInvoiceComputePreload`,
cut a 279-invoice staleness check from ~281s projected to ~1s); and
whole-app Supabase Realtime coverage (a payment landing anywhere refreshes
an open page with no manual reload, confirmed working 2026-09-24). Open:
bumping `JOB_TIME_BUDGET_MS` once Vercel's plan is upgraded (deliberately
not done preemptively), and a couple of lower-priority bulk-send
robustness items.

## Platform / owner (multi-tenant) (`## 🏢 Platform / owner`)

The Fees101-internal admin side (`fees101-console`), largely **not yet
built** as owner-facing product — schools are still created directly in
the DB today. Architecture/IA planned in
`fees101-web/docs/platform-dashboard-architecture.md` (2026-09-29). The
platform's own billing model (₦500/student/month, daily pro-rata, 65-free/
300-billed cycle, Fees101-owned DVA per school — see `PRD.md`) was decided
2026-09-29 and is **actively being built**, split into (1) the accrual
engine and (2) DVA provisioning + webhook reconciliation + suspension
ladder. Also planned but not built: tenant directory, impersonation
(read-only, by explicit owner decision), internal (Fees101-side) roles/
permissions (v2), per-tenant usage/cost-to-serve dashboards.

Self-onboarding beyond the current fully-manual process is **deliberately
paused**: the owner chose to onboard the next 2–3 schools by hand first to
learn real-world variation before building the guided
checklist/automation, per a 2026-09-25 sequencing decision recorded in
`ROADMAP.md`.

## Deferred but tracked (`## ⏳ Deferred but tracked`)

Waiting on external setup, not blocked by anything internal: moving
Monnify to live credentials, an admin dashboard for message-delivery
status, and the WhatsApp channel (deferred until the next school
onboarding). SMS provider (Termii → Sendchamp) and email provider
(Amazon SES → Brevo) migrations in this section are already **done**, kept
here for history per `ROADMAP.md`'s own note.

## Auth & onboarding (`## 🔐 Auth & onboarding — LAST, deliberately`)

Kept until near launch on purpose, so login friction doesn't slow daily
testing. Logout's cookie-flush bug is fixed. Still open: 2FA, active
session/device management.

## Security & go-live hardening / Business & launch readiness

Two sections (`## 🔒 Security & go-live hardening`, `## 📣 Business &
launch readiness`) covering credential rotation, sandbox→prod swaps, and
dev-tool removal before production launch — see `ROADMAP.md` directly for
the checklist; it's a pre-launch gate, not ongoing feature work.

## Future / bigger bets (post-V1) (`## 🌱 Future / bigger bets`)

Explicitly **not** for the current push: an in-product notification/tips
system + a setup-guide mascot, a parent-facing portal, per-student one-off
charges, installment plans, automatic late fees, per-school custom email
templates, an app-wide term/session time-travel view, class-arm grouping,
and family-level shared DVAs (this last one is actually well along —
several phases shipped and real-transfer-tested as of 2026-09-27, despite
living under the "future bets" heading; check its own sub-entries before
assuming it's unstarted).

## AI integration (`## AI integration — research & plan`)

Research-only, nothing built. Ranked priority: (1) CSV import
column-mapping assistant, (2) natural-language Q&A over existing reports/
analytics (routes to existing typed functions, never computes a number
itself), (3) AI-assisted ad hoc collections messaging, (4) anomaly/fraud
review (mostly a deterministic-code problem, not an AI one), (5) WhatsApp/
SMS chatbot (judged probably not worth building soon). Haiku-class models
are the recommended default for all of them — none need a frontier model.

---

**Rule this file exists under**: whenever a session turns up an
enhancement, idea, or "we should do X later," it gets added to
`ROADMAP.md` immediately (`ROADMAP.md`'s own stated working rule) — this
`phases.md` file is a snapshot summary for orientation, not the place new
items get recorded.
