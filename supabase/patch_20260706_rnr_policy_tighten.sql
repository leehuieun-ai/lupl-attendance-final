-- 2026-07-06 R&R 조회 권한 축소
-- 이미 todos/rnr/leave 패치를 실행한 DB에서 1회 실행하세요.

drop policy if exists rnr_entries_select_auth on public.rnr_entries;
create policy rnr_entries_select_auth on public.rnr_entries
for select to authenticated using (
  public.is_admin()
  or (
    is_active = true
    and (
      assigned_employee_id = public.current_employee_id()
      or exists (
        select 1
        from public.employees e
        where e.id = public.current_employee_id()
          and (
            (coalesce(rnr_entries.department, '') <> '' and e.department = rnr_entries.department)
            or (coalesce(rnr_entries.position, '') <> '' and e.position = rnr_entries.position)
          )
      )
    )
  )
);
