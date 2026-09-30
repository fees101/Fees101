-- Run this once in the Supabase SQL editor.
--
-- Marks a student_fee_adjustments row as system-filled (propagated forward
-- into a future term that had no adjustment of its own yet) vs admin-set
-- directly. Lets the forward-propagation feature retract a stale auto-filled
-- row later (e.g. the source opt-in is undone) without ever touching a row
-- an admin explicitly set on that future term themselves.
alter table public.student_fee_adjustments
  add column if not exists auto_propagated boolean not null default false;
