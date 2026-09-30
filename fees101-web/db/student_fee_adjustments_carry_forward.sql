-- Opt-out on a paid invoice (ROADMAP.md, decided 2026-09-15): opting a
-- student out of a fee they've already paid for this term must not touch
-- the paid invoice. Instead the opt-in row stays in place for this cycle
-- (an accurate record of what was charged and paid) but is flagged to not
-- carry forward, so the fee simply stops recurring from next term.
--
-- Run this once against the school's Supabase project.

alter table public.student_fee_adjustments
  add column if not exists carry_forward boolean not null default true;
