-- In-person card POS — Paystack Terminal (MF960) integration.
-- See docs/pos-terminal-integration.md for the full design.
--
-- Adds a third auto-reconciled collection rail: a parent pays by card (or
-- USSD/transfer) in person on the school's physical Paystack Terminal. The
-- bursar initiates a charge from an invoice; Fees101's server creates a Paystack
-- payment request and pushes it to the device (Model A — the live MF960 forbids
-- custom apps). The parent pays; charge.success webhooks into the existing
-- paystackWebhookProcessor pipeline, matched by our stored references ->
-- apply_payment_to_invoice (gross credit, idempotent) -> the normal receipt.
--
-- INTEGRITY: the bursar never types a paid amount. Every terminal payment is a
-- real Paystack transaction confirmed by webhook, exactly like a DVA payment.
--
-- Both tables are SERVICE-ROLE-ONLY for writes (RLS on, no write policies),
-- mirroring the webhook_events / access_requests / login_attempts pattern: the
-- server actions and the webhook write them with the service-role key AFTER
-- checking the caller's permission in code, so a user session can never fabricate
-- a 'paid' row by calling PostgREST directly. Reads are school-scoped so the
-- front desk can poll a charge's live status.
--
-- Run this once in the Supabase SQL editor. Idempotent (safe to re-run).

-- ---------------------------------------------------------------------------
-- 1. school_terminals — one row per physical device a school owns.
--    A school can have several (multi-desk / multi-campus). Discovered and
--    labelled from Payment settings via listTerminals(); no manual id typing.
-- ---------------------------------------------------------------------------
create table if not exists public.school_terminals (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references public.schools(id),
  -- Paystack's terminal id (the value /terminal/:id/event expects). Stored as
  -- text because that is what the Terminal API uses on the wire.
  terminal_id   text not null,
  serial        text,
  -- Human label the school sets, e.g. "Front desk". Falls back to serial/id.
  label         text,
  -- Mirrors Paystack's device status ('active' | 'inactive' | ...). Informational.
  status        text,
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- One row per device per school — refresh upserts on this.
create unique index if not exists school_terminals_school_terminal_idx
  on public.school_terminals (school_id, terminal_id);

alter table public.school_terminals enable row level security;

-- School-scoped reads (the Terminals settings panel + the charge flow's device
-- picker). Writes are service-role only (no insert/update/delete policy).
drop policy if exists "Read own school terminals" on public.school_terminals;
create policy "Read own school terminals"
  on public.school_terminals for select
  using ((school_id = public.current_school_id()) or public.is_super_admin());

-- ---------------------------------------------------------------------------
-- 2. terminal_payment_requests — one row per push; the heart of reconciliation.
--    The UI polls this row; the webhook flips it to 'paid'. We store every key
--    Paystack might echo back (our own reference, the payment-request id, the
--    request_code, the offline_reference) and match an inbound charge against
--    ANY of them — the exact field the live device populates is confirmed once we
--    have a device, and matching broadly is the defensive design until then.
-- ---------------------------------------------------------------------------
create table if not exists public.terminal_payment_requests (
  id                          uuid primary key default gen_random_uuid(),
  school_id                   uuid not null references public.schools(id),
  student_id                  uuid not null references public.students(id),
  -- The invoice the bursar initiated from. The payment itself still rides the
  -- normal oldest-first waterfall across the student's open invoices (same as a
  -- DVA payment); this is the anchor for the amount and for the UI.
  invoice_id                  uuid references public.invoices(id),
  -- Forward-compat for a family terminal charge (recommend single-invoice v1).
  family_id                   uuid references public.families(id),
  terminal_id                 text not null,
  -- Our own resolvable key, generated per push (TERM-<uuid>).
  reference                   text not null,
  -- Paystack's identifiers, captured from createPaymentRequest.
  paystack_payment_request_id text,
  request_code                text,
  offline_reference           text,
  amount                      numeric not null check (amount > 0),
  status                      text not null default 'pending'
                                check (status in ('pending','sent','paid','failed','expired')),
  -- The terminal event id returned by pushEventToTerminal, for status polling.
  event_id                    text,
  delivered                   boolean not null default false,
  -- The payments row(s) the eventual charge.success applied to (for traceability).
  applied_payment_ids         uuid[],
  pushed_by                   uuid references public.users(id),
  pushed_by_name              text,
  error_message               text,
  expires_at                  timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

-- Our reference must resolve to exactly one request in O(1) from the webhook.
create unique index if not exists terminal_payment_requests_reference_idx
  on public.terminal_payment_requests (reference);
-- The webhook also matches on Paystack's echoed identifiers; index the ones it
-- looks up by. Partial so nulls (before createPaymentRequest returns) don't bloat.
create index if not exists terminal_payment_requests_offline_ref_idx
  on public.terminal_payment_requests (offline_reference)
  where offline_reference is not null;
create index if not exists terminal_payment_requests_request_code_idx
  on public.terminal_payment_requests (request_code)
  where request_code is not null;
create index if not exists terminal_payment_requests_pr_id_idx
  on public.terminal_payment_requests (paystack_payment_request_id)
  where paystack_payment_request_id is not null;
-- The status modal lists a school's recent/open requests, newest first; the
-- expiry sweep finds stale open ones.
create index if not exists terminal_payment_requests_school_status_idx
  on public.terminal_payment_requests (school_id, status, created_at desc);

alter table public.terminal_payment_requests enable row level security;

-- School-scoped reads so the front desk can poll the charge it just pushed.
-- Writes are service-role only — a user session can never set status='paid'.
drop policy if exists "Read own school terminal payment requests" on public.terminal_payment_requests;
create policy "Read own school terminal payment requests"
  on public.terminal_payment_requests for select
  using ((school_id = public.current_school_id()) or public.is_super_admin());

-- ---------------------------------------------------------------------------
-- 3. Allow the terminal rail's ledger method. public.payments has an enumerated
--    method CHECK (base schema); 'provider_terminal' must be permitted or the
--    webhook's apply fails with payments_method_check. Drop + re-add with the
--    full set of methods the app can write (verified against existing data: no
--    row uses a value outside this set). Idempotent via drop-if-exists.
-- ---------------------------------------------------------------------------
alter table public.payments drop constraint if exists payments_method_check;
alter table public.payments add constraint payments_method_check
  check (method in (
    'provider_dva', 'provider_terminal',
    'cash', 'pos', 'cheque', 'other', 'bank_transfer_manual'
  ));

-- ---------------------------------------------------------------------------
-- 4. Fix a function-overload ambiguity that otherwise breaks ALL provider
--    payments (DVA + terminal). db/payment_provider_fee.sql created the shorter
--    apply_payment_to_invoice / insert_credit_balance_payment; db/manual_payment_entry.sql
--    added longer overloads (p_recorded_by). Postgres keeps both, so a call that
--    supplies only the original args matches BOTH ("could not choose the best
--    candidate function") and the payment is silently dropped. Drop the superseded
--    shorter overloads; the p_recorded_by versions accept the old call shape too
--    (the extra arg defaults to null). Also lives standalone in
--    db/fix_apply_payment_overload.sql. Idempotent.
-- ---------------------------------------------------------------------------
drop function if exists public.apply_payment_to_invoice(
  uuid, uuid, uuid, numeric, text, text, text, text, timestamptz, text, numeric
);
drop function if exists public.insert_credit_balance_payment(
  uuid, uuid, numeric, text, text, text, text, timestamptz, text, numeric
);

notify pgrst, 'reload schema';
