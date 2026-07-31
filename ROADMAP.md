# Fees101 — Roadmap & Build Checklist

> Living document. Single source of truth for what we've built, what's stubbed,
> and what's still needed. Check items off (`- [x]`) as they ship. Add, edit, or
> remove freely — this file is meant to be edited by hand.
>
> **Working rule:** whenever an enhancement, idea, or "we should do X later" comes
> up in any working session, it gets added here immediately so nothing is lost.
>
> Last reviewed against the codebase: **2026-07-31**

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
- [x] Messaging — Termii SMS + Amazon SES email, multi-channel fallback, delivery logging *(mock/sandbox)*
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
- [ ] **Users & team management** — invite staff, create logins (`/settings/users` is a stub) *(auth-adjacent — sequence with roles)*
- [ ] **Roles & permissions** — real `bursar` vs `school_admin` vs owner enforcement; approval gates for discounts/refunds. Unlocks the deferred discount-revocation approval workflow.
- [ ] **Bank-transfer payment details on invoices** — currently "coming soon" on invoice + PDF

---

## 📊 Reporting, analytics & data (a headline V1 feature)

The kind of useful information schools actually want to see and take away.

- [ ] **Downloadable reports / data export** — schools can download their data (collections, outstanding, per-class, per-student, transactions) as CSV/PDF. "It's their data — they can have it."
- [ ] **Payments / analytics tab** — a dedicated view for financial insights:
  - [ ] **Revenue by opt-in** — e.g. total money coming from transport / specific optional fees
  - [ ] Collection trends over time, per term/session
  - [ ] Outstanding by class / by student
  - [ ] Discount impact (how much given away, by category)
  - [ ] Any other insights that help a school understand their money
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

- [ ] **School onboarding / creation flow** — create a new school tenant from the app (no `.from('schools').insert` exists anywhere today)
- [ ] **Per-school feature toggles** — e.g. enable optional manual/cash/POS payment entry per account (only after a signed liability agreement); store the agreement/consent record
- [ ] **Remove public signup** — "create a user" will be removed after stress testing (not needed; the owner provisions schools/users). Until then it sets every new user to `super_admin` with `school_id: null`.
- [ ] **Tenant directory** — list/manage all schools (the owner's dashboard)
- [ ] **Impersonation / school switcher** — owner views a specific school
- [ ] **Billing / subscription per tenant** — plans, invoicing the schools themselves
- [ ] **Usage / metering dashboard** — students, SMS volume, storage per tenant

---

## ⏳ Deferred but tracked (waiting on external setup — not now)

- [ ] **Move Monnify to LIVE** — swap sandbox → production credentials so we can test real payments end-to-end
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
- [ ] **Paystack** payment provider (disabled option — only Monnify implemented)

---

## 🌱 Future / bigger bets (post-V1)

- [ ] **Parent-facing portal** — parent login to view invoices, balances, pay
- [ ] **Standalone Payments operations page** — feed, unapplied credits, manual entry, "reconcile now" (overlaps with reporting/analytics above)
- [ ] **Collection-by-class operations page** — drill-down stats (separate from Settings academic structure)

---

## Notes

- Guiding principle: **configuration lives in Settings; day-to-day operations get their own top-level pages.**
- No undo on year-end rollover (by design — type-to-confirm gate).
- Invoices are intentionally NOT auto-generated on promotion — schools generate when ready.
