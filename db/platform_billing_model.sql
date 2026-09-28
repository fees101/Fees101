-- Platform billing model v2 (decided 2026-09-29): daily pro-rata ₦500/student/
-- month, recurring 65-days-free → 300-days-billed cycle anchored to onboarding,
-- collected via a per-school Fees101-owned DVA (flat ₦300 transfer). Reworks the
-- original annual-price/card scaffold from db/platform_dashboard_schema.sql.
-- Run after that file. Service-role only (RLS on, no policies).
--
-- DESIGN NOTE: still being refined (see ROADMAP "Platform billing model" open
-- items). This is the v1 shape; cycle anchoring, period boundaries, and
-- suspension day-counts may change. All additive/if-not-exists so it's safe to
-- re-run.

-- Per-school billing config + the Fees101-owned DVA the school pays INTO.
alter table public.platform_billing
  add column if not exists onboarding_at timestamptz,                        -- cycle anchor; day 0
  add column if not exists price_per_student_month numeric not null default 500,
  add column if not exists platform_dva_reference text,                      -- Fees101 Paystack customer_code
  add column if not exists platform_dva_account_number text,
  add column if not exists platform_dva_bank_name text,
  add column if not exists platform_dva_bank_code text,
  add column if not exists platform_dva_created_at timestamptz;

-- One row per school per day, written by a daily cron off SERVER time (so a
-- school can't backdate enrollment to dodge a day). `billable=false` for days
-- inside a 65-day free window; `accrued_amount = active_student_count *
-- (price_per_student_month / 30)` on billable days, 0 otherwise.
create table if not exists public.platform_daily_usage (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  usage_date date not null,
  active_student_count integer not null default 0,
  billable boolean not null default true,
  accrued_amount numeric not null default 0,
  created_at timestamptz not null default now(),
  unique (school_id, usage_date)
);
create index if not exists platform_daily_usage_school_idx
  on public.platform_daily_usage (school_id, usage_date desc);

-- Aggregates a period's daily accrual into one bill the school pays. Period
-- boundary (calendar month vs rolling 30) is a code decision, kept flexible via
-- explicit start/end dates here.
create table if not exists public.platform_billing_periods (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  student_days numeric not null default 0,      -- Σ active_student_count over billable days
  amount_due numeric not null default 0,
  amount_paid numeric not null default 0,
  status text not null default 'open'
    check (status in ('open', 'billed', 'paid', 'partial', 'overdue', 'waived')),
  billed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, period_start)
);
create index if not exists platform_billing_periods_school_idx
  on public.platform_billing_periods (school_id, period_start desc);

-- Extend the charge history for DVA-transfer reconciliation (was card-only).
alter table public.platform_billing_charges
  add column if not exists method text not null default 'card',   -- 'card' | 'dva_transfer'
  add column if not exists period_id uuid references public.platform_billing_periods(id) on delete set null,
  add column if not exists provider_transaction_id text,
  add column if not exists paid_at timestamptz;

alter table public.platform_daily_usage enable row level security;
alter table public.platform_billing_periods enable row level security;

notify pgrst, 'reload schema';
