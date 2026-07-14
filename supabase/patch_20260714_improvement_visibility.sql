-- 개선 요청함 공개 범위 보강
-- 직원은 본인 작성 요청만, 관리자는 전체 요청만 볼 수 있게 재적용합니다.

alter table public.improvement_requests enable row level security;

drop policy if exists improvement_requests_select_auth on public.improvement_requests;
create policy improvement_requests_select_auth on public.improvement_requests
for select to authenticated using (
  public.is_admin()
  or created_by = public.current_employee_id()
);

drop policy if exists improvement_requests_insert_auth on public.improvement_requests;
create policy improvement_requests_insert_auth on public.improvement_requests
for insert to authenticated with check (
  created_by = public.current_employee_id()
  or public.is_admin()
);
