# Fees101 — Roadmap & Build Checklist

> Living document. Single source of truth for what we've built, what's stubbed,
> and what's still needed. Check items off (`- [x]`) as they ship. Add, edit, or
> remove freely — this file is meant to be edited by hand.
>
> **Working rule:** whenever an enhancement, idea, or "we should do X later" comes
> up in any working session, it gets added here immediately so nothing is lost.
>
> Last reviewed against the codebase: **2026-07-31**

## 🧭 What Fees101 is

**Fees101 is not a School Management System. It is a School Revenue Operations Platform.**

The bet: remove cash-handling friction (autonomous bank-transfer collection via DVA, manual/cash entry off by default) and remove parent-portal friction (SMS/email instead of a login) — not build a general-purpose school ERP. Attendance, results, timetables, LMS, HR/payroll are explicitly out of scope unless a school forces the question. Everything in this roadmap should be read against that positioning — scope creep toward "manage the whole school" is a deliberate no.

### 🎯 Target: onboard the first real school by **end of November 2026**

Every session works toward that date. Rough intent:
- **Now → build features that don't depend on live Monnify or live messaging** (both are deferred but tracked below).
- **Auth & onboarding come LAST** — no 2FA / friction while testing/logging in daily.
- **Before launch:** fresh DB rebuild, UI rebuild, docs + help center, go-live hardening.

Legend: `[ ]` not started · `[~]` partial/in progress · `[x]` done

---

## ✅ Shipped & verified

- [x] Student management — CRUD, status lifecycle (active/withdrawn/graduated), family info, activity timeline
- [x] CSV student import (batched, with progress)
- [x] Academic structure — classes, sections, sessions, class→next-class promotion map
- [x] Fee setup — fee structure by class, fee groups, required/optional items, opt-ins, exemptions
- [x] Billing cycles / terms (create, roll-forward fee items)
- [x] Invoice generation (per cycle, idempotent, previous-balance carry-forward)
- [x] Invoice PDFs (invoice + cycle batch)
- [x] Payments via Monnify DVA (virtual accounts) — single + bulk provisioning, webhook processing *(sandbox)*
- [x] Discounts — staff / sibling / scholarship-bursary, request→approve workflow, recurring carry-forward, revoke
- [x] Messaging — Sendchamp/Termii SMS + Brevo email (REST API), multi-channel fallback, delivery logging *(mock/sandbox)*
- [x] Automatic reminders (advance / due / overdue) + manual reminder send
- [x] Payment receipts (SMS + email with PDF)
- [x] Dashboard — collection KPIs, collection-by-class chart, recent activity
- [x] Year-end rollover wizard — close term, promote students, graduate exit years, resumable, no-double-run
- [x] Reconciliation (backend cron job — no UI yet)
- [x] Vercel deploy fixed — lockfile pinned to public npm registry (+ pre-commit guard)

---

## 🧱 Pre-production rebuild (foundational — do before launch, some can start early)

The app has evolved a lot; the foundations need a clean pass before onboarding real data.

- [ ] **Rewrite the database from scratch** — one clean, authoritative schema with every table we use or will need, correct types, constraints, and indexes. Consolidates all the incremental ALTERs.
- [ ] **Rebuild / restore RLS policies** — RLS rules were dropped/changed during development; rebuild the full multi-tenant row-level security so every table is properly school-scoped. *(security-critical)*
- [ ] **Fresh DB start** — stand up the new schema clean and drop all dev/test data.
- [ ] **Full UI rebuild** — redesign the interface to a consistent, standard quality bar (aiming for "next Lovable" polish).
- [ ] **Standalone pages** — some workflows should be their own dedicated pages (deep-linkable, usable directly) even if they also appear embedded elsewhere. *(list specific pages here as we decide them)*

---

## 🚧 V1 gaps — needed before onboarding a real school

Core to running a school's fees. Prioritized for the "no Monnify / no messaging needed" phase where possible.

