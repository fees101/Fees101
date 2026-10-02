# Fees101 — Architecture

> System shape: apps, backend, deploy, conventions. For product intent see
> `PRD.md`. For build order see `phases.md`. For the visual system see
> `design.md`.

## Three-app monorepo

```
fees101-web/          the product — what schools, parents (via SMS/email) and staff use day to day
fees101-console/      internal ops dashboard, Fees101 staff only — billing, school accounts, platform health
fees101-marketing/    public marketing site (fees101.com) — folded in from a separate repo on 2026-09-30
```

Each app is self-contained: its own `package.json`, `node_modules`,
`.env.local`. `cd` into an app before running anything — there is no shared
root install:

```bash
cd fees101-web && npm run dev
cd fees101-console && npm run dev
cd fees101-marketing && npm run dev
```

**Why separate apps, not one Next.js app with route groups:**
`fees101-console` is internal-only and must never be linked from or
reachable via the school-facing app — keeping it a separate deploy target
makes that a structural guarantee, not a routing convention that could
leak. `fees101-marketing` has a different audience, update cadence, and (per
`README.md`) no backend/env vars of its own. Future platform clients (iOS,
Android, desktop) are expected to land here too, alongside `fees101-web`,
once they exist — the monorepo is the unit of ownership, not the deploy
unit.

## Shared backend: one Supabase project

All three school-facing/internal apps read the same Supabase (Postgres)
project — there is one source of truth for schools/students/invoices/etc.
`fees101-console` reads it via its own env vars (its own service-role or
scoped credentials), not by importing `fees101-web` code.

- **Schema and migrations live inside `fees101-web/`**: `fees101_schema.sql`
  (a full schema snapshot) and `db/*.sql` (individual migration files) sit
  at `fees101-web/db/` and `fees101-web/fees101_schema.sql`, because
  `fees101-web` is the app that owns schema changes day to day.
- **No automated migration runner** — migrations under `db/` are applied by
  hand in the Supabase SQL editor. Several `ROADMAP.md` entries explicitly
  flag "not yet run" migrations as a real reason a feature isn't live yet —
  when picking up work that references a `db/*.sql` file, check whether it
  has actually been applied before assuming the feature works.
- **RLS is the real security boundary**, not just an app-layer check —
  `ROADMAP.md`'s "Pre-production rebuild" section documents a full audit
  pass and at least one serious self-escalation bug found and fixed via
  RLS policy changes. Any new table needs its own RLS pass, not an
  assumption that the app layer alone is enough.
- **Region**: Supabase is `eu-central-1` (Frankfurt), matched deliberately
  to Vercel's `fra1` region (see `vercel.json`'s `"regions": ["fra1"]`) so
  production round-trips are single-digit milliseconds. Local dev latency
  that looks like a backend problem is very often the corporate Zscaler
  proxy on the dev machine, not the code or the region pairing.

## Deployment: Vercel, one project per app

Each app is expected to be its own Vercel project (not one Vercel project
serving multiple apps via rewrites), using the **Root Directory + Ignored
Build Step** pattern for a monorepo: point a Vercel project's Root
Directory at e.g. `fees101-web/`, and use an Ignored Build Step so a commit
that only touches `fees101-marketing/` doesn't trigger a rebuild/redeploy
of `fees101-web`'s Vercel project, and vice versa.

- `fees101-web/vercel.json` pins `"regions": ["fra1"]` and defines the
  scheduled jobs (`crons`) the app depends on: daily reconcile, reminders,
  message-sweep, deletion-purge, job-sweep, rollover-sweep. These are
  Vercel Cron's once-daily fallback; the actual fast sweep cadence (~5 min)
  runs via a separate GitHub Actions workflow
  (`.github/workflows/job-sweep.yml`) hitting the same sweep endpoints,
  since Vercel's free/Hobby tier only allows daily cron schedules.
- `fees101-console` is noted in `README.md` as "deployed as its own Vercel
  project, never linked from the web app" — treat that as a hard
  constraint, not a soft preference, given it's an internal ops surface
  with cross-tenant visibility.
