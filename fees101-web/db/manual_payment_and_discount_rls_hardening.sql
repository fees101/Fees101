-- Data-layer hardening for the manual-payments and discounts approval features,
-- from a multi-user QA pass + code audit. Everything the server actions already
-- enforce is pushed down to the database so a direct PostgREST call (bypassing
-- the app) can no longer slip past it. Idempotent: safe to re-run.
--
-- Covers:
--   QA-H1  reversal INSERT was blocked for a pure approver (RLS wanted
--          record-manual-payments; a reversal should want approve-manual-payments)
--   QA-H3  a direct insert could set status='approved' and render as settled
--   QA-H4  reference / reversal-reason / amount-sign were only checked in the app
--   QA-H2  discounts had no permission-based INSERT policy (stale role-text one)
--   LOW    widen the immutability guard to the recorded-fact columns
--   HIGH   a DELETE policy so the owner auto-approve path can clean up a pending
--          row whose atomic apply rolled back (see the matching action change)

-- ===========================================================================
-- 1. manual_payment_requests INSERT policy — branch by row type (QA-H1),
--    force every direct insert to start pending (QA-H3), keep the feature +
--    liability gate. A normal entry (reversal_of IS NULL) needs
--    record-manual-payments; a reversal (reversal_of IS NOT NULL) needs
--    approve-manual-payments; the owner may do either; super admin bypasses.
-- ===========================================================================
drop policy if exists "Record-manual-payments inserts requests" on public.manual_payment_requests;
drop policy if exists "Manual payment requests insert by type" on public.manual_payment_requests;
create policy "Manual payment requests insert by type"
  on public.manual_payment_requests for insert
  with check (
    (
      school_id = public.current_school_id()
      -- QA-H3: only the SECURITY DEFINER approval RPCs may ever reach
      -- 'approved'; a direct insert must start pending.
      and status = 'pending'
      and (
        public.is_school_owner()
        or (reversal_of is null and public.has_permission('record-manual-payments'))
        or (reversal_of is not null and public.has_permission('approve-manual-payments'))
      )
      and exists (
        select 1 from public.schools s
        where s.id = school_id
          and s.manual_payment_entry_enabled = true
          and s.manual_payment_liability_version is not null
          and s.manual_payment_liability_accepted_at is not null
      )
    )
    or public.is_super_admin()
  );

-- ===========================================================================
-- 2. manual_payment_requests data-integrity CHECKs (QA-H4). Added NOT VALID so
--    the migration never fails on pre-existing QA test rows; every NEW insert
--    or update is still enforced immediately. The owner can VALIDATE them after
--    clearing any bad test data:
--      alter table public.manual_payment_requests validate constraint <name>;
--    These apply to EVERYONE (owner included) and sit below RLS, so they cannot
--    be bypassed from the client. The approval RPCs never touch these columns,
--    so they are unaffected.
-- ===========================================================================

-- A normal entry carries a positive amount; a reversal carries the negated
-- original (strictly negative). Supersedes/strengthens the inline amount <> 0.
alter table public.manual_payment_requests
  drop constraint if exists manual_payment_requests_amount_sign_chk;
alter table public.manual_payment_requests
  add constraint manual_payment_requests_amount_sign_chk
  check (
    (reversal_of is null and amount > 0)
    or (reversal_of is not null and amount < 0)
  ) not valid;

-- A normal entry must carry a real deposit_reference (>= 3 chars) as proof;
-- a reversal has none (it carries a reason in notes instead, below).
alter table public.manual_payment_requests
  drop constraint if exists manual_payment_requests_reference_chk;
alter table public.manual_payment_requests
  add constraint manual_payment_requests_reference_chk
  check (
    reversal_of is not null
    or (deposit_reference is not null and char_length(btrim(deposit_reference)) >= 3)
  ) not valid;

-- A reversal must carry a reason (>= 5 chars) in notes; a normal entry's notes
-- stay optional.
alter table public.manual_payment_requests
  drop constraint if exists manual_payment_requests_reversal_reason_chk;
alter table public.manual_payment_requests
  add constraint manual_payment_requests_reversal_reason_chk
  check (
    reversal_of is null
    or (notes is not null and char_length(btrim(notes)) >= 5)
  ) not valid;

-- ===========================================================================
-- 3. manual_payment_requests DELETE policy (HIGH). The owner auto-approve path
--    inserts a pending row and then applies it in a SEPARATE transaction; if
--    the apply RPC rolls back, the pending row is orphaned (and, for a reversal,
--    the one-active-reversal unique index then blocks any retry). The action now
--    deletes that stranded row, which needs a policy: a user may delete only a
--    STILL-PENDING row they raised themselves (so an applied/approved row can
--    never be deleted this way). Super admin bypasses.
-- ===========================================================================
drop policy if exists "Delete own pending manual payment request" on public.manual_payment_requests;
create policy "Delete own pending manual payment request"
  on public.manual_payment_requests for delete
  using (
    (
      school_id = public.current_school_id()
      and status = 'pending'
      and requested_by = auth.uid()
    )
    or public.is_super_admin()
  );

