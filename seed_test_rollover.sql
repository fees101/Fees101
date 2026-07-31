-- ============================================================================
-- Fees101 — reset + seed clean test data for the year-end rollover
-- Scoped to "Creative Kids Elementary and High School" only.
-- Keeps the existing class ladder (Grade 1 → 2 → 3 → 4 → 5[exit]).
-- Paste into the Supabase SQL editor and run.
--
-- Seeds one ACTIVE session + term with per-class fees (Tuition mandatory,
-- Transport optional), 5 active students across grades, and fee adjustments
-- to prove opt-in / exemption carry-forward:
--   Ada Okafor    (Grade 1)  opted-in  to Transport      -> promotes to Grade 2
--   Emeka Okafor  (Grade 2)  exempt    from Tuition       -> promotes to Grade 3
--   Musa Bello    (Grade 1)  plain                        -> promotes to Grade 2
--   Tunde Adeyemi (Grade 4)  opted-in  to Transport      -> promotes to Grade 5
--   Zainab Bello  (Grade 5)  plain (exit point)           -> graduates
-- ============================================================================

-- ---- 1. RESET (children first, scoped to this school) ----------------------
do $$
declare sid uuid := '0e3da130-f353-43e0-bee0-69cb0d980b0b';
begin
  delete from rollover_promotions where run_id in (select id from rollover_runs where school_id = sid);
  delete from rollover_runs          where school_id = sid;
  delete from discounts              where school_id = sid;
  delete from invoices               where school_id = sid;
  delete from fee_items              where school_id = sid;
  delete from students               where school_id = sid;
  delete from billing_cycles         where school_id = sid;
  delete from sessions               where school_id = sid;
  delete from families               where school_id = sid;
end $$;

-- ---- 2. SEED ---------------------------------------------------------------
do $$
declare
  sid   uuid := '0e3da130-f353-43e0-bee0-69cb0d980b0b';
  sect  uuid := 'e292c2a6-e84a-4051-b20e-138de9e1618e';
  g1    uuid := 'ed164680-99b9-408b-912a-938bc4d38e61';
  g2    uuid := '1f00ca23-1584-46fe-a190-347bcde4b6b3';
  g3    uuid := 'a903b045-619d-4086-9b8f-9d05ae054550';
  g4    uuid := '858a87a4-b258-457d-9771-8a2b7e5991ff';
  g5    uuid := '4e8a7ce0-8088-401b-b440-a099bcb493e7';

  sess  uuid := gen_random_uuid();
  term  uuid := gen_random_uuid();

  fam_okafor  uuid := gen_random_uuid();
  fam_bello   uuid := gen_random_uuid();
  fam_adeyemi uuid := gen_random_uuid();

  st_ada    uuid := gen_random_uuid();
  st_emeka  uuid := gen_random_uuid();
  st_musa   uuid := gen_random_uuid();
  st_tunde  uuid := gen_random_uuid();
  st_zainab uuid := gen_random_uuid();

  -- fee items whose ids we need for adjustments
  fi_g1_transport uuid := gen_random_uuid();
  fi_g2_tuition   uuid := gen_random_uuid();
  fi_g4_transport uuid := gen_random_uuid();
begin
  -- session + active term
  insert into sessions (id, school_id, name, start_date, end_date, status)
    values (sess, sid, '2027/2028', '2027-09-01', '2028-07-31', 'active');

  insert into billing_cycles (id, school_id, session_id, name, start_date, end_date, due_date, status)
    values (term, sid, sess, 'First Term 2027/2028', '2027-09-01', '2027-12-15', '2027-10-15', 'active');

  -- per-class fees for Grade 1..5 (Tuition mandatory + Transport optional)
  insert into fee_items (id, school_id, billing_cycle_id, class_id, name, amount, is_mandatory, is_optional_extra, is_discountable, display_order) values
    (gen_random_uuid(), sid, term, g1, 'Tuition',   50000, true,  false, true,  0),
    (fi_g1_transport,   sid, term, g1, 'Transport', 15000, false, true,  false, 1),
    (fi_g2_tuition,     sid, term, g2, 'Tuition',   60000, true,  false, true,  0),
    (gen_random_uuid(), sid, term, g2, 'Transport', 15000, false, true,  false, 1),
    (gen_random_uuid(), sid, term, g3, 'Tuition',   70000, true,  false, true,  0),
    (gen_random_uuid(), sid, term, g3, 'Transport', 15000, false, true,  false, 1),
    (gen_random_uuid(), sid, term, g4, 'Tuition',   80000, true,  false, true,  0),
    (fi_g4_transport,   sid, term, g4, 'Transport', 15000, false, true,  false, 1),
    (gen_random_uuid(), sid, term, g5, 'Tuition',   90000, true,  false, true,  0),
    (gen_random_uuid(), sid, term, g5, 'Transport', 15000, false, true,  false, 1);

  -- families
  insert into families (id, school_id, primary_parent_name, primary_parent_phone) values
    (fam_okafor,  sid, 'Mr & Mrs Okafor',  '+2348030000001'),
    (fam_bello,   sid, 'Mr & Mrs Bello',   '+2348030000002'),
    (fam_adeyemi, sid, 'Mr & Mrs Adeyemi', '+2348030000003');

  -- students (all active, in the grade section)
  insert into students (id, school_id, section_id, class_id, family_id, first_name, last_name, admission_number, admission_date, status) values
    (st_ada,    sid, sect, g1, fam_okafor,  'Ada',    'Okafor',  'CK-2027/001', '2025-09-01', 'active'),
    (st_emeka,  sid, sect, g2, fam_okafor,  'Emeka',  'Okafor',  'CK-2027/002', '2024-09-01', 'active'),
    (st_musa,   sid, sect, g1, fam_bello,   'Musa',   'Bello',   'CK-2027/003', '2025-09-01', 'active'),
    (st_tunde,  sid, sect, g4, fam_adeyemi, 'Tunde',  'Adeyemi', 'CK-2027/004', '2022-09-01', 'active'),
    (st_zainab, sid, sect, g5, fam_bello,   'Zainab', 'Bello',   'CK-2027/005', '2021-09-01', 'active');

  -- fee adjustments to watch carry forward
  insert into student_fee_adjustments (school_id, student_id, fee_item_id, adjustment_type) values
    (sid, st_ada,   fi_g1_transport, 'opt_in'),   -- should re-appear on Grade 2 Transport
    (sid, st_tunde, fi_g4_transport, 'opt_in'),   -- should re-appear on Grade 5 Transport
    (sid, st_emeka, fi_g2_tuition,   'exempt');   -- should re-appear on Grade 3 Tuition
end $$;

-- ---- 3. VERIFY -------------------------------------------------------------
select s.first_name || ' ' || s.last_name as student,
       c.name  as class,
       a.adjustment_type,
       fi.name as fee_item
from students s
join classes c on c.id = s.class_id
left join student_fee_adjustments a on a.student_id = s.id
left join fee_items fi on fi.id = a.fee_item_id
where s.school_id = '0e3da130-f353-43e0-bee0-69cb0d980b0b'
order by c.display_order, s.first_name;
