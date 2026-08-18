-- Audit table for inbound webhook calls (Sendchamp, Termii, etc). Records
-- every authorized hit with its raw payload so we can confirm a provider is
-- actually calling us, independent of whether the payload could be matched
-- to a message_logs row. Query via the Supabase REST API or SQL editor.

create table if not exists public.webhook_events (
  id          uuid primary key default gen_random_uuid(),
  source      text not null,      -- e.g. 'sendchamp', 'termii'
  payload     jsonb not null,
  matched     boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists idx_webhook_events_source_created on public.webhook_events (source, created_at desc);

alter table public.webhook_events enable row level security;
-- Service-role only — no school scoping (webhooks aren't tenant-scoped), no
-- policy needed for anon/authenticated since only the service-role client
-- (which bypasses RLS) ever touches this table.
