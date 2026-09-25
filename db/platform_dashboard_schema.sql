-- Run this once in the Supabase SQL editor.
--
-- Platform-billing prerequisites for the founder/owner dashboard (a separate
-- app, platform-dashboard/, reading this same Supabase project with the
-- service-role key). Nothing here is read by the schools-facing app itself
-- except terms_per_year, which fees/cycles code will start relying on for
-- per-term billing math.

-- Per-term billing needs to know how many terms a school runs a year — there
-- was no explicit field for this anywhere (schools with 3-term, 2-semester,
-- or other calendars all look the same today). Defaults to 3 (the common
-- Nigerian school-term pattern) so existing rows aren't left null.
alter table public.schools
  add column if not exists terms_per_year integer not null default 3
  check (terms_per_year > 0 and terms_per_year <= 12);

-- One row per school, holding what the platform (not the school) charges
-- them for using Fees101. Kept separate from `schools` since it's platform-
-- only data the schools-facing app has no reason to read or write.
create table if not exists public.platform_billing (
  school_id uuid primary key references public.schools(id) on delete cascade,
  -- Annual list price in kobo (matches the app's existing numeric(12,2)-in-naira
  -- convention elsewhere, so this stores naira too, not kobo, for consistency).
  annual_price numeric(12,2) not null default 0,
  -- Snapshot of active-student-count the price was last computed against, and
  -- when — per-term amount = annual_price / terms_per_year, independent of
  -- student count for now (flat pricing); this column exists so a future
  -- per-student model doesn't need a new table, just a backfill.
  active_student_count integer,
  active_student_count_at timestamptz,
  -- Paystack's reusable-charge token for this school's saved card, captured
  -- once via a small initial transaction, then reused for every future
  -- charge_authorization call. Not the card number — Paystack never gives us
  -- that. Null until the school completes the "add payment method" flow.
  paystack_authorization_code text,
  paystack_customer_code text,
  paystack_email text,
  authorization_captured_at timestamptz,
  -- Suspension ladder state — mirrors schools.subscription_status
  -- (active | payment_due | suspended | inactive | cancelled), duplicated
  -- here rather than read from `schools` directly so platform billing logic
  -- doesn't need write access to the schools-facing table at all.
  billing_status text not null default 'active'
    check (billing_status in ('active', 'payment_due', 'grace', 'suspended', 'cancelled')),
  billing_status_changed_at timestamptz not null default now(),
  next_charge_due_at timestamptz,
  last_charged_at timestamptz,
  last_charge_amount numeric(12,2),
  last_charge_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Every attempted charge, success or failure — the actual billing history,
-- independent of the single "last charge" summary columns above.
create table if not exists public.platform_billing_charges (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  amount numeric(12,2) not null,
  status text not null check (status in ('pending', 'success', 'failed')),
  paystack_reference text,
  failure_reason text,
  charged_by text, -- 'system' (scheduled) or a platform_admins.id (manual)
  created_at timestamptz not null default now()
);

-- Who is allowed into the platform dashboard at all. Reuses Supabase Auth
-- (auth.users) rather than a second auth system — a row here is the
-- allowlist, keyed by the same id Supabase Auth issues.
create table if not exists public.platform_admins (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text not null,
  role text not null default 'admin' check (role in ('owner', 'admin')),
  created_at timestamptz not null default now()
);

-- Separate from each school's own audit_log — this is founder-level actions
-- (suspend a school, edit its price, clear a stuck DVA job, impersonate),
-- not anything a school's own staff did.
create table if not exists public.platform_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.platform_admins(id),
  actor_name text not null,
  action text not null,
  school_id uuid references public.schools(id),
  summary text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_platform_billing_charges_school on public.platform_billing_charges(school_id);
create index if not exists idx_platform_audit_log_school on public.platform_audit_log(school_id);

alter table public.platform_billing enable row level security;
alter table public.platform_billing_charges enable row level security;
alter table public.platform_admins enable row level security;
alter table public.platform_audit_log enable row level security;

-- No school-facing policies at all — every one of these tables is read and
-- written exclusively by the platform-dashboard app via the service-role
-- key, which bypasses RLS entirely. RLS is enabled anyway so a future bug
-- that hands a school's own session a query against these tables fails
-- closed instead of leaking cross-school data.
