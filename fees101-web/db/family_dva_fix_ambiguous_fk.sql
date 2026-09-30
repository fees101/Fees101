-- Fixes a bug in db/family_dva.sql: the foreign key added on
-- families.dva_last_overflow_student_id -> students(id) created a SECOND
-- relationship between `students` and `families` (the first being the
-- existing students.family_id -> families.id). PostgREST can no longer
-- resolve which relationship to use for any `families!inner(...)` /
-- `families(...)` embed in the app's queries, so those queries fail with
-- PGRST201 ("more than one relationship was found") — this is what broke
-- the students list and any other page joining students to families.
--
-- Fix: drop the foreign key constraint but keep the column itself (it's
-- purely informational — "which sibling last absorbed a family overflow
-- payment" — the app never relies on the database enforcing it as a real
-- reference). Idempotent: safe to re-run.

alter table public.families
  drop constraint if exists families_dva_last_overflow_student_id_fkey;
