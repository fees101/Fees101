-- Let a flagged-payment notification point at the actual student/family it's
-- about, so the school can open that student directly instead of only reading
-- a reference number in free text. Nullable: a notification type with no
-- natural owner (none currently) just leaves both null.
--
-- on delete set null (not cascade): a withdrawn/deleted student shouldn't take
-- the notification history down with them — the amount/reference in `body`
-- still means something even if the student record is gone.
--
-- Also adds `amount` (the real paid amount, numeric): "View student" alone
-- still leaves the school hunting through that student's whole history for
-- the one transaction. The Record feed's search can match a payment EXACTLY
-- by amount (applySearch in activity.ts), so storing the real figure here lets
-- the review page deep-link straight to that payment (amount + the day it
-- happened), not just the general student page. Historical rows predating
-- this column stay null and fall back to the plain "Open full Record" link.
--
-- Additive, idempotent. Run once in the Supabase SQL editor.

alter table public.admin_notifications
  add column if not exists student_id uuid references public.students(id) on delete set null,
  add column if not exists family_id uuid references public.families(id) on delete set null,
  add column if not exists amount numeric;

create index if not exists admin_notifications_student_id_idx on public.admin_notifications(student_id) where student_id is not null;
create index if not exists admin_notifications_family_id_idx on public.admin_notifications(family_id) where family_id is not null;

notify pgrst, 'reload schema';
