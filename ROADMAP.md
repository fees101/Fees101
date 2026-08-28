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
- [x] **Bank-transfer payment details on invoices** — shipped on both the invoice screen (`InvoiceDetailLayout`) and the PDF (`InvoicePDF`): shows the student's DVA account number + bank name, with "use the admission number as payment reference" and a "No virtual account yet" fallback when the student has no DVA. Gated on `invoice.dvaAccountNumber`.

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
- [x] **Categorized activity / history page** — a browsable, filterable feed of the events we notify on (invoices sent/generated, payments received, receipts, reminders, messages, the discount lifecycle, students added), searchable by activity type and by student — so a school can find "what happened around X / this student." Rolling time-windows (last 30 days / 3 / 12 months + custom range) live here; analytics stays term/session-based. Built on a `security_invoker` Postgres view (`db/activity_feed_view.sql`) that unions the domain tables and resolves names at query time (never raw IDs) — deliberately NOT the audit_log, so system/parent-driven events (webhook payments, automated reminders) show too. Route: `src/app/(app)/activity/page.tsx`; query `src/lib/queries/activity.ts`; feed `src/components/activity/ActivityFeed.tsx` (colour-coded table by category); gated by new `see-activity` permission; dashboard "View full activity →" wired through. Demo data via `scripts/seed-activity.mjs`. *(Built & browser-tested.)*
- [x] **Downloadable reports / data export** — `/reports` page: a compact card per report (six exports — debtors/outstanding, collections, per-class summary, invoices, discounts, student directory), each with its own scope control (single term / whole session / all history; date range for collections; status for the directory). Every download is logged (who / what / scope / rows / when) and shown as a filterable "Download history" audit trail on the same page. UTF-8 BOM so Excel renders ₦ and accented names. Route: `src/app/(app)/reports/export/route.ts`; builders + history: `src/lib/reports/reports.ts`; audit table: `db/report_downloads.sql`. *(Reports page is also the future home for audit log + activity history.)* "It's their data — they can have it."
- [ ] **Incoming-payment feed** — chronological view of payments as they land

---

## ⚡ Scale & reliability

For schools of 500–1,000+ students on Vercel serverless. (No Monnify/messaging dependency — safe to build now.)
Still just Next.js + Supabase + Vercel throughout — no new infra needed. "Background job" here means: a
status/progress row in Supabase that the client polls, work picked up by a Vercel Cron-triggered route (or
simply a higher `maxDuration` on the route), not a separate server.

