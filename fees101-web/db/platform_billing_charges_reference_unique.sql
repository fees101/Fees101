-- M1: enforce one charge row per Paystack reference.
--
-- platform_billing_charges.paystack_reference is the idempotency key every
-- webhook / reconcile path already checks before inserting (so a Paystack
-- retry, or the callback and the webhook both observing the same setup charge,
-- don't double-credit). Those checks are a read-then-insert, so a true race can
-- still slip two rows past them. This unique index closes that gap at the
-- database, and the application code now treats the resulting unique-violation
-- (SQLSTATE 23505) as "already processed" rather than an error.
--
-- NULL references are allowed and NOT de-duplicated: a Postgres unique index
-- treats every NULL as distinct, which is what we want (a charge row written
-- without a provider reference is not a duplicate of another such row).
--
-- Idempotent and safe to re-run. It never deletes or rewrites charge rows. If
-- the table already contains duplicate references (possible from before the
-- read-then-insert guards existed), the unique index cannot be created; rather
-- than destroy financial history automatically, this script raises a clear
-- error listing the offending references so they can be reconciled by hand,
-- then re-run.

do $$
declare
  dup_count integer;
  dup_list text;
begin
  select count(*), string_agg(paystack_reference, ', ')
    into dup_count, dup_list
  from (
    select paystack_reference
    from public.platform_billing_charges
    where paystack_reference is not null
    group by paystack_reference
    having count(*) > 1
  ) d;

  if dup_count > 0 then
    raise exception
      'Cannot create unique index: % duplicate paystack_reference value(s) exist: %. Reconcile these rows by hand (keep one per reference), then re-run this script.',
      dup_count, dup_list;
  end if;
end $$;

create unique index if not exists platform_billing_charges_reference_key
  on public.platform_billing_charges (paystack_reference);

notify pgrst, 'reload schema';
