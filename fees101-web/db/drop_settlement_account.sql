-- Removes the settlement-account columns added in db/payment_settings_extended.sql
-- (2026-09-17). The school never stores this and the "Settlement account" row
-- was removed from the redesigned /settings/payments page (2026-09-22) at the
-- owner's request ("i dont think we need the settlement account, i dont store
-- them") — the columns have been dead since the day they were added.
--
-- Run this once in the Supabase SQL editor.

alter table schools drop column if exists settlement_bank_name;
alter table schools drop column if exists settlement_account_number;
alter table schools drop column if exists settlement_account_name;
