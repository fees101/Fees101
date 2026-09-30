-- Add a distinct "revoked" signal to discounts, separate from status.
--
-- Before this, revoking an already-approved discount reused the existing
-- status column two different ways depending on path: revokeDiscount's
-- full-removal branch (invoice not yet sent/paid) set status='rejected' —
-- the same status a request that was never approved gets — and its
-- carry-forward-stop branch (already sent/paid, or revokeRecurringDiscount)
-- only flipped is_recurring=false, leaving status='applied' untouched. Either
-- way, a school could no longer tell "this was approved then pulled" apart
-- from "this was never approved" (status='rejected') or "this is still an
-- active approved discount" (status='applied', is_recurring=false is also
-- the shape of a one-time discount that was simply never recurring).
--
-- revoked_at/revoked_by are additive and nullable — no existing status-based
-- check anywhere in the app (approveDiscount, rejectDiscount, the "active
-- recurring" query, etc.) reads these columns, so nothing already built
-- changes behaviour. They only feed the Discounts Queue's "DECIDED" history,
-- which can now render a discount as Revoked distinctly from Approved/Denied.
--
-- Idempotent: safe to re-run.

alter table public.discounts
  add column if not exists revoked_at timestamptz,
  add column if not exists revoked_by uuid references public.users(id);
