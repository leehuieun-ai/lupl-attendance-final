-- 2026-08-10 Deduplicate NAVER WORKS leave notifications by attendance request

alter table public.kpi_works_notifications
  add column if not exists attendance_request_id uuid references public.attendance_requests(id) on delete set null;

create index if not exists kpi_works_notifications_request_event_idx
on public.kpi_works_notifications(attendance_request_id, event_type, created_at desc);

notify pgrst, 'reload schema';
