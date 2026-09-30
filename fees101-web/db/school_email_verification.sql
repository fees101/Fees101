-- Adds click-to-verify tracking for the School profile "Email address" field
-- (schools.email) — this is Fees101's own contact channel to the school, not
-- a login credential, but an unverified/typo'd address leaves us with no way
-- to reach the school if we ever need to. A verification link is emailed to
-- the address whenever it's set or changed; email_verified_at is null until
-- that link is clicked.
--
-- Run this once in the Supabase SQL editor.

alter table schools add column if not exists email_verified_at timestamptz;
alter table schools add column if not exists email_verify_token text;
alter table schools add column if not exists email_verify_sent_at timestamptz;

create unique index if not exists schools_email_verify_token_idx
  on schools(email_verify_token)
  where email_verify_token is not null;
