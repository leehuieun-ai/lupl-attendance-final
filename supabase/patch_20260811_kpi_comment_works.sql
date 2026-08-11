-- 2026-08-11 KPI comment NAVER WORKS direct notifications

alter table public.kpi_works_notifications
  drop constraint if exists kpi_works_notifications_event_type_check;

alter table public.kpi_works_notifications
  add constraint kpi_works_notifications_event_type_check
  check (event_type in ('check_in','check_out','leave_requested','leave_approved','leave_rejected','kpi_comment'));

notify pgrst, 'reload schema';
