alter table public.rnr_entries
  add column if not exists display_title text,
  add column if not exists work_group text,
  add column if not exists flow_notes jsonb not null default '[]'::jsonb,
  add column if not exists target_scope text not null default 'role',
  add column if not exists is_public boolean not null default false,
  add column if not exists public_note text;

create index if not exists rnr_entries_public_board_idx
on public.rnr_entries(is_public, is_active, department, work_group, created_at desc);

update public.rnr_entries
set
  is_public = true,
  display_title = coalesce(nullif(display_title, ''), title),
  work_group = coalesce(nullif(work_group, ''), category, 'work'),
  target_scope = coalesce(nullif(target_scope, ''), case when assigned_employee_id is not null then 'employee' when coalesce(department, '') <> '' then 'department' else 'common' end),
  flow_notes = case
    when jsonb_typeof(flow_notes) = 'array' and jsonb_array_length(flow_notes) > 0 then flow_notes
    else to_jsonb(array_remove(array[nullif(summary, ''), nullif(title, '')]::text[], null))
  end
where is_active = true
  and coalesce(is_sensitive, false) = false;

drop policy if exists rnr_entries_select_auth on public.rnr_entries;
create policy rnr_entries_select_auth on public.rnr_entries
for select to authenticated using (
  public.is_admin()
  or (
    is_active = true
    and coalesce(rnr_entries.is_sensitive, false) = false
    and coalesce(rnr_entries.is_public, false) = true
  )
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
