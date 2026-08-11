-- 2026-08-11 GitHub issues #85-#89 support

alter table public.kpi_entries
  add column if not exists source_daily_task_id uuid references public.daily_tasks(id) on delete set null,
  add column if not exists source_rnr_entry_id uuid references public.rnr_entries(id) on delete set null,
  add column if not exists description text,
  add column if not exists due_date date,
  add column if not exists project_start date,
  add column if not exists project_end date,
  add column if not exists mentor_employee_id uuid references public.employees(id) on delete set null,
  add column if not exists admin_note text,
  add column if not exists updated_by uuid references public.employees(id),
  add column if not exists change_log jsonb not null default '[]'::jsonb;

create index if not exists kpi_entries_source_daily_task_idx
on public.kpi_entries(source_daily_task_id, employee_id, work_date desc)
where source_daily_task_id is not null;

create index if not exists kpi_entries_source_rnr_idx
on public.kpi_entries(source_rnr_entry_id, scope, work_date desc)
where source_rnr_entry_id is not null;

create index if not exists kpi_entries_due_date_idx
on public.kpi_entries(due_date, employee_id, is_active)
where due_date is not null;

create index if not exists kpi_entries_project_period_idx
on public.kpi_entries(project_start, project_end, is_active)
where project_start is not null or project_end is not null;

notify pgrst, 'reload schema';
