-- 2026-07-06 오늘의 할일, 업무 R&R, 연차 없음 플래그
-- Supabase SQL Editor에서 1회 실행하세요.

alter table public.employees add column if not exists no_annual_leave boolean not null default false;
alter table public.employees add column if not exists no_annual_leave_reason text;
alter table public.employees add column if not exists department text;
alter table public.employees add column if not exists position text;

create table if not exists public.daily_tasks (
  id uuid primary key default gen_random_uuid(),
  task_date date not null default current_date,
  title text not null,
  content text not null,
  is_active boolean not null default true,
  created_by uuid references public.employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists daily_tasks_task_date_active_idx
on public.daily_tasks(task_date, is_active, created_at desc);

create table if not exists public.rnr_entries (
  id uuid primary key default gen_random_uuid(),
  raw_input text not null,
  title text not null,
  summary text not null,
  department text,
  position text,
  category text,
  priority text not null default 'normal',
  checklist jsonb not null default '[]'::jsonb,
  assigned_employee_id uuid references public.employees(id),
  assigned_person_name text,
  source text,
  is_active boolean not null default true,
  created_by uuid references public.employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists rnr_entries_role_active_idx
on public.rnr_entries(is_active, department, position, created_at desc);

alter table public.daily_tasks enable row level security;
alter table public.rnr_entries enable row level security;

drop policy if exists daily_tasks_select_auth on public.daily_tasks;
create policy daily_tasks_select_auth on public.daily_tasks
for select to authenticated using (is_active = true or public.is_admin());

drop policy if exists daily_tasks_admin_insert on public.daily_tasks;
create policy daily_tasks_admin_insert on public.daily_tasks
for insert to authenticated with check (public.is_admin());

drop policy if exists daily_tasks_admin_update on public.daily_tasks;
create policy daily_tasks_admin_update on public.daily_tasks
for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists rnr_entries_select_auth on public.rnr_entries;
create policy rnr_entries_select_auth on public.rnr_entries
for select to authenticated using (is_active = true or public.is_admin());

drop policy if exists rnr_entries_admin_insert on public.rnr_entries;
create policy rnr_entries_admin_insert on public.rnr_entries
for insert to authenticated with check (public.is_admin());

drop policy if exists rnr_entries_admin_update on public.rnr_entries;
create policy rnr_entries_admin_update on public.rnr_entries
for update to authenticated using (public.is_admin()) with check (public.is_admin());
