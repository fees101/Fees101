-- Report download audit log.
-- One row per CSV a user downloads from /reports (or a contextual export button):
-- who, which report, at what scope, and when. Powers the "Recently downloaded"
-- history on the Reports page and a future audit trail.
--
-- Run this once in the Supabase SQL editor.

create table if not exists public.report_downloads (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools(id) on delete cascade,
  user_id     uuid references public.users(id) on delete set null,
  report_type text not null,          -- 'debtors' | 'collections' | 'class-summary' | 'invoices' | 'discounts' | 'students'
  scope_label text,                   -- human-readable scope, e.g. "First Term 2025/26" or "2025-01-01 → 2025-03-31"
  params      jsonb,                   -- raw scope params, for audit
  row_count   integer,                -- number of data rows in the file
  filename    text,
  created_at  timestamptz not null default now()
);

create index if not exists report_downloads_school_created_idx
  on public.report_downloads (school_id, created_at desc);

alter table public.report_downloads enable row level security;

-- Same access model as the rest of the app: a user sees/creates rows for their
-- own school; super_admins see everything.
create policy "Users see own school report downloads"
  on public.report_downloads for select
  using ((school_id = public.current_school_id()) or public.is_super_admin());

create policy "Users log own school report downloads"
  on public.report_downloads for insert
  with check ((school_id = public.current_school_id()) or public.is_super_admin());

create policy "Super admin manages all report downloads"
  on public.report_downloads
  using (public.is_super_admin());
