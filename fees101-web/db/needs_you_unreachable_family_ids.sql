-- "Families you can't reach" — the family ids behind the dashboard "Needs you"
-- attention count (db/needs_you_unreachable_families.sql).
--
-- Returns the family_id of every family (with at least one ACTIVE student)
-- whose latest OUTBOUND message on EVERY channel they've been contacted on
-- failed. Same rule as the count function next to it, but it hands back the
-- ids so the Students roster can scope itself to that exact set
-- (/students?filter=unreachable) instead of only showing a number.
--
-- Self-clearing by construction: it only ever looks at the newest outbound
-- message per channel, so the moment a later message to that family is
-- sent/delivered the channel is no longer "failed" and the family drops out.
--
-- SECURITY INVOKER (the default): the caller's own RLS on message_logs/students
-- applies, so this can only ever see the caller's own school. The p_school_id
-- argument is an extra filter, not the authorization.
--
-- Run this once in the Supabase SQL editor. Idempotent (safe to re-run). The
-- roster treats a missing function / error as an empty set, so the page is safe
-- before this is applied (the scoped view simply shows no families).
--
-- Reuses the message_logs_student_channel_sent_idx index created in
-- db/needs_you_unreachable_families.sql.

create or replace function public.needs_you_unreachable_family_ids(p_school_id uuid)
returns setof uuid
language sql
stable
security invoker
set search_path = public
as $$
  with latest_per_channel as (
    -- The most recent outbound message for each (family, channel) pairing.
    select distinct on (s.family_id, m.channel)
           s.family_id as family_id,
           m.status     as status
    from public.message_logs m
    join public.students s on s.id = m.related_student_id
    where m.school_id = p_school_id
      and m.direction = 'outbound'
      and s.family_id is not null
      and s.status = 'active'
    order by s.family_id, m.channel, m.sent_at desc nulls last, m.created_at desc
  )
  select family_id
  from latest_per_channel
  group by family_id
  -- Unreachable only when the latest message on every channel tried failed.
  having bool_and(status = 'failed');
$$;

grant execute on function public.needs_you_unreachable_family_ids(uuid) to authenticated;

notify pgrst, 'reload schema';
