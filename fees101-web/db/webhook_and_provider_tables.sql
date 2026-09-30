-- Documents three tables that exist live in Supabase but had no CREATE
-- TABLE anywhere in this repo (added directly in the SQL editor during the
-- Paystack/Sendchamp work). Confirmed via live introspection (2026-09-01):
-- all three have RLS enabled with zero policies, and every call site
-- (webhookProcessor.ts, paystackWebhookProcessor.ts, reconcile.ts, the
-- Sendchamp webhook route) uses createServiceRoleClient(), which bypasses
-- RLS — so "no policies" here means "no non-service-role access at all,"
-- which is correct for tables only ever touched server-to-server.
--
-- This file is documentation of the live schema, not a migration to run
-- against a database that already has these tables — every statement is
-- guarded with IF NOT EXISTS specifically so it's harmless if run again,
-- but it will not retroactively add the unique constraint below to a
-- pre-existing processed_provider_transactions table that lacks it. If
-- that constraint is missing live, add it separately.

create table if not exists public.webhook_events (
  id uuid primary key default uuid_generate_v4(),
  school_id uuid references public.schools(id),
  provider text not null,
  event_type text,
  transaction_reference text,
  raw_payload jsonb not null,
  signature_header text,
  status text not null default 'received',
  error_message text,
  related_payment_ids uuid[],
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.webhook_events enable row level security;

-- Claim table for webhook idempotency: one insert per real provider
-- transaction wins, concurrent retries of the same delivery lose on the
-- unique constraint (see webhookProcessor.ts:137-148).
create table if not exists public.processed_provider_transactions (
  id uuid primary key default uuid_generate_v4(),
  school_id uuid not null references public.schools(id),
  provider text not null,
  provider_transaction_id text not null,
  created_at timestamptz not null default now(),
  unique (provider, provider_transaction_id)
);

alter table public.processed_provider_transactions enable row level security;

create table if not exists public.sms_webhook_events (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  payload jsonb not null,
  matched boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.sms_webhook_events enable row level security;
