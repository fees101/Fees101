-- Fees: replace the is_recurring boolean on fee_items with a 3-way billing
-- frequency, so schools can express the real Nigerian pattern of once-a-year
-- fees (development levy, PTA, external-exam registration) that bill in First
-- Term only and reappear on their own at the next year's rollover.
--
--   per_term        billed on every term's invoice          (old is_recurring = true)
--   once_a_session  billed once per academic year, on the session's first term;
--                   carries forward ONLY when a new term crosses into a NEW
--                   session (year-end rollover), never onto sibling terms
--   this_term_only  billed once, never carries               (old is_recurring = false)
--
-- The old is_recurring column is kept and held in sync (false only for
-- this_term_only) so any reader that hasn't moved over yet stays correct. It
-- can be dropped in a later cleanup once billing_frequency is verified in prod.

alter table public.fee_items
  add column if not exists billing_frequency text not null default 'per_term';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'fee_items_billing_frequency_check'
  ) then
    alter table public.fee_items
      add constraint fee_items_billing_frequency_check
      check (billing_frequency in ('per_term', 'once_a_session', 'this_term_only'));
  end if;
end $$;

-- Backfill from the boolean it replaces. Idempotent: only rewrites rows still
-- at the default that contradict their is_recurring value, so a re-run is a
-- no-op and a school that has already set once_a_session is left untouched.
update public.fee_items
  set billing_frequency = 'this_term_only'
  where is_recurring = false and billing_frequency = 'per_term';
