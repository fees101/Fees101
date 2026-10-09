-- Dated credit ledger (2026-10-09) — fixes a real gap in the "Collected"
-- dashboard figure (ROADMAP.md, "Dashboard Collected" section): a student's
-- credit_balance is one fungible scalar with no memory of which term's money
-- it came from, so a term's "credit applied" total previously counted credit
-- that actually originated in a PAST term (carried-over credit someone spent
-- this term), inflating this term's Collected with money that was already
-- collected before. That also matters for reconciliation against Paystack's
-- own settlement, since Paystack only ever settles what it actually took in
-- during a given period — a school's own dashboard claiming more "collected"
-- this term than actually moved through their Paystack account this term
-- would look like money is missing when none is.
--
-- Design: every naira of credit is tracked as a "lot" (credit_ledger) from
-- the moment it's created, tagged with the billing cycle it was actually
-- collected in. Spending credit always draws from the OLDEST lot first
-- (FIFO) — the same "spend what came in earliest" principle any ledger uses.
-- When credit is spent against a specific invoice, credit_consumption_log
-- records exactly which lot(s) it was drawn from, so later we can ask "of
-- the credit applied to this term's invoices, how much of it was ALSO
-- collected this term" (the only amount Collected should count) versus
-- carried over from before (already counted in an earlier term's Collected
-- and must not be counted twice).
--
-- Run this once in the Supabase SQL editor. Idempotent (safe to re-run) —
-- the one data-writing statement (the opening-balance backfill) only ever
-- inserts for a student with zero existing ledger rows.

create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  student_id uuid not null references public.students(id),
  -- The term this naira was actually collected in. Null means "predates this
  -- ledger / origin unknown" — never matches any real cycle_id, so it can
  -- never be counted as "collected this term" for any term.
  origin_cycle_id uuid references public.billing_cycles(id),
  amount numeric(12,2) not null check (amount > 0),
  remaining numeric(12,2) not null check (remaining >= 0),
  source text not null,
  created_at timestamptz not null default now()
);

create index if not exists credit_ledger_student_idx on public.credit_ledger (student_id, created_at);
create index if not exists credit_ledger_school_idx on public.credit_ledger (school_id);

create table if not exists public.credit_consumption_log (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  student_id uuid not null references public.students(id),
  ledger_id uuid not null references public.credit_ledger(id),
  -- The lot's own origin — denormalized here (not just joinable via
  -- ledger_id) so a lot can be deleted-and-recreated-with-same-id-never
  -- without ever invalidating history; also makes the Collected query a
  -- single-table aggregate instead of a join.
  origin_cycle_id uuid references public.billing_cycles(id),
  -- The invoice this spend was applied to. Null for a spend that left the
  -- student's balance without landing on any invoice (e.g. a cash refund of
  -- credit, or a reversed manual credit entry) — irrelevant to "credit
  -- applied this term" since nothing shows up on invoices.credit_applied in
  -- that case, but still recorded so the ledger's own history is complete.
  invoice_id uuid references public.invoices(id),
  amount numeric(12,2) not null check (amount > 0),
  created_at timestamptz not null default now()
);

create index if not exists credit_consumption_invoice_idx on public.credit_consumption_log (invoice_id);
create index if not exists credit_consumption_student_idx on public.credit_consumption_log (student_id, created_at);

-- Row-level security: staff never read/write these tables directly — every
-- access goes through the SECURITY DEFINER functions below or the
-- school-scoped read used by getCreditAppliedForTerm. Enabling RLS with no
-- policies blocks all direct client access by default, matching the posture
-- already used for other ledger-shaped tables in this schema.
alter table public.credit_ledger enable row level security;
alter table public.credit_consumption_log enable row level security;

drop policy if exists "Staff reads their school's credit ledger" on public.credit_ledger;
create policy "Staff reads their school's credit ledger"
  on public.credit_ledger for select
  using (school_id = public.current_school_id() or public.is_super_admin());

drop policy if exists "Staff reads their school's credit consumption log" on public.credit_consumption_log;
create policy "Staff reads their school's credit consumption log"
  on public.credit_consumption_log for select
  using (school_id = public.current_school_id() or public.is_super_admin());

