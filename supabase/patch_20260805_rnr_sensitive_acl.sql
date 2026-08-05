alter table public.rnr_entries
  add column if not exists is_sensitive boolean not null default false;

drop policy if exists rnr_entries_select_auth on public.rnr_entries;
create policy rnr_entries_select_auth on public.rnr_entries
for select to authenticated using (
  public.is_admin()
  or (
    is_active = true
    and (
      assigned_employee_id = public.current_employee_id()
      or (
        coalesce(rnr_entries.is_sensitive, false) = false
        and exists (
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
  )
);
