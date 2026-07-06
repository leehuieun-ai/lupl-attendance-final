-- 2026-07-06 오늘의 할일 대상 직원 선택
-- Supabase SQL Editor에서 1회 실행하세요.

alter table public.daily_tasks
add column if not exists target_employee_id uuid references public.employees(id) on delete set null;

create index if not exists daily_tasks_target_employee_idx
on public.daily_tasks(task_date, is_active, target_employee_id, created_at desc);

drop policy if exists daily_tasks_select_auth on public.daily_tasks;
create policy daily_tasks_select_auth on public.daily_tasks
for select to authenticated using (
  public.is_admin()
  or (
    is_active = true
    and (
      target_employee_id is null
      or target_employee_id = public.current_employee_id()
    )
  )
);

drop policy if exists daily_tasks_admin_insert on public.daily_tasks;
create policy daily_tasks_admin_insert on public.daily_tasks
for insert to authenticated with check (public.is_admin());

drop policy if exists daily_tasks_admin_update on public.daily_tasks;
create policy daily_tasks_admin_update on public.daily_tasks
for update to authenticated using (public.is_admin()) with check (public.is_admin());

notify pgrst, 'reload schema';
