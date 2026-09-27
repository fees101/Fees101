-- Phase 1 of the opt-in family-level DVA feature (ROADMAP.md, 2026-09-27).
-- Adds the fields needed to mark a family as "shared account" and later store
-- its provisioned Paystack DVA. Purely additive — every existing family
-- defaults to dva_enabled = false, so nothing about today's per-student DVA
-- flow changes until a school explicitly opts a family in.
--
-- Checked against the live `families` table before writing this — no
-- existing column names collide. Idempotent: safe to re-run.

alter table public.families
  add column if not exists dva_enabled boolean not null default false,
  add column if not exists dva_enabled_at timestamptz,
  add column if not exists dva_enabled_by uuid references public.users(id),
  add column if not exists provider_dva_reference text,
  add column if not exists provider_dva_bank_code text,
  add column if not exists provider_dva_account_number text,
  add column if not exists provider_dva_bank_name text,
  add column if not exists provider_dva_created_at timestamptz,
  -- Tracks which student absorbed the last overflow beyond every sibling's
  -- open invoices, so the family panel can show "excess last applied to X"
  -- without re-deriving it from payment history on every render. Deliberately
  -- NOT a foreign key: a second students<->families relationship makes every
  -- `families!inner(...)` embed elsewhere in the app ambiguous to PostgREST
  -- (see db/family_dva_fix_ambiguous_fk.sql, which drops this on databases
  -- that already ran this file with the FK in place).
  add column if not exists dva_last_overflow_student_id uuid;

-- A family's DVA reference must resolve to exactly one family in O(1) from
-- the webhook, the same way students.provider_dva_reference does today.
create unique index if not exists idx_families_provider_dva_reference
  on public.families (provider_dva_reference)
  where provider_dva_reference is not null;
