-- 잘못 추가된 주간 스케줄 테이블 제거
drop table if exists public.weekly_schedules cascade;


-- 현재 로그인한 직원 확인 함수
create or replace function public.current_employee_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from public.employees
  where user_id = auth.uid()
    and is_active = true
    and employment_status = 'active'
  limit 1;
$$;


-- 관리자 확인 함수
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.employees
    where user_id = auth.uid()
      and role = 'admin'
      and is_active = true
      and employment_status = 'active'
  );
$$;


-- 현재 장소 입력용 workplaces 컬럼 보강
alter table public.workplaces
add column if not exists requested_by uuid references public.employees(id);

alter table public.workplaces
add column if not exists is_active boolean default false;

alter table public.workplaces
add column if not exists approval_status text default 'pending';


-- workplaces RLS 재설정
alter table public.workplaces enable row level security;

drop policy if exists workplaces_select_visible on public.workplaces;
drop policy if exists workplaces_insert_pending_self on public.workplaces;
drop policy if exists workplaces_admin_update_all on public.workplaces;
drop policy if exists workplaces_admin_delete_all on public.workplaces;


create policy workplaces_select_visible
on public.workplaces
for select
to authenticated
using (
  public.is_admin()
  or is_active = true
  or requested_by = public.current_employee_id()
);


create policy workplaces_insert_pending_self
on public.workplaces
for insert
to authenticated
with check (
  public.is_admin()
  or requested_by = public.current_employee_id()
);


create policy workplaces_admin_update_all
on public.workplaces
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());


create policy workplaces_admin_delete_all
on public.workplaces
for delete
to authenticated
using (public.is_admin());
