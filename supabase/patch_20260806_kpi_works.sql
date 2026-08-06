-- 2026-08-06 KPI dashboard and NAVER WORKS notification logs
alter table public.employees
  add column if not exists works_user_id text;

create table if not exists public.kpi_entries (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees(id) on delete cascade,
  employee_name text,
  attendance_log_id uuid references public.attendance_logs(id) on delete set null,
  parent_id uuid references public.kpi_entries(id) on delete set null,
  scope text not null default 'daily' check (scope in ('daily','weekly','monthly')),
  work_date date not null default ((now() at time zone 'Asia/Seoul')::date),
  title text not null,
  status text not null default 'pending' check (status in ('pending','done','missed')),
  sort_order integer not null default 0,
  is_public boolean not null default true,
  is_active boolean not null default true,
  created_by uuid references public.employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.kpi_entries
  add column if not exists employee_name text;

create index if not exists kpi_entries_employee_date_idx
on public.kpi_entries(employee_id, work_date desc, scope, is_active);

create index if not exists kpi_entries_scope_date_idx
on public.kpi_entries(scope, work_date desc, is_active);

create index if not exists kpi_entries_parent_idx
on public.kpi_entries(parent_id);

create table if not exists public.kpi_works_notifications (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees(id) on delete set null,
  attendance_log_id uuid references public.attendance_logs(id) on delete set null,
  kpi_entry_ids uuid[] not null default '{}',
  event_type text not null check (event_type in ('check_in','check_out')),
  channel_id text,
  message text not null,
  status text not null default 'pending' check (status in ('pending','sent','skipped','failed')),
  response jsonb,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists kpi_works_notifications_employee_idx
on public.kpi_works_notifications(employee_id, created_at desc);

alter table public.kpi_entries enable row level security;
alter table public.kpi_works_notifications enable row level security;

grant select, insert, update, delete on public.kpi_entries to authenticated;
grant select, insert on public.kpi_works_notifications to authenticated;

drop policy if exists kpi_entries_select_auth on public.kpi_entries;
create policy kpi_entries_select_auth on public.kpi_entries
for select to authenticated using (
  public.is_admin()
  or coalesce(is_public, true)
  or employee_id = public.current_employee_id()
  or created_by = public.current_employee_id()
);

drop policy if exists kpi_entries_insert_auth on public.kpi_entries;
create policy kpi_entries_insert_auth on public.kpi_entries
for insert to authenticated with check (
  public.is_admin()
  or (
    employee_id = public.current_employee_id()
    and created_by = public.current_employee_id()
  )
);

drop policy if exists kpi_entries_update_auth on public.kpi_entries;
create policy kpi_entries_update_auth on public.kpi_entries
for update to authenticated using (
  public.is_admin()
  or employee_id = public.current_employee_id()
  or created_by = public.current_employee_id()
) with check (
  public.is_admin()
  or (
    employee_id = public.current_employee_id()
    and coalesce(created_by, public.current_employee_id()) = public.current_employee_id()
  )
);

drop policy if exists kpi_entries_delete_auth on public.kpi_entries;
create policy kpi_entries_delete_auth on public.kpi_entries
for delete to authenticated using (
  public.is_admin()
  or (
    employee_id = public.current_employee_id()
    and created_by = public.current_employee_id()
  )
);

drop policy if exists kpi_works_notifications_select_self_admin on public.kpi_works_notifications;
create policy kpi_works_notifications_select_self_admin on public.kpi_works_notifications
for select to authenticated using (
  public.is_admin()
  or employee_id = public.current_employee_id()
);

drop policy if exists kpi_works_notifications_insert_self_admin on public.kpi_works_notifications;
create policy kpi_works_notifications_insert_self_admin on public.kpi_works_notifications
for insert to authenticated with check (
  public.is_admin()
  or employee_id = public.current_employee_id()
);

notify pgrst, 'reload schema';