- [ ] **Optional manual payment entry — per-school toggle, OFF by default** — The product deliberately does NOT build around cash. Core model: handle a school's full cash inflow **autonomously** via DVA/transfers, to avoid missing-money situations. A school may *request* to accept other forms (cash, POS); only then does the owner enable a per-account toggle **(via the admin dashboard)**, and only after the school signs a liability agreement acknowledging they accept and are responsible for non-transfer payments. *Depends on the owner/admin dashboard + per-school feature toggles.*
- [ ] **Reporting & analytics page** — see the dedicated section below
- [ ] **Refunds / credits workflow** — currently only a "review for possible refund" warning; no actual refund path
- [ ] **Reconciliation UI** — surface the backend reconcile job; let a bursar review/match/resolve payments
- [x] **Users & team management** — invite staff via emailed set-password link (`/settings/users`), reassign roles, deactivate/reactivate logins, resend invite. *(built alongside roles below; pending user test before ship)*
  - [ ] **Sync sign-in time from Supabase** — Users table shows "Never signed in" (and a stray "Resend invite") because nothing writes `public.users.last_login_at`. Fix by reading `auth.users.last_sign_in_at` (service-role/Admin API) instead of maintaining our own column — always accurate, no dual writes.
  - [x] **Let Supabase send invites (drop SES dependency for now)** — switched `addStaff`/`resendInvite` to `inviteUserByEmail()`; Supabase now emails the invite itself. Still hitting `otp_expired` on the resulting set-password link for reasons not yet root-caused (redirect URL + Site URL both confirmed correct) — **deferred to the proper onboarding build**; unblocked testing in the meantime by provisioning test logins directly via the Auth Admin API.
  - [ ] **Privilege escalation in Users & Roles** — `manage-team` currently lets a non-admin: (1) add a new staff member directly onto an admin role, (2) reassign an *existing* other user onto an admin role, (3) grant a non-admin role any permission (including ones the granter doesn't hold) via the roles editor. Need to pick: (A) restrict `manage-team` itself to admins only, or (B) allow delegation but enforce "can't grant more than you hold" / "can't create-or-assign an is_admin role" ceilings. Decision still pending.
- [x] **Roles & permissions** — per-school custom roles with a 15-switch catalog (SEE/DO), editable at `/settings/roles-permissions`. Live `has_permission()` check (no stale JWT); enforcement across dashboard/fees money KPIs, analytics page, reports (page + export + money columns), sidebar, and all DO server actions. Owner/super_admin/is_admin bypass. Unlocks the deferred discount-revocation approval workflow (now gated on `approve-discounts`). *(pending user test + SQL run before ship)*
  - [x] **Dashboard "Pending Approvals" KPI fixed** — was unconditionally visible to everyone and sourced from the disconnected/unused `pending_approvals` table (nothing ever inserts into it, so it always read 0). Now sourced from the real `discounts` table and gated by permission: `approve-discounts` users see the school-wide pending count (links to `/discounts`); `request-discounts`-only users see their own pending-request count instead; users with neither see nothing.
  - [x] **Persistent discount-request status + duplicate prevention** — the invoice page's "submitted" message was local React state only (vanished on refresh, didn't stop other staff double-requesting). `getInvoiceByIdForSchool` now reads the most recent pending `discounts` row for the invoice; `InvoiceDetailLayout` shows who requested it and when, and disables "Request discount" while one is pending. `requestDiscount()` server action also blocks a second pending request on the same invoice.
  - [x] **Settings pages self-check (raw-URL bypass)** — the 5 "School" settings pages (profile, academic structure, payments, reminders, discounts) only had their *save* actions gated on `manage-settings`; the pages themselves had no guard, so a restricted user hitting the URL directly (bypassing the hidden sidebar link) could still view the config. Added the same `getAuthContext()`/`redirect` self-check used by `/reports/export` to all 5. Audit log (stub) gated the same way (bundled into `manage-settings`, not a separate key). Data & privacy (stub — will export/delete a whole school's data) is deliberately hardcoded to `ctx.isOwner`, not delegable via any toggle — a different risk class from the rest of Settings. Account security (own password change) intentionally stays ungated — it only ever touches the caller's own session.
  - [x] **Permission dependency graph + full button/page hiding** — closed a batch of hierarchy holes: a role could hold `import-students` without `manage-students` (bulk-create without single add/edit), `approve-discounts` without `see-discounts` (dead end — the only approve/reject UI lives behind `see-discounts`), or `run-year-end` without the fee-structure/student-management permissions it bundles. Added `PERMISSION_DEPENDENCIES` in `permissionCatalog.ts` (`import-students→manage-students`, `manage-students→see-students`, `see-analytics→see-financial-totals`, `approve-discounts→see-discounts`, `run-year-end→manage-fee-structure,manage-students`) with a transitive closure applied both at read-time (self-healing for any role saved before this shipped) and write-time (stored JSONB stays consistent); the role editor cascades dependencies on/dependents off live and shows an "Also turns on: …" caption. `see-financial-totals` and `see-analytics` stay separate toggles (a school can grant totals without the full analytics page) but analytics now requires totals. Separately, closed the "user sees a button/link for something they don't have permission to do, then it fails on click" gap app-wide: page-level guards added to `/fees/structure`, `/fees/cycles`, `/fees/cycles/[id]`, `/fees/year-end`, `/students`, `/students/[id]`, `/invoices`, `/invoices/[id]`; `/settings`'s existing `manage-settings` redirect retargeted from `/dashboard` to `/settings/account-security` (previously bounced a non-settings user away from changing their own password); Sidebar/fees-hub nav cards and links hidden per-permission (Academic structure, Fee structure, Billing cycles, Year-end rollover, Invoices); mutation buttons hidden (not just disabled) in `StudentSettingsTab`, `SendReminderButton`, `HeaderVirtualAccount`'s create-account action, `ApplyDiscountButton` (separate `request-discounts`/`approve-discounts` gates), and `InvoiceDetailLayout`'s send/resend + request-discount actions. `record-payments` remains a defined-but-unenforced permission — flagged, not addressed here (no manual payment-recording UI exists anywhere yet to gate).
- [ ] **Bank-transfer payment details on invoices** — currently "coming soon" on invoice + PDF

---

## 📊 Reporting, analytics & data (a headline V1 feature)

The kind of useful information schools actually want to see and take away. **Distinction:**
*Reports* = files a school downloads (CSV/Excel — e.g. an audit/export they keep).
*Analytics/insights* = the in-app payments/insights views below.

- [~] **Payments / analytics page** — dedicated in-app view for financial insights *(built out: `/payments`, DB-side aggregation via `db/analytics_functions.sql`)*:
  - [x] **Client-side dashboard architecture** — one fetch of small per-cycle series (`getAnalyticsBundle`, 4 RPCs), then ALL scoping/aggregation/comparison happens in the browser (`src/lib/analytics/aggregate.ts`) with zero round-trips. Scales to unlimited history — selection is instant. Replaces the old scope-selector / searchParams / per-selection re-render model
  - [x] **Explore mode — stock-market timeline hero** — a full-history line chart (billed/collected/outstanding) with a drag-to-zoom **brush** + presets (This term / This session / Last 12 months / All). The brushed window drives every card below; hover any term for its figures (`TimelineHero`)
  - [x] **Period-over-period deltas** — KPI tiles show ▲/▼ % vs a smart baseline: a single-term selection compares to the same term a year earlier, a whole-session selection to the prior session
  - [x] **Compare mode — searchable multi-select (up to 5)** — type-to-filter picker over terms or sessions (handles 20+ periods), pick up to 5 → grouped billed-vs-collected bars, collection-rate bars, and a side-by-side table with ▲/▼ vs the first pick (`PeriodPicker`, `CompareBars`/`CompareRates`)
  - [x] **Compare overlay line** — alongside the bars: comparing whole sessions overlays each as a line vs term position (1st/2nd/3rd term) so years line up term-by-term ("compare years against themselves"); comparing individual terms is a single chronological line. Billed/Collected metric toggle (`CompareOverlay`). In compare mode the overlay sits above the bars, with the side-by-side table below
  - [x] **Fee price over time (the "fan")** — pick a fee → its price plotted per class across terms, so you can watch e.g. Tuition climb year on year with inflation. Handles fees that vary by class (a per-class fee fans into a line per class; a single school-wide price collapses to one "All classes" line). Needs `analytics_fee_class_series` (added to `db/analytics_functions.sql`); degrades to an empty state if not yet installed (`FeePriceChart`, `feeChoices`/`feePriceFan`)
  - [x] **Revenue by opt-in / fee** — per optional & required fee: students billed, billed, collected (est.), outstanding, rate
  - [x] **Outstanding / collection by class**
  - [x] **Discount waterfall** — Potential → −Discounts → Billed → −Outstanding → Collected, with foregone-to-discounts callout
  - [x] **Revenue mix** (share of collected by fee), **opt-in uptake** (adoption %), **collected-vs-outstanding per fee**
  - [x] **Discount impact by category** — chart + detail table (scoped)
  - [x] **Revenue by fee over time** — multi-line chart, one coloured line per fee by default (compare what each brings in); focus a single fee to see its billed vs collected
  - [ ] Drill-down from a fee/class to the underlying students
  - [x] **Seed data for testing** — `db/seed_analytics.sql` builds an isolated demo school (4 sessions × 3 terms + a summer coaching period, 40 students, invoices/payments/discounts) so the scope toggles can actually be exercised
  - [ ] **Consolidate the dashboard onto the same RPCs** — the dashboard's collection-by-class is `analytics_class_series`; point it at the RPC and delete the duplicate JS (faster + consistent). *Not urgent — dashboard works today.*
- [ ] **Categorized activity / history page** — a browsable, filterable feed of the events we notify on (invoices sent, payments received, receipts, reminders, discounts, etc.), searchable by activity type and by student — so a school can find "what happened around X / this student." *This is also where rolling time-windows live (last 30 days / last N months) — analytics stays term/session-based; operational "what landed recently" belongs here.* *(next, after analytics)*
- [x] **Downloadable reports / data export** — `/reports` page: a compact card per report (six exports — debtors/outstanding, collections, per-class summary, invoices, discounts, student directory), each with its own scope control (single term / whole session / all history; date range for collections; status for the directory). Every download is logged (who / what / scope / rows / when) and shown as a filterable "Download history" audit trail on the same page. UTF-8 BOM so Excel renders ₦ and accented names. Route: `src/app/(app)/reports/export/route.ts`; builders + history: `src/lib/reports/reports.ts`; audit table: `db/report_downloads.sql`. *(Reports page is also the future home for audit log + activity history.)* "It's their data — they can have it."
- [ ] **Incoming-payment feed** — chronological view of payments as they land

---

## ⚡ Scale & reliability

For schools of 500–1,000+ students on Vercel serverless. (No Monnify/messaging dependency — safe to build now.)

- [ ] **Chunked / background invoice generation** with progress — replace the sequential per-student loop that will time out at ~1,000 students
- [ ] **Chunked / background year-end promotion** with progress
- [ ] **`maxDuration` route config** on the heavy pages (year-end, cycles, invoice generation)
- [ ] **Server-side pagination** on the Students page (currently loads all students + a big `.in()` lookup; sluggish at 400+)
- [ ] **Fix N+1** in `computeInvoiceForStudent` (batch the per-student queries)

---

## 🏢 Platform / owner (multi-tenant) — your admin side

No owner-facing product surface exists yet. Schools are created directly in the DB; signup makes everyone a `super_admin`.

- [ ] **School onboarding / creation flow** — create a new school tenant from the app (no `.from('schools').insert` exists anywhere today). ⚠️ When built, it MUST seed the two default roles (Administrator + Bursar) for the new school — see the seed block in `db/roles_permissions.sql` — or the school starts with no assignable roles.
- [ ] **Per-school feature toggles** — e.g. enable optional manual/cash/POS payment entry per account (only after a signed liability agreement); store the agreement/consent record
- [x] **Remove public signup** — `/signup` is now disabled (middleware redirects it to `/login`; the "Get started" link is gone). The owner provisions schools/users; staff are added in-app via Settings → Users. *(the `/signup` page file still exists but is unreachable — delete after test)*
- [ ] **Tenant directory** — list/manage all schools (the owner's dashboard)
- [ ] **Impersonation / school switcher** — owner views a specific school
- [ ] **Billing / subscription per tenant** — plans, invoicing the schools themselves
- [ ] **Usage / metering dashboard** — students, SMS volume, storage per tenant

---

## ⏳ Deferred but tracked (waiting on external setup — not now)

- [ ] **Move Monnify to LIVE** — swap sandbox → production credentials so we can test real payments end-to-end
- [~] **SMS provider switch: Termii → Sendchamp** — Sendchamp Sender ID approved; new adapter (`src/lib/messaging/sendchamp.ts`) built and wired in via `SMS_PROVIDER` env var (default `sendchamp`, set to `termii` to roll back). Termii's adapter (`termii.ts`) and its webhook route are left in place untouched, not deleted, as the rollback path. Webhook receiver added at `api/webhooks/sendchamp` — verifies via a shared-secret query param (`SENDCHAMP_WEBHOOK_SECRET`) since Sendchamp's docs don't document an HMAC signature scheme like Termii's. Needed before switching a school over: set `SENDCHAMP_API_KEY`, `SENDCHAMP_SENDER_ID`, `SENDCHAMP_MODE=mock|live`, `SENDCHAMP_WEBHOOK_SECRET` in `.env.local`; test in mock mode, then one real live send, then register the webhook URL in Sendchamp's dashboard before flipping any school's traffic over. Not yet tested end-to-end — do that before removing Termii from the default path for good.
- [~] **Email: Amazon SES → Brevo REST API** — SES retired (never went live), Brevo is now the only email provider, sending via their REST API (`src/lib/messaging/brevo.ts`, `BREVO_API_KEY`) instead of the SMTP relay/nodemailer, so sends return a real `messageId` for delivery tracking. Webhook receiver added at `api/webhooks/brevo` — same shared-secret-query-param pattern as Sendchamp (`BREVO_WEBHOOK_SECRET`), since Brevo doesn't sign payloads either. **Before/after going live on `main`, confirm all three provider dashboards point at the correct deployed webhook URL**: Termii (`api/webhooks/termii`, HMAC-signed), Sendchamp (`api/webhooks/sendchamp?secret=...`), Brevo (`api/webhooks/brevo?secret=...`) — easy for one to get missed or left pointing at a stale/dev URL during a redeploy or domain change. Not yet tested end-to-end with a real live send.
- [ ] **Admin dashboard for message delivery status** — no UI yet reads `message_logs`/delivery status (only the dev-only `/simulator` page touches that table). Once Brevo's webhook is live, worth a page so an admin can check "did this parent's invoice email actually deliver?" without querying the DB by hand.
- [ ] **WhatsApp channel** — rebuild messaging channel (evaluating SendChamp)

---

## 🔐 Auth & onboarding (LAST — deliberately deferred)

Kept until near launch so login friction doesn't slow daily testing.

- [ ] **2FA** — sign-in second factor
- [ ] **Active sessions / device management** — see & revoke other sessions
- [ ] **Full sign-up / login / onboarding polish**

---

## 🔒 Security & go-live hardening

- [ ] **Dependabot: 22 vulnerabilities (14 high, 8 moderate)** — triage & patch
- [ ] **Credential rotation** — rotate all keys before production
- [ ] **Sandbox → production swaps** — Monnify (+ any other) sandbox → live
- [ ] **Remove dev tooling from production** — `/simulator`, `api/dev/provision-dva`, `api/dev/simulate-payment`
- [ ] **DB test-data cleanup** — clear seeded test school/students (folds into the fresh DB rebuild above)
- [ ] **Audit log UI** — user-facing audit trail (`/settings/audit-log` is a stub)
- [ ] **Data & privacy** — export/delete a school's data (`/settings/data-privacy` is a stub)

---

## 📣 Business & launch readiness (look like a legit business)

"We can be the next Lovable — just have to be standard."

- [ ] **Documentation** — proper product docs (replace default create-next-app README too)
- [ ] **Help / support center** — in-product page with step-by-step guides for common tasks
- [ ] **Tutorial videos** — YouTube walkthroughs of key workflows (later)
- [x] **Marketing landing page** — lives externally at **fees101.com**. The in-app root `/` "coming soon" is an *intentional guard* for anyone who hits the app URL directly; the real app starts at `/dashboard` when logged in. *(No in-app landing page needed.)*
- [ ] **Trust/legitimacy basics** — contact, pricing, terms/privacy, "about" (mostly handled by fees101.com; confirm coverage)

---

## 🎨 Product polish / coming-soon placeholders

Visible "coming soon" text currently in the UI.

- [ ] **Fees overview "Recent activity"** section (placeholder on `/fees`)
- [ ] **Dashboard redesign for restricted roles** — today `/dashboard`'s KPI tiles and collection chart all key off `see-financial-totals`/discount permissions, so a role with neither (e.g. `manage-students`-only) lands on a near-empty page: just the greeting and a full-width Recent Activity feed. Needs role-relevant fallback content (e.g. student counts for `manage-students`, a Reports shortcut for `see-reports`) so every role sees a dashboard that reflects what they can actually do, not just what's hidden.
- [ ] **Paystack** payment provider — add as a second provider alongside Monnify (full payment system already built, so this is a second adapter, not a rebuild). Test sandbox first, then go live. **Sequencing: start only after Roles & Permissions and Users are fully complete and confirmed.** Trigger: Paystack account verification came through well before Monnify's despite applying to Monnify much earlier.

---

## 🌱 Future / bigger bets (post-V1)

- [ ] **Parent-facing portal** — parent login to view invoices, balances, pay
- [ ] **Per-student one-off charges** — fines, replacement books, individual exam/late fees as ad-hoc invoice lines. *Deferred: build only if a school asks. Workaround for now = add an optional fee (e.g. "Damages") and leave a note.*
- [ ] **Installment / part-payment plans** — structured "pay in N" schedules (partial payment already works; formal plans deferred until a school needs them)
- [ ] **Automatic late fees** — penalty added when an invoice goes overdue (deferred until requested)
- [ ] **Standalone Payments operations page** — feed, unapplied credits, manual entry, "reconcile now" (overlaps with reporting/analytics above)
- [ ] **Collection-by-class operations page** — drill-down stats (separate from Settings academic structure)
- [ ] **Per-school custom email templates** — Brevo (unlike SES) supports designer/saved templates per sender, so a school could eventually customize wording/branding of their own invoice/receipt/reminder emails beyond just the logo. Deferred until a school actually asks for it.
- [ ] **Per-message channel selection UI** — a "Messages" tab where staff pick a message type (invoice/receipt/reminder) for a student and explicitly choose SMS, email, or both, instead of relying on the default policy. Useful if a parent complains they're not receiving one channel. The channel-override plumbing (`channelOverride` on `sendInvoice`, `sendManualReminder`) already exists per-invoice; this would surface it as its own dedicated page/tab rather than a one-off resend button.

---

## Notes

- Guiding principle: **configuration lives in Settings; day-to-day operations get their own top-level pages.**
- No undo on year-end rollover (by design — type-to-confirm gate).
- Invoices are intentionally NOT auto-generated on promotion — schools generate when ready.
