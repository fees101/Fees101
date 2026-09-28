# Fees101 Platform Console — Architecture & Information Architecture Plan

> The Fees101-side control plane: the internal, owner/operator console for running
> the whole business across every school tenant. Distinct from the school-facing
> app (`src/app/(app)/`) and from any parent-facing surface. Lives in
> `platform-dashboard/` (separate Next.js app, port 3100, shared Supabase).
>
> Status: **planning** (2026-09-29). This replaces the ad-hoc scaffold layout.
> Build against this IA rather than the raw school-list scaffold.

---

## 1. Why this is worth planning properly

This is the console a **due-diligence team, an acquirer, or a first ops hire** will
judge. It is where money, tenants, and trust are managed. Three consequences:

1. **Clean tenant isolation & auditability** — every cross-tenant action (suspend,
   edit billing, impersonate, clear a DVA) must be attributable, logged to a
   *platform-level* audit trail, and permission-gated. This is table stakes for a
   payments company under DD.
2. **Metrics a buyer asks for on day one** — MRR/ARR, active tenants, churn, student
   growth, collection health, margin per tenant. The console should surface these,
   not require a data export to compute them.
3. **Structure that scales from 1 → 500 schools** — the home screen is an *overview*,
   not a list; the list is one section behind it; everything has an obvious home.

