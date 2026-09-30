-- Data & privacy — Phase 2: scheduled account deletion.
--
-- Backs Settings → Data & privacy (owner-only). When an owner confirms closing
-- their account, a row is written here and every staff login is deactivated
-- immediately (see the requestAccountDeletion action). The account then sits in
-- a cancellable grace window; a daily cron (/api/admin/purge-deletions) calls
-- archive_and_delete_school() once the window elapses to permanently erase
-- personal data while keeping anonymised financial records for the statutory
-- retention period, after which purge_expired_financials() removes those too.
--
-- Run this once in the Supabase SQL editor. Idempotent (safe to re-run).

-- ---------------------------------------------------------------------------
-- 1. Deletion requests — the durable record of "who asked to close, and when"
-- ---------------------------------------------------------------------------
-- Deliberately NOT foreign-keyed to schools/users: the whole point is that the
-- school and its users get deleted on completion, and this row must survive as
-- an audit/admin record afterwards. School/user identity is snapshotted below.
create table if not exists public.school_deletion_requests (
  id                   uuid primary key default gen_random_uuid(),
  school_id            uuid not null,
  school_name          text not null,          -- snapshot; survives school deletion
  status               text not null default 'scheduled'
                         check (status in ('scheduled','cancelled','completed')),
  requested_by         uuid,                   -- users.id at request time (no FK)
  requested_by_name    text,
  requested_by_email   text,
  acknowledgement      text,                   -- the exact consent text accepted (evidence)
  scheduled_for        timestamptz not null,   -- personal data purged on/after this
  financial_purge_at   timestamptz not null,   -- anonymised financials purged on/after this
  created_at           timestamptz not null default now(),
  cancelled_at         timestamptz,
  cancelled_by         text,                   -- admin identifier / note (Fees101-side)
  completed_at         timestamptz,
  archived_record_count integer
);

create index if not exists school_deletion_requests_status_idx
  on public.school_deletion_requests (status, scheduled_for);

-- At most one live (scheduled) request per school.
create unique index if not exists school_deletion_requests_one_active
  on public.school_deletion_requests (school_id)
  where status = 'scheduled';

alter table public.school_deletion_requests enable row level security;

-- Owners/staff of a school may read their own school's requests (so the app can
-- show the "scheduled for deletion" state). Writes happen only via the service
-- role (the server action / cron), which bypasses RLS — so there are no
-- insert/update/delete policies for regular users.
drop policy if exists "Users see own school deletion requests" on public.school_deletion_requests;
create policy "Users see own school deletion requests"
  on public.school_deletion_requests for select
  using ((school_id = public.current_school_id()) or public.is_super_admin());

