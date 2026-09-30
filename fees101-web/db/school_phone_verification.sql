-- Run this once in the Supabase SQL editor.
-- OTP-based verification for the School Profile "Office phone" field, same
-- purpose as school_email_verification.sql but a 6-digit SMS code instead of
-- a click-link — a phone can't be "clicked", so it needs a code the office
-- can read off their handset and type back in.

alter table schools add column if not exists phone_verified_at timestamptz;
-- Never store the OTP itself — only a hash, so a DB read/leak can't reveal a
-- still-live code (same reasoning as password hashing, just short-lived).
alter table schools add column if not exists phone_verify_code_hash text;
alter table schools add column if not exists phone_verify_expires_at timestamptz;
alter table schools add column if not exists phone_verify_attempts int not null default 0;
alter table schools add column if not exists phone_verify_sent_at timestamptz;

-- New message_logs.message_type value for the OTP SMS, alongside the
-- existing allowed list (see db/roles_permissions.sql for the prior version
-- of this constraint).
alter table public.message_logs drop constraint if exists message_logs_message_type_check;
alter table public.message_logs add constraint message_logs_message_type_check
  check (message_type = any (array[
    'invoice','invoice_short','invoice_full','receipt',
    'reminder_advance','reminder_due','reminder_overdue',
    'extras_prompt','extras_confirmation','parent_query_response',
    'manual','inbound_parent','invite','phone_verify']));
