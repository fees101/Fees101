-- Optional fees default to recurring (carried forward each new cycle).
-- Marking one as one-time (e.g. a uniform purchase) stops it from being
-- carried into future cycles once a student has opted in — see
-- src/lib/fees/carryForwardAdjustments.ts.
alter table public.fee_items
  add column if not exists is_recurring boolean not null default true;
