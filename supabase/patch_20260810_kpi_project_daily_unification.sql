-- 2026-08-10 KPI project period and daily task unification

alter table public.kpi_entries
  add column if not exists due_date date,
  add column if not exists project_start date,
  add column if not exists project_end date;

create index if not exists kpi_entries_due_date_idx
on public.kpi_entries(due_date, employee_id, is_active)
where due_date is not null;

create index if not exists kpi_entries_project_period_idx
on public.kpi_entries(project_start, project_end, is_active)
where project_start is not null or project_end is not null;

update public.kpi_entries
set
  project_start = coalesce(
    project_start,
    nullif(substring(admin_note from '\[프로젝트기간:([0-9]{4}-[0-9]{2}-[0-9]{2})~[0-9]{4}-[0-9]{2}-[0-9]{2}\]'), '')::date
  ),
  project_end = coalesce(
    project_end,
    nullif(substring(admin_note from '\[프로젝트기간:[0-9]{4}-[0-9]{2}-[0-9]{2}~([0-9]{4}-[0-9]{2}-[0-9]{2})\]'), '')::date
  ),
  admin_note = nullif(regexp_replace(coalesce(admin_note, ''), '\[프로젝트기간:[0-9]{4}-[0-9]{2}-[0-9]{2}~[0-9]{4}-[0-9]{2}-[0-9]{2}\]\s*', '', 'g'), '')
where admin_note ~ '\[프로젝트기간:[0-9]{4}-[0-9]{2}-[0-9]{2}~[0-9]{4}-[0-9]{2}-[0-9]{2}\]';

notify pgrst, 'reload schema';
