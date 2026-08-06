-- 2026-08-07 R&R public board visibility choice
-- Supabase SQL Editor에서 1회 실행하세요.
-- 관리자가 공개로 체크한 업무는 민감 자동 감지 여부와 별개로 공개 업무분장표에 표시합니다.

drop policy if exists rnr_entries_select_auth on public.rnr_entries;
create policy rnr_entries_select_auth on public.rnr_entries
for select to authenticated using (
  public.is_admin()
  or (
    is_active = true
    and coalesce(rnr_entries.is_public, false) = true
  )
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
