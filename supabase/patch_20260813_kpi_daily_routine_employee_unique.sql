-- 2026-08-13 KPI daily routine checks must be stored per employee.

alter table public.kpi_daily_routine_checks
drop constraint if exists kpi_daily_routine_checks_kpi_entry_id_item_key;

alter table public.kpi_daily_routine_checks
drop constraint if exists kpi_daily_routine_checks_kpi_entry_id_employee_id_item_key;

alter table public.kpi_daily_routine_checks
add constraint kpi_daily_routine_checks_kpi_entry_id_employee_id_item_key
unique(kpi_entry_id, employee_id, item);

notify pgrst, 'reload schema';
