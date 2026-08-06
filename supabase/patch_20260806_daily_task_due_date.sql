-- 2026-08-06 daily_tasks due date
-- Supabase SQL Editor에서 1회 실행하세요.

alter table public.daily_tasks
  add column if not exists due_date date;

create index if not exists daily_tasks_due_date_idx
on public.daily_tasks(due_date, is_active, task_date desc)
where due_date is not null;