-- ===========================================================================
-- 4. Immutability guard (LOW) — freeze the recorded-fact columns too (method,
--    deposited_to, deposit_reference, notes) for defence in depth, and pin
--    payment_id so it can only ever be stamped during the approval RPC's
--    approved -> approved second update (never on a pending transition). The
--    legal pending -> approved / pending -> rejected status writes the RPCs and
--    the reject action perform are untouched.
-- ===========================================================================
create or replace function public.manual_payment_requests_guard()
returns trigger
language plpgsql
as $$
begin
  -- Money, identity and the recorded facts of the payment can never change in
  -- place; a mistake is corrected with a reversal.
  if (new.amount is distinct from old.amount)
     or (new.student_id is distinct from old.student_id)
     or (new.invoice_id is distinct from old.invoice_id)
     or (new.requested_by is distinct from old.requested_by)
     or (new.reversal_of is distinct from old.reversal_of)
     or (new.method is distinct from old.method)
     or (new.deposited_to is distinct from old.deposited_to)
     or (new.deposit_reference is distinct from old.deposit_reference)
     or (new.notes is distinct from old.notes) then
    raise exception 'A recorded manual payment cannot be edited in place; correct it with a reversal instead';
  end if;

  if old.status = 'pending' then
    if new.status not in ('approved', 'rejected') then
      raise exception 'A manual payment request can only move from pending to approved or rejected';
    end if;
    -- payment_id is stamped only in the approval RPC's second update (while the
    -- row is already 'approved'); it must never appear on a pending transition.
    if new.payment_id is distinct from old.payment_id then
      raise exception 'A manual payment''s ledger reference is set only when it is applied';
    end if;
  elsif old.status = 'approved' and new.status = 'approved' then
    -- payment_id stamp from the approval function only; nothing else may change.
    if (new.reviewed_by is distinct from old.reviewed_by)
       or (new.reviewed_by_name is distinct from old.reviewed_by_name)
       or (new.reviewed_at is distinct from old.reviewed_at)
       or (new.auto_approved is distinct from old.auto_approved)
       or (new.review_note is distinct from old.review_note) then
      raise exception 'An approved manual payment is immutable';
    end if;
  else
    raise exception 'A % manual payment request cannot be modified', old.status;
  end if;

  return new;
end;
$$;

drop trigger if exists manual_payment_requests_guard on public.manual_payment_requests;
create trigger manual_payment_requests_guard
  before update on public.manual_payment_requests
  for each row execute function public.manual_payment_requests_guard();

-- ===========================================================================
-- 5. discounts INSERT policy (QA-H2 + QA-H3). The only INSERT policy was the
--    stale "Bursar can request discounts" one gated on the legacy users.role
--    text (pre Roles & Permissions), so it no longer matched the real permission
--    model. Replace it with a permission-based one with TWO branches:
--
--      (a) A manual discount REQUEST (requestDiscount): must start pending and be
--          attributed to the requester (requested_by = the caller). Needs
--          request-discounts / approve-discounts / owner. This is the QA-H2/H3
--          fix: a no-access user can no longer insert a pending request, and no
--          direct insert can start anywhere but pending.
--
--      (b) A system-generated APPLIED discount (sibling, recurring carry-forward,
--          recompute) written by the server-side invoice + discount engine via
--          recordAppliedDiscounts(). These carry no requester (requested_by IS
--          NULL) and are reached only through the invoice / fee / student /
--          approval / year-end surfaces, so they are gated by those same
--          permissions (owner always). Without this branch the status='pending'
--          rule would break ordinary invoice generation with discounts, the
--          owner included. request-discounts is deliberately NOT in this branch,
--          so a pure requester still cannot fabricate an applied (self-approved)
--          row directly.
--
--    Super admin keeps its own separate FOR ALL policy.
-- ===========================================================================
drop policy if exists "Bursar can request discounts" on public.discounts;
drop policy if exists "Request-discounts inserts discounts" on public.discounts;
create policy "Request-discounts inserts discounts"
  on public.discounts for insert
  with check (
    (
      school_id = public.current_school_id()
      and (
        -- (a) manual request
        (
          status = 'pending'
          and requested_by = auth.uid()
          and (
            public.is_school_owner()
            or public.has_permission('request-discounts')
            or public.has_permission('approve-discounts')
          )
        )
        -- (b) system-generated applied discount
        or (
          requested_by is null
          and (
            public.is_school_owner()
            or public.has_permission('manage-invoices')
            or public.has_permission('manage-fee-structure')
            or public.has_permission('manage-students')
            or public.has_permission('approve-discounts')
            or public.has_permission('run-year-end')
            or public.has_permission('manage-payment-config')
          )
        )
      )
    )
    or public.is_super_admin()
  );

notify pgrst, 'reload schema';
