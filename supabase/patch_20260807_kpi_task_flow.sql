-- 2026-08-07 KPI and daily task workflow links

create table if not exists public.daily_task_completions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.daily_tasks(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(task_id, employee_id)
);

create index if not exists daily_task_completions_employee_idx
on public.daily_task_completions(employee_id, completed_at desc);

alter table public.kpi_entries
  add column if not exists source_daily_task_id uuid references public.daily_tasks(id) on delete set null,
  add column if not exists source_rnr_entry_id uuid references public.rnr_entries(id) on delete set null,
  add column if not exists description text,
  add column if not exists updated_by uuid references public.employees(id),
  add column if not exists admin_note text,
  add column if not exists change_log jsonb not null default '[]'::jsonb;

create index if not exists kpi_entries_source_daily_task_idx
on public.kpi_entries(source_daily_task_id, employee_id, work_date desc)
where source_daily_task_id is not null;

create index if not exists kpi_entries_source_rnr_idx
on public.kpi_entries(source_rnr_entry_id, scope, work_date desc)
where source_rnr_entry_id is not null;

alter table public.daily_task_completions enable row level security;

grant select, insert, delete on public.daily_task_completions to authenticated;

drop policy if exists daily_task_completions_select_self_admin on public.daily_task_completions;
create policy daily_task_completions_select_self_admin on public.daily_task_completions
for select to authenticated using (
  public.is_admin()
  or employee_id = public.current_employee_id()
);

drop policy if exists daily_task_completions_insert_self on public.daily_task_completions;
create policy daily_task_completions_insert_self on public.daily_task_completions
for insert to authenticated with check (
  employee_id = public.current_employee_id()
);

drop policy if exists daily_task_completions_delete_self_admin on public.daily_task_completions;
create policy daily_task_completions_delete_self_admin on public.daily_task_completions
for delete to authenticated using (
  public.is_admin()
  or employee_id = public.current_employee_id()
);

notify pgrst, 'reload schema';