-- One-time backfill: every student with an existing credit_balance gets a
-- single opening lot for whatever they're already carrying, origin_cycle_id
-- null (pre-dates per-term tracking — correctly never counted as "collected
-- this term" for any term, which is the safe default for money we can no
-- longer attribute). Guarded so it only ever seeds a student once.
insert into public.credit_ledger (school_id, student_id, origin_cycle_id, amount, remaining, source)
select s.school_id, s.id, null, s.credit_balance, s.credit_balance, 'opening_balance'
from public.students s
where s.credit_balance > 0
  and not exists (select 1 from public.credit_ledger cl where cl.student_id = s.id);

-- Adds a new lot of credit for a student, tagged with the school's currently
-- active term — the term this money actually arrived in. Returns the new
-- lot's id (not currently used by any caller, but cheap and matches this
-- schema's convention of returning the row just written).
create or replace function public.credit_ledger_add_lot(
  p_school_id uuid,
  p_student_id uuid,
  p_amount numeric,
  p_source text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cycle_id uuid;
  v_lot_id uuid;
begin
  if p_amount is null or p_amount <= 0 then
    return null;
  end if;

  select id into v_cycle_id
  from billing_cycles
  where school_id = p_school_id and status = 'active'
  limit 1;

  insert into credit_ledger (school_id, student_id, origin_cycle_id, amount, remaining, source)
  values (p_school_id, p_student_id, v_cycle_id, p_amount, p_amount, p_source)
  returning id into v_lot_id;

  return v_lot_id;
end;
$$;

-- Spends credit FIFO (oldest lot first) with no invoice to attribute it to —
-- used for a plain balance debit (e.g. refunding credit back out as cash).
-- Silently caps at whatever remains in the ledger if it's ever short of
-- p_amount (it shouldn't be, since the ledger is kept in lockstep with
-- students.credit_balance by every caller below) rather than raising and
-- blocking the real money movement that already happened.
create or replace function public.credit_ledger_consume(
  p_school_id uuid,
  p_student_id uuid,
  p_amount numeric,
  p_source text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_remaining_to_consume numeric;
  v_lot record;
  v_take numeric;
begin
  if p_amount is null or p_amount <= 0 then
    return;
  end if;
  v_remaining_to_consume := p_amount;

  for v_lot in
    select id, remaining, origin_cycle_id
    from credit_ledger
    where student_id = p_student_id and school_id = p_school_id and remaining > 0
    order by created_at asc
    for update
  loop
    exit when v_remaining_to_consume <= 0;
    v_take := least(v_lot.remaining, v_remaining_to_consume);

    update credit_ledger set remaining = remaining - v_take where id = v_lot.id;
    insert into credit_consumption_log (school_id, student_id, ledger_id, origin_cycle_id, invoice_id, amount)
    values (p_school_id, p_student_id, v_lot.id, v_lot.origin_cycle_id, null, v_take);

    v_remaining_to_consume := v_remaining_to_consume - v_take;
  end loop;
end;
$$;

-- The core of this migration: keeps one invoice's slice of the ledger in
-- sync with its current credit_applied value. Called every time an invoice's
-- credit_applied is set or changed (initial generation, recompute, a
-- discount being applied/revoked) — regardless of which code path did it.
--
-- Always fully reverses whatever this invoice previously drew (giving it
-- back to the lots it came from) and re-draws p_new_credit_applied fresh via
-- FIFO. This "undo everything, redo from the new total" approach is what
-- makes it safe to call repeatedly on the same invoice as it's recomputed
-- over its life, without this function needing to know what changed —
-- only the invoice's final credit_applied value matters.
create or replace function public.credit_ledger_sync_invoice(
  p_school_id uuid,
  p_student_id uuid,
  p_invoice_id uuid,
  p_new_credit_applied numeric
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
begin
  for v_row in
    select ledger_id, amount
    from credit_consumption_log
    where invoice_id = p_invoice_id
  loop
    update credit_ledger set remaining = remaining + v_row.amount where id = v_row.ledger_id;
  end loop;
  delete from credit_consumption_log where invoice_id = p_invoice_id;

  if p_new_credit_applied is null or p_new_credit_applied <= 0 then
    return;
  end if;

  declare
    v_remaining_to_consume numeric := p_new_credit_applied;
    v_lot record;
    v_take numeric;
  begin
    for v_lot in
      select id, remaining, origin_cycle_id
      from credit_ledger
      where student_id = p_student_id and school_id = p_school_id and remaining > 0
      order by created_at asc
      for update
    loop
      exit when v_remaining_to_consume <= 0;
      v_take := least(v_lot.remaining, v_remaining_to_consume);

      update credit_ledger set remaining = remaining - v_take where id = v_lot.id;
      insert into credit_consumption_log (school_id, student_id, ledger_id, origin_cycle_id, invoice_id, amount)
      values (p_school_id, p_student_id, v_lot.id, v_lot.origin_cycle_id, p_invoice_id, v_take);

      v_remaining_to_consume := v_remaining_to_consume - v_take;
    end loop;
  end;
end;
$$;

-- Moves credit between siblings (transfer_family_credit_balance's ledger
-- counterpart) preserving each naira's real origin term — the point of the
-- whole ledger would be lost if a transfer just created a fresh "now" lot
-- for the destination, since the money didn't just arrive now.
create or replace function public.credit_ledger_transfer(
  p_school_id uuid,
  p_from_student_id uuid,
  p_to_student_id uuid,
  p_amount numeric
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_remaining_to_consume numeric;
  v_lot record;
  v_take numeric;
begin
  if p_amount is null or p_amount <= 0 then
    return;
  end if;
  v_remaining_to_consume := p_amount;

  for v_lot in
    select id, remaining, origin_cycle_id
    from credit_ledger
    where student_id = p_from_student_id and school_id = p_school_id and remaining > 0
    order by created_at asc
    for update
  loop
    exit when v_remaining_to_consume <= 0;
    v_take := least(v_lot.remaining, v_remaining_to_consume);

    update credit_ledger set remaining = remaining - v_take where id = v_lot.id;
    insert into credit_consumption_log (school_id, student_id, ledger_id, origin_cycle_id, invoice_id, amount)
    values (p_school_id, p_from_student_id, v_lot.id, v_lot.origin_cycle_id, null, v_take);

    insert into credit_ledger (school_id, student_id, origin_cycle_id, amount, remaining, source)
    values (p_school_id, p_to_student_id, v_lot.origin_cycle_id, v_take, v_take, 'family_transfer');

    v_remaining_to_consume := v_remaining_to_consume - v_take;
  end loop;
end;
$$;

-- apply_invoice_recompute, now also keeping the ledger in sync. Everything
-- above the new call at the bottom is unchanged from
-- add_atomic_invoice_credit_functions.sql.
create or replace function public.apply_invoice_recompute(
  p_invoice_id uuid,
  p_school_id uuid,
  p_student_id uuid,
  p_line_items jsonb,
  p_subtotal numeric,
  p_discount_amount numeric,
  p_discount_reason text,
  p_previous_balance numeric,
  p_previous_balance_from_invoice_id uuid,
  p_credit_applied numeric,
  p_total_amount numeric,
  p_status text,
  p_needs_resend boolean,
  p_credit_delta numeric
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update invoices
  set
    line_items = p_line_items,
    subtotal = p_subtotal,
    discount_amount = coalesce(p_discount_amount, discount_amount),
    discount_reason = coalesce(p_discount_reason, discount_reason),
    previous_balance = p_previous_balance,
    previous_balance_from_invoice_id = p_previous_balance_from_invoice_id,
    credit_applied = p_credit_applied,
    total_amount = p_total_amount,
    status = p_status,
    needs_resend = p_needs_resend,
    updated_at = now()
  where id = p_invoice_id and school_id = p_school_id;

  if not found then
    raise exception 'Invoice % not found for school %', p_invoice_id, p_school_id;
  end if;

  if p_credit_delta <> 0 then
    perform adjust_student_credit_balance(
      p_student_id => p_student_id,
      p_school_id => p_school_id,
      p_delta => p_credit_delta
    );
  end if;

  perform credit_ledger_sync_invoice(p_school_id, p_student_id, p_invoice_id, p_credit_applied);
end;
$$;

-- insert_generated_invoice, now also keeping the ledger in sync.
create or replace function public.insert_generated_invoice(
  p_school_id uuid,
  p_student_id uuid,
  p_billing_cycle_id uuid,
  p_invoice_number text,
  p_line_items jsonb,
  p_subtotal numeric,
  p_discount_amount numeric,
  p_discount_reason text,
  p_previous_balance numeric,
  p_previous_balance_from_invoice_id uuid,
  p_credit_applied numeric,
  p_total_amount numeric,
  p_status text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice_id uuid;
begin
  insert into invoices (
    school_id, student_id, billing_cycle_id, invoice_number,
    line_items, subtotal, discount_amount, discount_reason,
    previous_balance, previous_balance_from_invoice_id,
    credit_applied, total_amount, paid_amount, status,
    sent_at, needs_resend, generated_at
  ) values (
    p_school_id, p_student_id, p_billing_cycle_id, p_invoice_number,
    p_line_items, p_subtotal, p_discount_amount, p_discount_reason,
    p_previous_balance, p_previous_balance_from_invoice_id,
    p_credit_applied, p_total_amount, 0, p_status,
    null, false, now()
  )
  returning id into v_invoice_id;

  if p_credit_applied <> 0 then
    perform adjust_student_credit_balance(
      p_student_id => p_student_id,
      p_school_id => p_school_id,
      p_delta => -p_credit_applied
    );
  end if;

  perform credit_ledger_sync_invoice(p_school_id, p_student_id, v_invoice_id, p_credit_applied);

  return v_invoice_id;
end;
$$;

-- insert_credit_balance_payment, now also writing/spending a lot. Signature
-- matches the live version (db/manual_payment_entry.sql's, with
-- p_provider_fee and p_recorded_by) — CREATE OR REPLACE can't change this,
-- so it's repeated here in full rather than just adding a call.
create or replace function public.insert_credit_balance_payment(
  p_school_id uuid,
  p_student_id uuid,
  p_amount numeric,
  p_method text,
  p_provider text,
  p_provider_reference text,
  p_provider_transaction_id text,
  p_paid_at timestamptz,
  p_notes text,
  p_provider_fee numeric default null,
  p_recorded_by uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment_id uuid;
begin
  insert into payments (
    school_id, student_id, invoice_id, amount, method, provider,
    provider_reference, provider_transaction_id, paid_at, match_status, notes,
    provider_fee, recorded_by
  ) values (
    p_school_id, p_student_id, null, p_amount, p_method, p_provider,
    p_provider_reference, p_provider_transaction_id, p_paid_at, 'matched', p_notes,
    p_provider_fee, p_recorded_by
  )
  returning id into v_payment_id;

  perform adjust_student_credit_balance(
    p_student_id => p_student_id,
    p_school_id => p_school_id,
    p_delta => p_amount
  );

  if p_amount > 0 then
    perform credit_ledger_add_lot(p_school_id, p_student_id, p_amount, 'overpayment');
  elsif p_amount < 0 then
    perform credit_ledger_consume(p_school_id, p_student_id, -p_amount, 'balance_debit');
  end if;

  return v_payment_id;
end;
$$;

-- transfer_family_credit_balance, now moving ledger lots (with their origin
-- term preserved) alongside the balance.
create or replace function public.transfer_family_credit_balance(
  p_school_id uuid,
  p_from_student_id uuid,
  p_to_student_id uuid,
  p_amount numeric
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from_family uuid;
  v_to_family uuid;
  v_from_balance numeric;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Transfer amount must be positive';
  end if;

  if p_from_student_id = p_to_student_id then
    raise exception 'Cannot transfer credit to the same student';
  end if;

  select family_id, credit_balance into v_from_family, v_from_balance
    from students
    where id = p_from_student_id and school_id = p_school_id
    for update;

  if v_from_family is null then
    raise exception 'Source student not found in this school';
  end if;

  select family_id into v_to_family
    from students
    where id = p_to_student_id and school_id = p_school_id
    for update;

  if v_to_family is null then
    raise exception 'Destination student not found in this school';
  end if;

  if v_from_family is distinct from v_to_family then
    raise exception 'Both students must belong to the same family';
  end if;

  if v_from_balance < p_amount then
    raise exception 'Amount exceeds the source student''s available credit balance';
  end if;

  perform adjust_student_credit_balance(
    p_student_id => p_from_student_id,
    p_school_id => p_school_id,
    p_delta => -p_amount
  );
  perform adjust_student_credit_balance(
    p_student_id => p_to_student_id,
    p_school_id => p_school_id,
    p_delta => p_amount
  );

  perform credit_ledger_transfer(p_school_id, p_from_student_id, p_to_student_id, p_amount);
end;
$$;
