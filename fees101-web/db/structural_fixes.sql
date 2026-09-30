-- Structural/data-integrity fixes found during the post-RLS table review.
-- Nothing here touches permissions or RLS. Idempotent: safe to re-run.

-- 1. billing_cycles / sessions / discounts: "only one active/pending row"
--    is currently enforced only by app code (read-then-update), with no
--    database backstop. A double-click or two open tabs can create two
--    "active" rows. Same pattern already used correctly for
--    school_deletion_requests (db/data_privacy.sql).
create unique index if not exists billing_cycles_one_active
  on public.billing_cycles (school_id) where status = 'active';

create unique index if not exists sessions_one_active
  on public.sessions (school_id) where status = 'active';

create unique index if not exists discounts_one_pending_per_invoice
  on public.discounts (invoice_id) where status = 'pending';

-- 2. families: no unique constraint backs the app's dedup-by-phone lookup
--    (students/actions.ts uses .maybeSingle(), which throws if two rows
--    ever match). A race between two concurrent new-parent creations could
--    produce duplicate families.
create unique index if not exists families_school_phone
  on public.families (school_id, primary_parent_phone);

-- 3. admin_notifications: no index at all, but queried on every
--    authenticated page load (src/app/(app)/layout.tsx).
create index if not exists admin_notifications_school_unread_idx
  on public.admin_notifications (school_id, created_at desc)
  where read_at is null;

-- 4. sessions: missing updated_at + trigger, unlike every other table with
--    mutable status (billing_cycles, classes, students, etc). sessions.status
--    is actively mutated (draft -> active -> closed) with no way to tell
--    when it last changed.
alter table public.sessions
  add column if not exists updated_at timestamptz not null default now();

alter table public.sessions
  alter column created_at set not null;

drop trigger if exists sessions_updated_at on public.sessions;
create trigger sessions_updated_at before update on public.sessions
  for each row execute function public.set_updated_at();

-- 5. message_logs: two stale leftovers from removed features. Not
--    corrupting data (every insert already supplies an explicit value),
--    just documentation hygiene.
alter table public.message_logs alter column provider drop default;

alter table public.message_logs drop constraint if exists message_logs_channel_check;
alter table public.message_logs add constraint message_logs_channel_check
  check (channel in ('sms', 'email'));