- `fees101-console`'s eventual production split (own Vercel project, likely
  its own `main` branch) is tracked but not yet done — as of the last
  `ROADMAP.md` note on this (2026-09-29) it is still built in-repo on `dev`.
  A standing rule (see project `memory.md`) is that this console code must
  never reach `main`/production of the school-facing app regardless of
  which branch it lives on meanwhile.
- Open note: the exact Ignored Build Step script/command per app wasn't
  found verbatim in this pass — if you're touching Vercel project config,
  confirm the actual configured command in the Vercel dashboard rather than
  assuming a specific one from this doc.

## Next.js conventions

- **Next.js 16**, React 19 (`fees101-web/package.json`).
- **`src/proxy.ts`, not `middleware.ts`** — Next.js 16 renamed the
  edge-middleware entry point/export to `proxy.ts`/`export async function
  proxy(...)`. `fees101-web/src/proxy.ts` is the actual file; don't create
  or expect a `middleware.ts`. It currently handles: an 8-hour idle-session
  timeout (cookie-tracked, not DB-tracked, to avoid a write on every
  request), local JWT verification via `getClaims()` (no network
  round-trip per request, since the project uses asymmetric ECC signing
  keys), redirecting `/signup` to `/login` (public signup is intentionally
  disabled), and the protected-route / auth-page redirect logic. It
  explicitly does **not** guard `/api/*` — every API route enforces its own
  auth (session check or shared-secret for webhooks/cron); the stated rule
  in the file's own comment is "middleware protects pages, `/api` protects
  itself."

## Auth / session pattern

- Supabase Auth (`@supabase/ssr`), cookie-based sessions.
- Two verification paths, both intentional, not a bug: `proxy.ts` and
  `src/lib/auth/permissions.ts`'s `loadAuthContext()` both call
  `supabase.auth.getClaims()` (local JWT signature verification, no network
  call) rather than `auth.getUser()` (which round-trips to the Auth
  server) — a deliberate latency fix. A session still carrying an older
  HS256-signed token falls back to a network `getUser()` call until it
  re-authenticates onto the newer ECC-signed key.
- **Permissions are resolved live per request** (`getAuthContext()`,
  memoized with React's `cache()` for one request, not cached across
  requests) — a role's permission toggle takes effect on the user's very
  next request, with no re-login needed, unlike a JWT-claims-embedded
  permission model.
- `AuthContext` (`src/lib/auth/permissions.ts`) carries `userId`,
  `schoolId`, `role`, `roleId`, `isOwner` (owner/`school_admin`,
  `super_admin`, or any `is_admin`-flagged role — all bypass permission
  checks), `permissions: Set<string>`, and `isActive`.
- Enforcement is layered deliberately: page-level guards (redirect if
  missing a permission), server-action-level `requirePermission()` calls
  (the real boundary — a hidden button is not a security control on its
  own), and RLS at the database level as the last line of defense.

## Background jobs

No separate worker service — "background job" in this codebase means a
status/progress row in a shared `background_jobs` Postgres table, advanced
by a Vercel-Cron-triggered (or client-polled) route, with a GitHub Actions
workflow as a fast (~5 min) stall-sweep fallback since Vercel Hobby only
allows daily cron. Used for invoice generation/regeneration, CSV import,
bulk DVA provisioning, bulk send, and term close/carry-forward — anything
that could exceed a single serverless function's `maxDuration`.

## Where things live (fees101-web)

- `src/app/` — Next.js App Router pages and server actions, grouped by
  feature (`students/`, `fees/`, `invoices/`, `settings/`, etc.).
- `src/lib/` — query functions, business logic (invoicing, discounts,
  payments, messaging), auth/permissions.
- `db/` — hand-applied SQL migrations; `fees101_schema.sql` — full schema
  snapshot.
- `docs/` — app-specific design/architecture notes (e.g.
  `docs/platform-dashboard-architecture.md`,
  `docs/onboarding-sequence.md`).
