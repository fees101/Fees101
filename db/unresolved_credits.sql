-- Persisted marker for "leave as-is" opt-out overages (2026-09-16 stress
-- test): when a truly-locked paid invoice's opt-out clawback is resolved by
-- leaving the already-paid amount alone (intended for a manual/cash refund
-- outside the app — see the comment on resolveDeferredOptOutOverage), that
-- amount used to leave no trace anywhere queryable except a one-line audit
-- log entry. This table gives it a real, findable record until someone
-- marks it resolved.
--
-- Deliberately separate from students.credit_balance: that balance is
-- auto-applied to the student's next invoice, which is the opposite of what
-- "leave as-is" means here (the family is meant to get cash back, not an
-- automatic future-fee discount) — see RequestDiscountModal/StudentFeesTab
-- for the existing credit_balance flow.
--
-- Run this once in the Supabase SQL editor.

create table if not exists public.unresolved_credits (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references public.schools(id) on delete cascade,
  student_id    uuid not null references public.students(id) on delete cascade,
  fee_item_name text not null,
  amount        numeric(12,2) not null,
  created_at    timestamptz not null default now(),
  created_by    uuid references public.users(id) on delete set null,
  resolved_at   timestamptz,
  resolved_by   uuid references public.users(id) on delete set null
);

create index if not exists unresolved_credits_school_open_idx
  on public.unresolved_credits (school_id, resolved_at);

create index if not exists unresolved_credits_student_idx
  on public.unresolved_credits (student_id);

alter table public.unresolved_credits enable row level security;

-- Same access model as audit_log/report_downloads: a user sees/creates rows
-- for their own school; super_admins see everything.
create policy "Users see own school unresolved credits"
  on public.unresolved_credits for select
  using ((school_id = public.current_school_id()) or public.is_super_admin());

create policy "Users create own school unresolved credits"
  on public.unresolved_credits for insert
  with check ((school_id = public.current_school_id()) or public.is_super_admin());

create policy "Users resolve own school unresolved credits"
  on public.unresolved_credits for update
  using ((school_id = public.current_school_id()) or public.is_super_admin())
  with check ((school_id = public.current_school_id()) or public.is_super_admin());

create policy "Super admin manages all unresolved credits"
  on public.unresolved_credits
  using (public.is_super_admin());