- [~] **Auth round-trip latency (per-click slowness)** — **partially fixed.** Every navigation used to make 4 sequential Supabase round-trips before page data: middleware `auth.getUser()` (network) + an `is_active` DB lookup, then `getAuthContext()` `auth.getUser()` **again** + a user/roles lookup. Done: (1) removed the redundant middleware `is_active` lookup (`getAuthContext` + `has_permission()` still enforce it); (2) both `auth.getUser()` → `auth.getClaims()` (local JWT verification once a session's token is ECC-signed). Project already uses **asymmetric ECC (P-256) signing keys** (legacy HS256 kept only as a previous key), so `getClaims` verifies locally — EXCEPT for sessions still carrying an older HS256 token, which fall back to a network `getUser` until the token refreshes/re-login. Region is confirmed optimal: Supabase `eu-central-1` (Frankfurt) == Vercel `fra1`, so prod round-trips are ~1–5ms; the ~800ms–1.1s seen in local dev is the corporate Zscaler proxy on the dev machine only, NOT representative of Vercel. Remaining: verify real timings on a Vercel deploy (non-Zscaler).
- [ ] **Scale-up: compute tier + connection pooling** — DB is currently `t4g.nano` running ~57% compute / 56% RAM with 1 school of data; fine now, but 100 schools needs a bigger compute add-on AND routing serverless (Vercel) DB traffic through the Supabase **connection pooler** (pgBouncer / transaction mode) rather than direct connections, or the 60-connection ceiling gets exhausted under concurrent serverless invocations. Revisit before onboarding beyond a handful of schools.
- [ ] **`generateInvoicesForCycle` / `regenerateStaleInvoicesForCycle`** (`fees/cycles/actions.ts`) — **highest priority.** Loop over *every* active student/invoice in a cycle inside one request with zero batching or checkpointing (unlike the items below, which already batch). Biggest timeout risk in the app today. Fix: same batch-with-checkpoint pattern as year-end rollover, or raise `maxDuration` + add simple internal batching.
- [ ] **Year-end rollover** — already has checkpoint/resume infra (`rollover_runs`/`rollover_promotions`, a `step` state machine) to *recover* after a timeout, but the happy path still runs as one giant call. Upgrade: drive the state machine step-by-step via a Cron-triggered route with the client polling `getRolloverStatus`, so a timeout can't happen at all instead of just being recoverable from.
- [ ] **CSV student import** — client already chunks rows into batches of 50 and loops calls to `importStudents` for the progress bar; works, but a page-nav/tab-close mid-import silently stops future batches. Upgrade: move the batch loop server-side (queue + status row), client just polls.
- [ ] **Bulk DVA creation** (`createDVAsForAllStudents`) — same shape as CSV import (client loops in batches of 25, up to 400 iterations); bottleneck is per-student calls to the payment provider. Background job would also let failures auto-retry instead of surfacing in the admin's browser tab.
- [ ] **Bulk invoice sending** (`bulkSendInvoices`) — already the most defensive: batches of ≤50 + a 250ms per-send stagger to avoid slamming SMTP. Lower priority; a queue would mainly let the artificial stagger go away (parallel dispatch) and survive tab-close.
- [ ] **`maxDuration` route config** on the heavy pages (year-end, cycles, invoice generation)
- [ ] **Server-side pagination** on the Students page (currently loads all students + a big `.in()` lookup; sluggish at 400+) — deliberately NOT applied to the audit log, which already paginates server-side (`getAuditLog` via Supabase `.range()`) since that log is permanent/unbounded, unlike the bounded per-school student list.
- [ ] **Fix N+1** in `computeInvoiceForStudent` (batch the per-student queries)

---

## 🏢 Platform / owner (multi-tenant) — your admin side

No owner-facing product surface exists yet. Schools are created directly in the DB; signup makes everyone a `super_admin`.

- [ ] **School onboarding / creation flow** — create a new school tenant from the app (no `.from('schools').insert` exists anywhere today). ⚠️ When built, it MUST seed the two default roles (Administrator + Bursar) for the new school — see the seed block in `db/roles_permissions.sql` — or the school starts with no assignable roles.
- [ ] **Per-school feature toggles** — e.g. enable optional manual/cash/POS payment entry **and school-side self-reconciliation** per account (only after the school *requests* it and signs a liability agreement — it's explicitly at the school's own risk, off by default; Fees101 flips the toggle, the school can't self-serve). Store the agreement/consent record. The toggle gates both the manual-entry UI and the reconciliation UI (line 69) for that school; unlocks the `record-payments` permission that currently has no UI to gate.
- [x] **Remove public signup** — `/signup` is now disabled (middleware redirects it to `/login`; the "Get started" link is gone). The owner provisions schools/users; staff are added in-app via Settings → Users. *(the `/signup` page file still exists but is unreachable — delete after test)*
- [ ] **Tenant directory** — list/manage all schools (the owner's dashboard)
- [ ] **Impersonation / school switcher** — owner views a specific school
- [ ] **Restore / cancel a pending school deletion (grace-window recovery)** — when a school that requested account deletion (see Data & privacy, line 175) changes its mind and comes back, Fees101 cancels the scheduled deletion from the admin dashboard, reactivating the school and its staff logins — as long as it's still within the 30-day grace window (before the purge cron runs). The school does NOT self-cancel; recovery is admin-side. Until this dashboard exists, the interim cancel path is a secret-protected admin route / manual DB update on `school_deletion_requests`.
- [ ] **Billing / subscription per tenant** — plans, invoicing the schools themselves
- [ ] **Usage / metering dashboard** — students, SMS volume, storage per tenant
- [ ] **Internal (Fees101-side) users & permissions — v2** — the admin dashboard needs its own staff accounts with their own role/permission model, *separate* from the per-school roles (line 74). Not every internal person should be able to do everything — especially sensitive, cross-tenant actions: deactivating/impersonating a school, flipping the manual-payment/self-reconcile toggle (line 136), touching billing, or changing another user's account. Needs a deliberate catalog of internal permissions (who can change accounts, who can only view, who can toggle risky features) before this ships. Deferred to v2 — after the per-school roles/permissions work is fully done and tested.

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
- [ ] **Logout is broken** — `POST /logout` calls `supabase.auth.signOut()` then `redirect('/login')`, but the `redirect()` throws before the cleared auth cookies are flushed to the response, so the session cookie survives and the user stays signed in (root cause of "the same user profile is always logged in / I can't switch users"). Fix: return a normal response (e.g. `NextResponse.json`/`new Response`) so the cleared `Set-Cookie` headers reach the browser — the client `UserMenu.handleLogout` already does `window.location.href='/login'` after the fetch, so the route doesn't need `redirect()` at all. Small, self-contained fix.
- [ ] **Active sessions / device management** — see & revoke other sessions. Also handle the multi-device / concurrent-login case properly: multiple distinct staff accounts should each stay logged in on their own devices simultaneously (Supabase supports this per-refresh-token by default), and one account signing out on one device shouldn't affect another. Verify once logout is fixed.
- [ ] **Full sign-up / login / onboarding polish**

---

## 🔒 Security & go-live hardening

- [ ] **Dependabot: 22 vulnerabilities (14 high, 8 moderate)** — triage & patch
- [ ] **Credential rotation** — rotate all keys before production
- [ ] **Sandbox → production swaps** — Monnify (+ any other) sandbox → live
- [ ] **Remove dev tooling from production** — `/simulator`, `api/dev/provision-dva`, `api/dev/simulate-payment`
- [ ] **DB test-data cleanup** — clear seeded test school/students (folds into the fresh DB rebuild above)
- [ ] **Audit log UI** — user-facing audit trail (`/settings/audit-log` is a stub)
- [x] **Data & privacy** (`/settings/data-privacy`, owner-only) — **Phase 1 built & tested:** transparency sections (live "what we store" inventory counts, sub-processor list, security summary, retention statement), one-click **"download all my data"** as a dependency-free `.zip` of per-table CSVs (`src/lib/dataPrivacy/`, `src/lib/reports/zip.ts`, export route at `settings/data-privacy/export`), plus contact + policy links (`fees101.com/privacy` + `/terms`, confirmed live). **Phase 2 built & TESTED end-to-end (2026-08-27, pushed):** scheduled account-deletion flow. Owner opens the "Close account & delete data" dialog (export-first prompt + required acknowledge checkbox + type-school-name confirm) → `requestAccountDeletion` writes a `school_deletion_requests` row (status `scheduled`, `scheduled_for` = now+30d, `financial_purge_at` = now+6y), deactivates every staff login immediately, logs `account.deletion_scheduled`, and signs the owner out. Login/kick-out now distinguishes a self-closed account (dated "scheduled for deletion — contact support" message, `?error=scheduled_deletion`) from an admin deactivation. Daily cron `/api/admin/purge-deletions` (CRON_SECRET / `PURGE_SECRET`, 03:15) runs `archive_and_delete_school()` past the grace window (archives anonymised financials — no names/free-text — into `archived_financials`, then FK-ordered hard-delete of all school-scoped rows + the school, then deletes auth users), and `purge_expired_financials()` drops archived rows past 6y. Reminders cron skips schools with a scheduled deletion. Purge executor verified against a throwaway school via `scripts/test-purge.mjs` (all rows gone + auth user 404s + 2 anonymised rows archived + request→completed). **Go-live setup:** re-run `db/data_privacy.sql` in the prod Supabase project; generate `CRON_SECRET` (required) + `PURGE_SECRET` (optional) in Vercel env. Files: `db/data_privacy.sql`, `src/lib/dataPrivacy/{deletion,config}.ts`, `settings/data-privacy/actions.ts`, `components/settings/DeleteAccountSection.tsx`, `api/admin/purge-deletions/route.ts`. Restore/cancel during grace is admin-side (line 140).

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
- [x] **Paystack** payment provider — added as a second provider alongside Monnify (second adapter, not a rebuild). **Built + pushed to `dev` (commit 870dfa1, 2026-08-28)** and verified end-to-end in the local sandbox: credentials authenticate, DVA provisioning creates a real Paystack account, payment application → invoice paid → receipt SMS+email, and the full webhook handler passes signed synthetic tests (valid→applied, tampered→401, duplicate→blocked, non-charge→ignored, unknown customer→no match). Deployed preview webhook endpoint confirmed reachable + signature-verifying. **Only live-only leg left (deferred by choice): put live creds in Vercel + make a real transfer to confirm Paystack actually delivers the webhook and money moves.** CRITICAL: Vercel `PAYMENT_KEYS_ENCRYPTION_SECRET` must match the value that encrypted the stored creds.

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
