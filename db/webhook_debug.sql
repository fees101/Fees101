-- Audit table for inbound webhook calls (Sendchamp, Termii, etc). Records
-- every authorized hit with its raw payload so we can confirm a provider is
-- actually calling us, independent of whether the payload could be matched
-- to a message_logs row. Query via the Supabase REST API or SQL editor.
--
-- Named sms_webhook_events (not webhook_events) because a pre-existing
-- webhook_events table already belongs to Monnify's payment webhook
-- processor (src/lib/payments/webhookProcessor.ts) with an incompatible
-- schema — reusing that name previously caused CREATE TABLE IF NOT EXISTS
-- to silently no-op and later ALTER TABLE ... SET NOT NULL statements to
-- break every Monnify webhook insert.

create table if not exists public.sms_webhook_events (
  id          uuid primary key default gen_random_uuid(),
  source      text not null,      -- e.g. 'sendchamp', 'termii'
  payload     jsonb not null,
  matched     boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists idx_sms_webhook_events_source_created on public.sms_webhook_events (source, created_at desc);

alter table public.sms_webhook_events enable row level security;
-- Service-role only — no school scoping (webhooks aren't tenant-scoped), no
-- policy needed for anon/authenticated since only the service-role client
-- (which bypasses RLS) ever touches this table.
