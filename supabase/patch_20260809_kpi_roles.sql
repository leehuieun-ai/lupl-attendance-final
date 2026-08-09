-- 2026-08-09 KPI project role assignment
alter table public.kpi_entries
  add column if not exists mentor_employee_id uuid references public.employees(id) on delete set null;

create index if not exists kpi_entries_mentor_employee_idx
on public.kpi_entries(mentor_employee_id, work_date desc)
where mentor_employee_id is not null;

notify pgrst, 'reload schema';
