-- Allow negative payment rows so manual-payment reversals can post.
--
-- The reversal of an approved manual payment posts a NEGATIVE ledger row
-- (insert_manual_invoice_payment / insert_credit_balance_payment with -amount)
-- so the payments-insert trigger walks the invoice paid_amount / student credit
-- back down. The original constraint payments_amount_check CHECK (amount > 0)
-- rejected that row, raising:
--   new row for relation "payments" violates check constraint "payments_amount_check"
--
-- Widen it to amount <> 0 (nonzero), matching manual_payment_requests' own
-- `check (amount <> 0)`. This is strictly more permissive, so every existing
-- (positive) payment still passes; only the zero amount stays disallowed.
--
-- Run once in the Supabase SQL editor. Idempotent.

alter table public.payments drop constraint if exists payments_amount_check;

alter table public.payments
  add constraint payments_amount_check check (amount <> 0);

notify pgrst, 'reload schema';
