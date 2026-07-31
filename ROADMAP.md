# Fees101 — Roadmap & Build Checklist

> Living document. This is the single source of truth for what we've built, what's
> stubbed, and what's still needed. Check items off (`- [x]`) as they ship. Add,
> edit, or remove freely — this file is meant to be edited by hand.
>
> Last reviewed against the codebase: **2026-07-31**

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
- [x] Payments via Monnify DVA (virtual accounts) — single + bulk provisioning, webhook processing
- [x] Discounts — staff / sibling / scholarship-bursary, request→approve workflow, recurring carry-forward, revoke
- [x] Messaging — Termii SMS + Amazon SES email, multi-channel fallback, delivery logging
- [x] Automatic reminders (advance / due / overdue) + manual reminder send
- [x] Payment receipts (SMS + email with PDF)
- [x] Dashboard — collection KPIs, collection-by-class chart, recent activity
- [x] Year-end rollover wizard — close term, promote students, graduate exit years, resumable, no-double-run
- [x] Reconciliation (backend cron job — no UI yet)
- [x] Vercel deploy fixed — lockfile pinned to public npm registry (+ pre-commit guard)

---

## 🚧 V1 gaps — needed before onboarding a real school

These are core to running a school's fees, not optional polish.

- [ ] **Manual payment entry** — record cash / offline / direct bank-transfer payments against an invoice. Today payments only apply via Monnify webhooks. *(highest priority — real schools take cash)*
- [ ] **Users & team management** — invite staff, create logins (`/settings/users` is a stub)
- [ ] **Roles & permissions** — real `bursar` vs `school_admin` vs owner enforcement; approval gates for discounts/refunds (`/settings/roles-permissions` is a stub). Unlocks the deferred discount-revocation approval workflow.
- [ ] **Refunds / credits workflow** — currently only a "review for possible refund" warning; no actual refund path
- [ ] **Reconciliation UI** — surface the backend reconcile job; let a bursar review/match/resolve payments
- [ ] **Data export / reports** — downloadable CSV/PDF reports (collections, outstanding, per-class, per-student). Import exists; export doesn't.
- [ ] **Bank-transfer payment details on invoices** — currently "coming soon" on invoice + PDF

---

## 🏢 Platform / owner (multi-tenant) — your admin side

Right now there is **no** owner-facing product surface. Schools are created directly in the DB and signup makes everyone a `super_admin`.

- [ ] **School onboarding / creation flow** — create a new school tenant from the app (no `.from('schools').insert` exists anywhere today)
- [ ] **Fix signup role model** — signup currently sets every new user to `super_admin` with `school_id: null`; needs a real owner vs school-admin distinction
- [ ] **Tenant directory** — list/manage all schools (the owner's dashboard)
- [ ] **Impersonation / school switcher** — owner views a specific school
- [ ] **Billing / subscription per tenant** — plans, invoicing the schools themselves
- [ ] **Usage / metering dashboard** — students, SMS volume, storage per tenant

---

## ⚡ Scale & reliability (chosen next track)

For schools of 500–1,000+ students on Vercel serverless.

- [ ] **Chunked / background invoice generation** with progress — replace the sequential per-student loop that will time out at ~1,000 students
- [ ] **Chunked / background year-end promotion** with progress
- [ ] **`maxDuration` route config** on the heavy pages (year-end, cycles, invoice generation)
- [ ] **Server-side pagination** on the Students page (currently loads all students + a big `.in()` lookup; sluggish at 400+)
- [ ] **Fix N+1** in `computeInvoiceForStudent` (batch the per-student queries)

---

## 🔒 Security & go-live hardening

- [ ] **Dependabot: 22 vulnerabilities (14 high, 8 moderate)** — triage & patch
- [ ] **Credential rotation** — rotate all keys before production
- [ ] **Sandbox → production swaps** — Monnify (and any other) sandbox credentials → live
- [ ] **Remove dev tooling from production** — `/simulator`, `api/dev/provision-dva`, `api/dev/simulate-payment`
- [ ] **DB test-data cleanup** — clear seeded test school/students at first real onboarding
- [ ] **2FA** — sign-in second factor (`AccountSecurityForm` marks it coming soon)
- [ ] **Active sessions / device management** — see & revoke other sessions (coming soon)
- [ ] **Audit log UI** — user-facing audit trail (`/settings/audit-log` is a stub)
- [ ] **Data & privacy** — export/delete a school's data (`/settings/data-privacy` is a stub)

---

## 🎨 Product polish / coming-soon placeholders

Visible "coming soon" text currently in the UI.

- [ ] **Marketing landing page** — root `/` is literally `<h1>Fees101</h1><p>Coming soon.</p>`
- [ ] **Fees overview "Recent activity"** section (placeholder on `/fees`)
- [ ] **Paystack** payment provider (disabled option — only Monnify implemented)
- [ ] **README** — replace default create-next-app boilerplate with real project docs

---

## 🌱 Future / bigger bets (post-V1)

- [ ] **Parent-facing portal** — parent login to view invoices, balances, pay
- [ ] **WhatsApp channel** — rebuild against SendChamp (previously removed)
- [ ] **Standalone Payments operations page** — incoming-payment feed, unapplied credits, manual entry, "reconcile now"
- [ ] **Collection-by-class operations page** — drill-down stats (separate from Settings academic structure)

---

## Notes

- Guiding principle: **configuration lives in Settings; day-to-day operations get their own top-level pages.**
- No undo on year-end rollover (by design — type-to-confirm gate).
- Invoices are intentionally NOT auto-generated on promotion — schools generate when ready.
