# Fees101 — Project Memory

> A short index of durable facts about this codebase, for any Claude Code
> session opened here. This file stays an index — it points at the other
> four root docs rather than duplicating them. Read those directly for
> detail:
> - **`PRD.md`** — what Fees101 is, who it's for, the product spec.
> - **`phases.md`** / **`ROADMAP.md`** — build sequencing, what's shipped
>   vs. outstanding (`phases.md` is a summary; `ROADMAP.md` is the living,
>   ~500KB detail file — grep its `##` headers, don't read it end to end).
> - **`design.md`** — the "Modernist" visual design system.
> - **`architecture.md`** — full system shape (this file only summarizes it).

## The three-app structure, and why they're separate

`fees101-web` (the product), `fees101-console` (internal ops, Fees101 staff
only, never linked from the product), `fees101-marketing` (public site,
folded in 2026-09-30, no backend of its own). Each is a self-contained
Next.js app (own `package.json`/`node_modules`/`.env.local`) sharing one
Supabase backend, deployed as separate Vercel projects. They're kept apart
because `fees101-console` has cross-tenant visibility that must never leak
into the customer-facing app, and `fees101-marketing` has a different
audience and update cadence than the product. See `architecture.md`.

## The Modernist design system

House visual style for all three apps (marketing is mid-migration onto it
as of 2026-09-30). Source of truth: `fees101-web/src/app/globals.css`.
Non-negotiable rules: zero border-radius everywhere, 2px borders instead of
shadows, no spinners (a sweeping ink rule instead), single typeface
(Archivo), tabular numerals for all figures, and strict color semantics —
ledger-green means money has actually arrived and nothing else, signal-red
is the one brand accent used sparingly, ochre marks states awaiting a
human. Full detail and a definition-of-done checklist: `design.md`.

## The accrual billing model (the platform's own billing, not a school's)

Fees101 charges schools ₦500/active-student/month, daily pro-rata, on a
recurring 65-free/300-billed day cycle anchored to each school's onboarding
date, collected via a Fees101-owned dedicated virtual account per school
(flat ₦300 transfer fee). This is separate from — and not to be confused
with — how a school itself collects fees from parents (also via DVAs, but
per-student/family, through the school's own Monnify/Paystack account).
Decided 2026-09-29, actively being built. Full detail: `PRD.md`.

## Next.js: `proxy.ts`, not `middleware.ts`

Next.js 16 renamed the edge-middleware convention. The real file is
`fees101-web/src/proxy.ts` (`export async function proxy(...)`). Don't
create or look for a `middleware.ts` — it won't be picked up. It handles
session/idle-timeout and route protection for pages only; every `/api/*`
route enforces its own auth, by the file's own stated rule ("middleware
protects pages, `/api` protects itself").

## A few other durable facts worth knowing before starting work

- No automated DB migration runner — `db/*.sql` files under `fees101-web/`
  are applied by hand in the Supabase SQL editor. A feature can be fully
  coded and still not work in practice because its migration hasn't been
  run — check `ROADMAP.md`'s entry for a feature before assuming a bug.
- RLS is a real, audited security boundary, not a formality — several
  serious bugs (including a self-escalation-to-admin hole) were found and
  fixed at the RLS layer specifically. New tables need their own RLS pass.
- "Background job" here means a row in a shared `background_jobs` Postgres
  table plus a polled/cron-driven route — there is no separate worker
  service or queue infrastructure.
- Local dev slowness is usually the corporate Zscaler proxy, not the app —
  Supabase (`eu-central-1`) and Vercel (`fra1`) are already co-located for
  low production latency.
