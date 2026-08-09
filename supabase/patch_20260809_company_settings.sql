-- 2026-08-09 company-wide settings for official document assets
create table if not exists public.company_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_by uuid references public.employees(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.company_settings enable row level security;

grant select, insert, update, delete on public.company_settings to authenticated;

drop policy if exists company_settings_select_admin on public.company_settings;
create policy company_settings_select_admin on public.company_settings
for select to authenticated using (public.is_admin());

drop policy if exists company_settings_insert_admin on public.company_settings;
create policy company_settings_insert_admin on public.company_settings
for insert to authenticated with check (public.is_admin());

drop policy if exists company_settings_update_admin on public.company_settings;
create policy company_settings_update_admin on public.company_settings
for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists company_settings_delete_admin on public.company_settings;
create policy company_settings_delete_admin on public.company_settings
for delete to authenticated using (public.is_admin());

notify pgrst, 'reload schema';
