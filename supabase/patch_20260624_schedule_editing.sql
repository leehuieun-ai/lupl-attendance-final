-- 2026-06-24 editable default schedule labels and intentionally blank cells

alter table public.employees add column if not exists schedule_title text not null default '기본 근무';
alter table public.employees add column if not exists schedule_note text not null default '';

alter table public.employee_schedule_events drop constraint if exists employee_schedule_events_event_type_check;
alter table public.employee_schedule_events add constraint employee_schedule_events_event_type_check
  check (event_type in ('work','am_only','pm_only','unavailable','info','hidden'));
