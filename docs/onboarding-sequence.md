# Onboarding setup sequence (dependency order)

Companion to the ROADMAP.md item "Onboarding setup sequence (dependency order)". This is the
underlying dependency map — the actual order a brand-new school's data must be entered in so a
later step never silently depends on one that was skipped. The setup-guide-mascot UI and any
self-onboarding wizard should be built *on top of* this map, not invent their own order.

This will need a fresh pass once the portal is visually redesigned — the steps and dependencies
below are about data/config order, not screen layout, so most of it should survive that redesign,
but re-check it against whatever the new flow looks like.

---

## Why order matters here

Nothing in the app currently stops a school from jumping ahead — there's no gate today that says
"add a class before you add a fee item," or "set up billing cycles before generating invoices."
Skipping a step doesn't error immediately; it fails silently or confusingly several steps later
(e.g. "Generate invoices" runs with zero fee items and produces ₦0 invoices; a student added
before any class exists can't be assigned one). The goal of this map is to give the guided
onboarding flow (and any future validation) a ground truth for what must exist before what.

---

## Phase 0 — Account & school shell (already exists, not part of this map)
Tenant creation mechanics (school row, owner user, auth) are a separate concern — see the
ROADMAP.md item directly above this one. This map starts from "a school and an owner account
exist and the owner has just logged in for the first time."

---

## Phase 1 — Academic structure
**Page:** `/settings/academic-structure` · **Permission:** `manage-academic-structure`

1. **Add classes** (`addClass`) — e.g. Creche, Nursery 1–2, Primary 1–6, JSS1–3, SS1–3. A class
   can optionally be marked as feeding into a "next class" for promotion at year-end rollover —
   worth setting this up now while every class exists, rather than backfilling later.
2. **Add sections** (`addSection`), if the school splits classes into streams (e.g. "A"/"B",
   "Gold"/"Silver"). Optional — a school with one stream per class can skip this.

**Blocks:** fee structure (per-class fee items need a class to attach to), student records (a
student needs a class to belong to), invoice generation (needs both).

**Nothing upstream of this phase** — it's the true starting point.

---

## Phase 2 — Billing cycle (term) shell
**Page:** `/fees/cycles` · **Permission:** `see-fee-structure` (create/manage needs write access)

1. **Create a session** (`createSession`) — the school year container (e.g. "2026/2027").
2. **Create a term** (`createTerm`) inside that session (e.g. "First Term") — this is the
   `billing_cycle` row everything else (fee items, invoices) hangs off. A term starts in `draft`.
3. Leave it in `draft` for now — **do not activate yet**. Activating is Phase 4, after fee
   structure and students both exist, so the first invoices generated are actually correct.

**Blocks:** fee structure (fee items belong to a specific cycle), invoice generation (needs an
active cycle).

**Depends on:** nothing from Phase 1 directly, but in practice a school names terms after classes
exist so per-class fee items (Phase 3) can be added in the same sitting.

---

## Phase 3 — Fee structure
**Page:** `/fees/structure` · **Permission:** `see-fee-structure` (write needs the manage variant)

Done against the draft term created in Phase 2, using the classes from Phase 1:

1. **School-wide required fee items** (`addFeeItem`) — apply to every student regardless of class
   (e.g. "Development Levy").
2. **Per-class fee items** (`addPerClassFeeItem`) — tuition or class-specific charges. Requires
   the target class to already exist (Phase 1) — adding one for a class that doesn't exist yet
   isn't possible from the UI, but adding the class *after* fee items exist means going back and
   re-checking every fee item's class coverage, so do Phase 1 first.
3. **Optional fee items** (`addOptionalFeeItem`) — opt-in-by-toggle items (e.g. "School bus,"
   "Lunch program"). Per the product's autonomous-cash-model decision, these default OFF; a
   student is invoiced for one only after an explicit opt-in.
4. **Fee groups**, if the school wants related items bundled for bulk opt-in/opt-out
   (`editFeeGroup`) — optional, can be done anytime after the underlying items exist.

**Blocks:** invoice generation (an invoice generated with zero fee items produces a ₦0 invoice —
not an error, just silently wrong, so this step being skipped is the single most consequential
gap for the guided flow to catch).

**Depends on:** Phase 1 (classes must exist for per-class items), Phase 2 (fee items attach to a
specific cycle).

---

## Phase 4 — Students
**Page:** `/students` (single add) or `/students/import` (CSV) · **Permission:** `see-students`

1. **Add students individually** (`addStudent`) or **bulk import via CSV**
   (`/students/import`) — each student needs a class (Phase 1) assigned at creation.
2. Confirm each student's **family/contact info** (parent phone + email) is correct at this
   stage — it's what every invoice, reminder, and receipt will be sent to later, and it's far
   cheaper to fix now than after messages have already gone out under it.
3. **Known gap to flag in the guided flow:** sibling-linking (`family_id`) is currently matched
   by exact-string phone equality with no normalization or confirmation step (tracked separately
   in ROADMAP.md as a fraud/data-integrity gap) — a school with sibling discounts configured
   should double check sibling groupings landed correctly after a bulk import, until that's fixed.

**Blocks:** invoice generation (invoices are generated per active student).

**Depends on:** Phase 1 (a class must exist to assign).

**Does not depend on:** Phase 3 — students can be added before or after fee structure, but both
must exist before Phase 5.

---

## Phase 5 — Payment provider setup
**Page:** `/settings/payments` · **Permission:** owner/manage-payments-scoped

1. **Choose and save a provider** (`savePaymentProvider`) — Monnify or Paystack, with API
   credentials.
2. **Test the connection** (`testPaymentConnection`) before relying on it.
3. **Provision DVAs** for existing students (per-student or bulk) — each student needs a virtual
   account number before autonomous bank-transfer collection works for them; a student added
   after this step needs their own DVA provisioned individually (this isn't automatic today).

**Blocks:** any real payment collection; DVA account numbers are also referenced in payment
confirmation SMS/email, so messaging (Phase 6) sending before this step means the account number
line is blank.

**Depends on:** Phase 4 (a student record must exist before a DVA can be provisioned for them).
**Does not block:** invoice generation itself — an invoice can exist and be sent before a DVA is
provisioned, but the parent then has no account number to pay into, which defeats the point. The
guided flow should treat "provider connected + DVAs provisioned" as a hard prerequisite before it
lets a school send its first real invoice, even though the app doesn't currently enforce that.

---

## Phase 6 — Messaging setup
**Page:** implicit in school settings / environment config (Sendchamp SMS + Brevo email)

1. Confirm the school's **sender name / SMS branding** is set (`getSchoolSmsName` reads school
   settings) — this is what appears as the sender on every SMS a parent receives.
2. No separate "activate messaging" step exists today; this is really just "make sure the school
   name/settings that feed into message templates are filled in," which is more naturally folded
   into Phase 1 or a school-profile step than a standalone phase — flagging it here so the guided
   flow doesn't forget it, not because it needs its own screen.

**Depends on:** none of the above technically, but has no reason to exist before Phase 4 (there's
no one to message yet).

---

## Phase 7 — Activate the term and generate invoices
**Page:** `/fees/cycles/[id]`

1. **Activate the term** (`activateTerm`) — now that classes, fee structure, and students all
   exist, this is safe to do (activating earlier just means generating incomplete/₦0 invoices).
2. **Generate invoices** (`startInvoiceGenerationJob`) — runs as a background job, one invoice per
   active student in the cycle, using the fee structure from Phase 3.
3. **Review before sending** — spot-check a few generated invoices (totals, opt-in items) before
   the bulk send.
4. **Send** — bulk "Send all," which is where messaging (Phase 6) and payment provider (Phase 5)
   both need to already be correct, since the send is the parent's first (and often only) contact
   with this system.

**Depends on:** Phases 1, 2, 3, 4 fully complete; Phases 5 and 6 should be complete first even
though the app won't stop you from generating/sending without them.

---

## Phase 8 — Roles, permissions, and users (can happen anytime, but flagged separately)
**Pages:** `/settings/users`, `/settings/roles-permissions`

Not on the critical path to the first invoice, but should happen before a second staff member
needs access — a school owner doing solo setup can defer this indefinitely, but the guided flow
should surface it once Phase 7 completes as "invite your team" rather than leaving it undiscovered
in Settings.

---

## Ongoing / recurring (not first-time setup, but part of "working through the year")

These aren't onboarding steps but are the operations a school repeats every term/session, and the
guided flow's job ends where these begin:

- **Mid-term**: opt-in/opt-out changes, discount requests/approvals, payments arriving via
  webhook, reminders (automatic + manual), regenerating an invoice after a fee correction.
- **Term close**: `previewCloseTerm` → `closeTerm`/`closeTermAndCarryForward` — carries unpaid
  balances forward onto the next term's invoice.
- **Year-end**: `startYearEndRollover` — closes the final term of a session, promotes students by
  class (using the promotion map from Phase 1), graduates exit-year students, and is resumable.
- **New term within the same session**: repeat Phase 2 (create term) → Phase 3 (fee structure,
  since fee items are per-cycle and don't automatically carry forward except via the roll-forward
  copy step, which itself has a known `is_recurring`-filter gap tracked in ROADMAP.md) → Phase 7
  (activate, generate, send). Phases 1, 4, 5, 6, 8 don't repeat — they're already in place.

---

## Known gaps this map exposes (for the guided-flow / validation feature to eventually catch)

None of these block a determined admin today, but a self-onboarding school with no one walking
them through it could easily hit these silently:

1. Activating a term or generating invoices before any fee structure exists → real invoices at
   ₦0, with no warning.
2. Adding a student before any class exists → not possible from the UI (class is a required
   field), which is actually the one gap-proofed step in this whole flow already.
3. Sending invoices before a payment provider is connected and DVAs are provisioned → parents get
   an invoice with no way to pay it.
4. Skipping DVA provisioning for a student added after the initial bulk-provision run → that
   student's invoices/receipts reference a blank account number.
5. Configuring sibling discounts without knowing about the phone-matching fraud gap in Phase 4.

These are exactly the checks the future setup-guide-mascot / validation layer should run against,
using this document as its dependency source of truth.
