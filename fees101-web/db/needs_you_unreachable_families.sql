-- "Families you can't reach" — the dashboard "Needs you" attention item.
--
-- Counts families (with at least one ACTIVE student) whose latest OUTBOUND
-- message on EVERY channel they've been contacted on failed. A family where the
-- most recent SMS failed and the most recent email failed (and so on for any
-- channel used) is effectively unreachable — nobody at the school can get an
-- invoice or reminder to them until their phone/email is fixed.
--
-- Self-clearing by construction: it only ever looks at the newest RESOLVED
-- outbound message per channel, so the moment a later message to that family
-- is confirmed delivered the channel is no longer "failed" and the family
-- drops out of the count. No flag to reset, no row to dismiss.
--
-- Only resolved outcomes count — 'delivered' or 'failed' — never 'sent'.
-- 'sent' means the provider's gateway merely *accepted* the request (see
-- sendchamp.ts / brevo.ts); it is not evidence the message reached anyone and
-- is upgraded to 'delivered' or 'failed' later by the provider's webhook
-- (webhooks/sendchamp, webhooks/brevo). Fixed 2026-10-09: this used to pick
-- the single latest message per channel regardless of status, so a family
-- correctly flagged unreachable on a dead phone number would drop out the
-- moment ANY new message was merely accepted by the gateway (e.g. the
-- automatic payment receipt fired on full payment, applyPayment.ts /
-- sendReceipt.ts) — even though that receipt never actually reached them and
-- might still resolve to 'failed' once its DLR arrives. Payment status is
-- irrelevant here either way; the bug was that an unresolved 'sent' row was
-- treated as proof of reachability. Ignoring 'sent' rows means a still-failed
-- channel stays counted as failed until a later message is actually
-- confirmed delivered.
--
-- SECURITY INVOKER (the default): the caller's own RLS on message_logs/students
-- applies, so this can only ever see the caller's own school. The p_school_id
-- argument is an extra filter, not the authorization.
--
-- Run this once in the Supabase SQL editor. Idempotent (safe to re-run). The
-- dashboard treats a missing function as a 0 count, so the page is safe before
-- this is applied.

-- Supports the DISTINCT ON (family via related_student_id, channel) + latest.
create index if not exists message_logs_student_channel_sent_idx
  on public.message_logs (related_student_id, channel, sent_at desc);

create or replace function public.needs_you_unreachable_families(p_school_id uuid)
returns integer
language sql
stable
security invoker
set search_path = public
as $$
  with latest_resolved_per_channel as (
    -- The most recent RESOLVED (delivered/failed) outbound message for each
    -- (family, channel) pairing. A channel whose only attempts are still
    -- 'sent' (pending, unconfirmed) has no resolved outcome yet and is left
    -- out entirely — the same as a channel never tried — rather than being
    -- treated as proof the family is reachable.
    select distinct on (s.family_id, m.channel)
           s.family_id as family_id,
           m.status     as status
    from public.message_logs m
    join public.students s on s.id = m.related_student_id
    where m.school_id = p_school_id
      and m.direction = 'outbound'
      and m.status in ('delivered', 'failed')
      and s.family_id is not null
      and s.status = 'active'
    order by s.family_id, m.channel, m.sent_at desc nulls last, m.created_at desc
  )
  select count(*)::int
  from (
    select family_id
    from latest_resolved_per_channel
    group by family_id
    -- Unreachable only when the latest resolved outcome on every channel
    -- tried failed.
    having bool_and(status = 'failed')
  ) unreachable;
$$;

grant execute on function public.needs_you_unreachable_families(uuid) to authenticated;

notify pgrst, 'reload schema';
