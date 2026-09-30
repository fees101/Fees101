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

## Working in an app

Each app is self-contained — its own `package.json`, `node_modules`, `.env.local`. `cd` into it before running anything:

```bash
cd fees101-web && npm run dev
cd fees101-console && npm run dev
cd fees101-marketing && npm run dev
```