drop policy if exists "Super admin manages all deletion requests" on public.school_deletion_requests;
create policy "Super admin manages all deletion requests"
  on public.school_deletion_requests
  using (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- 2. Anonymised financial archive — kept post-deletion for tax/audit
-- ---------------------------------------------------------------------------
-- No student or parent names, no free-text (which could carry a name). Just the
-- numbers, references, dates and pseudonymous grouping ids (original invoice /
-- student uuids — meaningless once the source rows are gone). This is Fees101's
-- own record of B2B transaction history, not the personal data being erased.
create table if not exists public.archived_financials (
  id                 uuid primary key default gen_random_uuid(),
  original_school_id uuid not null,             -- pseudonymous grouping key
  school_name        text,                      -- business name (not a person)
  record_type        text not null check (record_type in ('invoice','payment')),
  original_id        uuid,                       -- original invoice/payment id
  student_ref        uuid,                       -- original student id (pseudonymous)
  invoice_ref        uuid,                       -- payments: the invoice id
  reference          text,                       -- invoice_number | provider_reference
  amount             numeric,
  status             text,
  method             text,                       -- payments only
  provider           text,                       -- payments only
  occurred_at        timestamptz,                -- generated_at | paid_at
  archived_at        timestamptz not null default now(),
  purge_after        timestamptz not null
);

create index if not exists archived_financials_school_idx
  on public.archived_financials (original_school_id);
create index if not exists archived_financials_purge_idx
  on public.archived_financials (purge_after);

alter table public.archived_financials enable row level security;
-- Service-role only. No policies for regular users: once archived, this data
-- belongs to Fees101's retention store, not to any live school account.
drop policy if exists "Super admin reads archived financials" on public.archived_financials;
create policy "Super admin reads archived financials"
  on public.archived_financials
  using (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- 3. archive_and_delete_school(school_id, purge_after)
-- ---------------------------------------------------------------------------
-- Transactional: archives anonymised financials, then hard-deletes every
-- school-scoped row in FK-dependency order (children before parents), finishing
-- with the schools row itself. If any FK blocks a delete the whole call rolls
-- back cleanly — nothing is half-deleted. Returns the number of archived rows.
--
-- Does NOT touch auth.users: the cron deletes those via the Auth admin API
-- after this returns (the public.users rows are removed here).
create or replace function public.archive_and_delete_school(
  p_school_id uuid,
  p_purge_after timestamptz
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school_name text;
  v_archived integer := 0;
  v_count integer;
begin
  select name into v_school_name from public.schools where id = p_school_id;
  if v_school_name is null then
    raise exception 'archive_and_delete_school: school % not found', p_school_id;
  end if;

  -- --- Archive invoices (numbers/status/dates only; no line-item names, no
  -- discount_reason free-text) ---
  insert into public.archived_financials
    (original_school_id, school_name, record_type, original_id, student_ref,
     invoice_ref, reference, amount, status, occurred_at, purge_after)
  select p_school_id, v_school_name, 'invoice', i.id, i.student_id,
         null, i.invoice_number::text, i.total_amount, i.status,
         coalesce(i.generated_at, i.created_at), p_purge_after
  from public.invoices i
  where i.school_id = p_school_id;
  get diagnostics v_count = row_count;
  v_archived := v_archived + v_count;

  -- --- Archive payments (drop sender_name / notes free-text) ---
  insert into public.archived_financials
    (original_school_id, school_name, record_type, original_id, student_ref,
     invoice_ref, reference, amount, status, method, provider, occurred_at, purge_after)
  select p_school_id, v_school_name, 'payment', p.id, p.student_id,
         p.invoice_id, p.provider_reference, p.amount, p.match_status,
         p.method, p.provider, coalesce(p.paid_at, p.created_at), p_purge_after
  from public.payments p
  where p.school_id = p_school_id;
  get diagnostics v_count = row_count;
  v_archived := v_archived + v_count;

  -- --- Break self-referential FKs first, so a bulk delete can't trip a
  -- RESTRICT check on a row that references another row in the same set. ---
  update public.classes        set next_class_id = null                 where school_id = p_school_id;
  update public.billing_cycles set rolled_forward_from_id = null        where school_id = p_school_id;
  update public.invoices       set previous_balance_from_invoice_id = null where school_id = p_school_id;

  -- --- Hard-delete, children before parents ---
  delete from public.admin_notifications            where school_id = p_school_id;
  delete from public.message_logs                   where school_id = p_school_id;
  delete from public.payments                        where school_id = p_school_id;
  delete from public.discounts                        where school_id = p_school_id;
  delete from public.student_fee_adjustments          where school_id = p_school_id;
  -- rollover_promotions has no school_id; it links to a school only through
  -- rollover_runs.run_id. Delete it first (children), then the runs (parents).
  delete from public.rollover_promotions
    where run_id in (select id from public.rollover_runs where school_id = p_school_id);
  delete from public.rollover_runs                    where school_id = p_school_id;
  delete from public.webhook_events                   where school_id = p_school_id;
  delete from public.processed_provider_transactions  where school_id = p_school_id;
  delete from public.report_downloads                 where school_id = p_school_id;
  delete from public.audit_log                        where school_id = p_school_id;
  delete from public.invoices                          where school_id = p_school_id;
  delete from public.fee_items                         where school_id = p_school_id;
  delete from public.students                          where school_id = p_school_id;
  delete from public.billing_cycles                    where school_id = p_school_id;
  delete from public.sessions                          where school_id = p_school_id;
  delete from public.classes                           where school_id = p_school_id;
  delete from public.sections                          where school_id = p_school_id;
  delete from public.families                          where school_id = p_school_id;
  delete from public.users                             where school_id = p_school_id;
  delete from public.roles                             where school_id = p_school_id;
  delete from public.schools                           where id = p_school_id;

  return v_archived;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. purge_expired_financials() — remove archived rows past their retention
-- ---------------------------------------------------------------------------
create or replace function public.purge_expired_financials()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  delete from public.archived_financials where purge_after <= now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