Research basis (multi-tenant SaaS ops consoles): tenant context propagated via
trusted claims and enforced per-action (not just hidden in UI); tenant-aware
monitoring that separates health/usage/billing per customer without leaking across
tenants; persona-specific dashboards; billing joined to tenant data to compute
margin. Sources: [AWS — multi-tenant SaaS best practices](https://aws.amazon.com/isv/resources/5-multi-tenant-saas-architecture/),
[AWS — control plane across tenants](https://docs.aws.amazon.com/prescriptive-guidance/latest/patterns/manage-tenants-across-multiple-saas-products-on-a-single-control-plane.html),
[Frontegg — SaaS multi-tenancy](https://frontegg.com/blog/saas-multitenancy).

---

## 2. Users & personas

- **Founder / owner** (now): sees everything, makes every decision.
- **Internal ops / support** (soon, ~5-school scale-up): day-to-day tenant support,
  onboarding, collection chasing — but NOT billing-model or destructive changes.
- **Finance** (later): billing, charges, margin, exports — read-heavy.
- **Engineer / on-call** (later): integration health, webhook/job status, errors.

Permissions mirror this: a platform-side roles model (owner / admin / support /
finance / read-only), gated at the **server-action layer**, every privileged action
written to the platform audit log. (v1: just `owner`/`admin` in `platform_admins`,
already built; the fuller role set is a documented v2.)

---

## 3. Visual direction — a deliberately *different* surface

The console is a **sibling** of the school app, not a clone. It should read instantly
as "the control room," never be mistaken for a school's own screen.

- **Shared with the school app (family resemblance):**
  - **Type:** Archivo (`--font-heading` / `--font-body`), same weights (400/600/800).
  - **Language:** flat, architectural, zero corner radius, strong 2px dividers,
    labels flush-left, Lucide icons, modular grid. (The "Modernist" system.)
- **Distinct (so you always know where you are):**
  - **Accent + ground = its own palette.** The school app is a light ground
    (`#f3f2f2`) with a red-orange accent (`#ec3013`). The console should take a
    **different accent and a cooler/darker ground** — proposed: an **ink/graphite
    ground with a single electric-blue or indigo accent** (a "control-room" feel),
    or, if kept light, a light ground with an **indigo/teal accent** clearly not the
    school red. Final palette is the owner's call; the rule is *one distinct accent,
    consistently applied*, never the school red.
  - A persistent **"FEES101 · PLATFORM" wordmark/among the top bar** and a subtle
    environment chip (TEST / LIVE) so no one confuses console vs school app vs
    test vs production.
- Implementation: the console gets its **own token set** (its own `styles.css` /
  Tailwind theme) seeded from the Modernist tokens but with the accent + ground
  swapped. Do not import the school app's theme; keep the two independently themeable.

*(This doc specifies direction; a visual mockup can follow. The owner may redesign
the palette later — the structure below is independent of the exact colors.)*

---

## 4. Information architecture (where everything goes)

Top-level navigation (left rail), in priority order. Each is a section; the **Home /
Overview** is the landing, NOT the school list.

### 4.1 Home / Overview  `/`
The operator's morning screen. Never a raw list. Contains:
- **Headline KPIs:** total schools (active / onboarding / suspended); total billable
  students across all schools; expected platform revenue this cycle (MRR); collected
  vs outstanding platform fees; new schools + net student growth this month.
- **"Needs attention" queue** (the heart of the page): schools overdue / in grace /
  suspended on platform billing; schools with broken payment config, failed webhooks,
  or an expiring onboarding-free window; provider/DVA issues; stuck background jobs.
  Each row deep-links to the relevant school/section.
- **Recent platform activity** (from the platform audit log): charges, suspensions,
  onboardings, impersonation sessions.
- A **search / jump-to-school** box (type-ahead), so the full list isn't needed here.

### 4.2 Schools  `/schools` → `/schools/[id]`
- **Directory** (`/schools`): searchable, filterable (status, billing state, provider,
  size), paginated table. This is the *list* — deliberately one level below Home.
- **School detail** (`/schools/[id]`): the tenant's single pane. Tabbed:
  - **Overview** — snapshot: status, plan, onboarding date/cycle phase, student count,
    key contacts, quick actions (suspend/reactivate, impersonate — all logged).
  - **Billing** — the new model: current cycle phase (free/billed + days left),
    student-days accrued, current period amount due, period history, and the
    school's **Fees101 DVA** to pay into + charge history + status ladder.
    *(This is where the accrual-engine + DVA-collection work lands — `AccrualPanel`
    + `CollectionPanel`, re-homed here.)*
  - **Usage** — students over time, invoices generated, SMS/email volume + cost
    (from `message_logs`), a load/size proxy. Feeds margin.
  - **Payments health** — their payment provider, DVA provisioning coverage
    (students with/without a DVA), webhook delivery health, reconciliation state,
    last successful parent payment.
  - **Activity** — this school's slice of the platform audit log + notable events.

### 4.3 Billing  `/billing`
Cross-school finance view (aggregates the per-school billing): revenue this cycle,
outstanding, upcoming bills, failed/overdue collections, per-school margin (platform
revenue vs their SMS/email cost + infra proxy). Exports for finance. The place
Finance lives.

### 4.4 Payments & integrations health  `/health`
Engineer/on-call view — cross-tenant: webhook delivery status (per provider),
background-job queue health (`background_jobs`), provider credential validity, DVA
provisioning failures/rate-limit backoffs, reconciliation cron status. Surfaces
existing signals (`message_logs`, `webhook_events`, `background_jobs`, DVA columns) —
no new third-party connections.

### 4.5 Onboarding  `/onboarding`
Create a new school tenant (founder-gated) + drive the post-creation self-serve
setup. Seeds default roles (Administrator + Bursar — see `db/roles_permissions.sql`),
sets the onboarding date (billing cycle anchor), provisions the school's Fees101
billing DVA. The "new tenant wizard" pattern.

### 4.6 Support / impersonation  (action, not a page)
Enter a school's in-school view **read-only** (see the Impersonation roadmap item):
view what they see for support/debugging; make NO destructive changes as them; every
real change happens from this console; every impersonation start/stop is logged.

### 4.7 Platform audit log  `/audit`
The *second*, platform-level audit trail — founder/internal actions across tenants
(suspend, edit billing, impersonate, clear DVA, onboard). Separate from each school's
own `/settings/audit-log`. Filterable by actor, action, school, date.

### 4.8 Settings  `/settings`
Platform admins & (v2) roles/permissions, platform Paystack config, billing defaults
(₦500/student/month, 65/300 cycle, suspension day-counts), message templates for
school-facing notices.

---

## 5. Data & audit model (what backs the above)

- Tenant data: shared Supabase, `school_id` scoping (already the app's model). The
  console reads cross-school via the **service role**; every read/write still goes
  through code that logs privileged actions.
- Platform tables (created 2026-09-29, `db/platform_dashboard_schema.sql` +
  `db/platform_billing_model.sql`): `platform_admins`, `platform_billing`,
  `platform_billing_periods`, `platform_daily_usage`, `platform_billing_charges`,
  `platform_audit_log`.
- **Every privileged console action writes `platform_audit_log`** with actor, action,
  school, summary, metadata — the DD-grade trail.

---

## 6. Build sequencing

1. **Foundation (done / in progress):** platform schema; accrual engine (daily
   pro-rata + 65/300 cycle); DVA provisioning + webhook reconciliation.
2. **Console theming:** the distinct token set (Archivo + own accent/ground) + the
   app shell (left rail, top bar with PLATFORM wordmark + env chip).
3. **School detail tabs:** re-home the accrual + collection panels into the Billing
   tab; build Overview/Usage/Payments-health/Activity tabs.
4. **Home / Overview:** KPIs + needs-attention queue + search + recent activity.
5. **Cross-school Billing + Health + Audit sections.**
6. **Onboarding wizard** (ties to the self-onboarding roadmap item).
7. **Platform roles/permissions + read-only impersonation** (v2).

---

## 7. Open decisions (owner)

- Exact console **palette** (accent + ground) — direction set (distinct, cooler/darker),
  final colors TBD; owner may redesign.
- Billing cycle **anchoring** + period boundary (calendar month vs rolling 30).
- Suspension **day-counts** + auto-vs-manual trigger.
- Whether card auto-charge is offered as a zero-touch fallback alongside the DVA route.
- Platform **roles** granularity (when a second internal user exists).
