-- M3: re-gate grandfathered STUB rows that were never actually billed.
--
-- Background: db/platform_billing_mandate.sql ends with a blanket grandfather:
--     update public.platform_billing set billing_connected_at = now()
--       where billing_connected_at is null;
-- That opened the entry gate for EVERY existing platform_billing row so real
-- schools weren't locked out. But the table also holds bare STUB rows that were
-- never meant to be "connected":
--   - provisionPlatformDvaForSchool() (console) inserts a `{ school_id }`-only
--     row before a DVA even exists;
--   - onboarding / other flows can leave a skeleton row.
-- Those stubs got billing_connected_at = now() too, so they can enter the app
-- forever while never being billed (no mandate to debit, no setup fee paid).
--
-- Decision: RE-GATE the stubs (set billing_connected_at back to null, and reset
-- setup_fee_status to 'unpaid') so they must complete /connect-billing like any
-- new school. We do NOT set a billing path for them because there is nothing to
-- bill against yet; the correct next step is the normal connect flow.
--
-- Safety — this must NEVER lock out a live/paying/operating school. A row is
-- treated as a re-gateable stub ONLY when ALL of the following hold:
--   (a) it was grandfathered (billing_connected_at is not null);
--   (b) no reusable mandate on file (mandate_authorization_code is null);
--   (c) the setup fee was never marked paid (setup_fee_status <> 'paid');
--   (d) no DVA rail was ever provisioned (platform_dva_account_number is null);
--   (e) there is NO successful charge of any kind on record;
--   (f) the school shows NO sign of real operation: it has no students and no
--       invoices. This cross-table check is what protects genuine pre-billing
--       grandfathered customers — any school that has actually been used has
--       students/invoices and is left completely untouched.
--
-- Idempotent and safe to re-run: a row re-gated by a previous run has
-- billing_connected_at is null and no longer matches (a). It only ever clears
-- the gate on bare stubs; it never touches a paying school's row.
--
-- Because this runs manually (the owner runs SQL, not the app), it first prints
-- the affected rows as a NOTICE so they can be eyeballed before/after.

do $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select pb.school_id, s.name
    from public.platform_billing pb
    left join public.schools s on s.id = pb.school_id
    where pb.billing_connected_at is not null
      and pb.mandate_authorization_code is null
      and coalesce(pb.setup_fee_status, 'unpaid') <> 'paid'
      and pb.platform_dva_account_number is null
      and not exists (
        select 1 from public.platform_billing_charges c
        where c.school_id = pb.school_id and c.status = 'success'
      )
      and not exists (select 1 from public.students st where st.school_id = pb.school_id)
      and not exists (select 1 from public.invoices i where i.school_id = pb.school_id)
  loop
    n := n + 1;
    raise notice 'Re-gating stub billing row: school_id=% name=%', r.school_id, coalesce(r.name, '(unknown)');
  end loop;
  raise notice 'M3: % stub billing row(s) will be re-gated.', n;
end $$;

update public.platform_billing pb
  set billing_connected_at = null,
      setup_fee_status = 'unpaid',
      updated_at = now()
  where pb.billing_connected_at is not null
    and pb.mandate_authorization_code is null
    and coalesce(pb.setup_fee_status, 'unpaid') <> 'paid'
    and pb.platform_dva_account_number is null
    and not exists (
      select 1 from public.platform_billing_charges c
      where c.school_id = pb.school_id and c.status = 'success'
    )
    and not exists (select 1 from public.students st where st.school_id = pb.school_id)
    and not exists (select 1 from public.invoices i where i.school_id = pb.school_id);

notify pgrst, 'reload schema';
