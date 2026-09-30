-- Platform (owner/multi-tenant) dashboard schema — the Fees101-side admin app
-- in platform-dashboard/ (a separate Next.js app on port 3100, same Supabase).
-- These tables were scaffolded in code (commit 0054ca4) but never captured in a
-- migration file and were never actually created in the DB — this file fixes
-- both. Run in the Supabase SQL editor OR via psql against DATABASE_URL.
--
-- NOTE: platform_billing's columns below match the ORIGINAL scaffold model
-- (flat annual_price ÷ terms, charged via saved card). The billing MODEL is
-- being reworked to daily pro-rata (~NGN500/student/month, cyclic 65-free /
-- 300-billed) collected via a per-school Fees101 DVA — those columns will be
-- added/changed in a follow-up migration. This file just makes the existing
-- dashboard boot, log in, and render without crashing so it can be worked on.
--
-- All tables are service-role only (the dashboard reads/writes with the service
-- role key, which bypasses RLS). RLS is enabled with NO policies so nothing is
-- reachable via the anon/public key.

-- Who may access the platform dashboard. id = the Supabase Auth user id; a row
-- here is what grants access beyond a plain login (see platform-dashboard auth.ts).
create table if not exists public.platform_admins (
  id uuid primary key,
  name text not null default '',
  email text not null,
  role text not null default 'admin' check (role in ('owner', 'admin')),
  created_at timestamptz not null default now()
);

-- One billing record per school.
create table if not exists public.platform_billing (
  school_id uuid primary key references public.schools(id) on delete cascade,
  annual_price numeric not null default 0,
  paystack_authorization_code text,
  paystack_email text,
  billing_status text not null default 'active'
    check (billing_status in ('active', 'payment_due', 'grace', 'suspended', 'cancelled')),
  billing_status_changed_at timestamptz,
  next_charge_due_at timestamptz,
  last_charged_at timestamptz,
  last_charge_amount numeric,
  last_charge_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- History of every attempted charge against a school.
create table if not exists public.platform_billing_charges (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  amount numeric not null,
  status text not null default 'pending' check (status in ('pending', 'success', 'failed')),
  paystack_reference text,
  charged_by text,
  failure_reason text,
  created_at timestamptz not null default now()
);
create index if not exists platform_billing_charges_school_idx
  on public.platform_billing_charges (school_id, created_at desc);

-- Platform-side audit trail (billing status changes, charges, manual actions).
create table if not exists public.platform_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_name text,
  action text not null,
  school_id uuid references public.schools(id) on delete set null,
  summary text,
  metadata jsonb,
  created_at timestamptz not null default now()
);
create index if not exists platform_audit_log_created_idx
  on public.platform_audit_log (created_at desc);

alter table public.platform_admins enable row level security;
alter table public.platform_billing enable row level security;
alter table public.platform_billing_charges enable row level security;
alter table public.platform_audit_log enable row level security;

-- Tell PostgREST (supabase-js) to pick up the new tables immediately.
notify pgrst, 'reload schema';
