# Fees101

School fees management platform. This repo holds every Fees101 app.

## Apps

- **fees101-web** — the product. What schools, parents and staff use day to day.
- **fees101-console** — internal ops dashboard (Fees101 staff only). Billing, school accounts, platform health. Deployed as its own Vercel project, never linked from the web app.
- **fees101-marketing** — public marketing site at fees101.com. No backend/env vars of its own; folded in from a separate repo (`fees101/fees101-website`) on 2026-09-30.

Future platform clients (iOS, Android, Mac, Windows) will live here too, alongside `fees101-web`, once they exist.

## Shared

- `db/` and `fees101_schema.sql` live inside `fees101-web/` since that's the app that owns schema migrations, but the underlying Supabase project is shared — `fees101-console` reads the same database via its own env vars.
- `docs/` and `ROADMAP.md` at this root level apply across the whole product, not just one app.

## Docs

Project-level reference docs live in `docs/`:

- [`docs/PRD.md`](docs/PRD.md) — what Fees101 is and who it's for.
- [`docs/architecture.md`](docs/architecture.md) — how the three apps, Supabase project, and Vercel projects fit together.
- [`docs/phases.md`](docs/phases.md) — build sequencing and what's shipped vs. pending.
- [`docs/design.md`](docs/design.md) — the Modernist design system (tokens, components, definition of done). Load this before writing any UI.
- [`docs/memory.md`](docs/memory.md) — project-level memory: decisions and context that don't belong in code.
- [`docs/onboarding-sequence.md`](docs/onboarding-sequence.md), [`docs/platform-dashboard-architecture.md`](docs/platform-dashboard-architecture.md) — earlier reference docs, still current.

Claude Code project skills live in `.claude/skills/` (auto-loaded for any session opened in this repo): `design-taste`, `design-audit`, `design-references`, `image-to-code`, `playwright-cli`. Together they're meant to keep every Claude session working on this repo at the same design bar — see `docs/design.md` for the system they all check against.

## Working in an app

Each app is self-contained — its own `package.json`, `node_modules`, `.env.local`. `cd` into it before running anything:

```bash
cd fees101-web && npm run dev
cd fees101-console && npm run dev
cd fees101-marketing && npm run dev
```
