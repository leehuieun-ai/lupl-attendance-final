-- 2026-08-12 KPI comments, daily routine persistence, and connected employee access

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function private.kpi_entry_related_to_current_employee(entry public.kpi_entries)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select
    entry.employee_id = public.current_employee_id()
    or entry.created_by = public.current_employee_id()
    or entry.mentor_employee_id = public.current_employee_id()
    or coalesce(entry.admin_note,'') like '%' || public.current_employee_id()::text || '%'
    or exists (
      select 1
      from public.kpi_entries parent
      where parent.id = entry.parent_id
        and (
          parent.employee_id = public.current_employee_id()
          or parent.created_by = public.current_employee_id()
          or parent.mentor_employee_id = public.current_employee_id()
          or coalesce(parent.admin_note,'') like '%' || public.current_employee_id()::text || '%'
        )
    )
    or exists (
      select 1
      from public.kpi_entries weekly
      join public.kpi_entries project on project.id = weekly.parent_id
      where weekly.id = entry.parent_id
        and (
          project.employee_id = public.current_employee_id()
          or project.created_by = public.current_employee_id()
          or project.mentor_employee_id = public.current_employee_id()
          or coalesce(project.admin_note,'') like '%' || public.current_employee_id()::text || '%'
        )
    );
$$;

revoke all on function private.kpi_entry_related_to_current_employee(public.kpi_entries) from public;
grant execute on function private.kpi_entry_related_to_current_employee(public.kpi_entries) to authenticated;

create table if not exists public.kpi_entry_comments (
  id uuid primary key default gen_random_uuid(),
  kpi_entry_id uuid not null references public.kpi_entries(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete set null,
  author_name text,
  comment_text text not null,
  created_at timestamptz not null default now()
);

create index if not exists kpi_entry_comments_entry_idx
on public.kpi_entry_comments(kpi_entry_id, created_at);

create index if not exists kpi_entry_comments_employee_idx
on public.kpi_entry_comments(employee_id, created_at desc)
where employee_id is not null;

create table if not exists public.kpi_daily_routine_checks (
  id uuid primary key default gen_random_uuid(),
  kpi_entry_id uuid not null references public.kpi_entries(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete cascade,
  item text not null,
  is_checked boolean not null default false,
  updated_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(kpi_entry_id, employee_id, item)
);

create index if not exists kpi_daily_routine_checks_entry_idx
on public.kpi_daily_routine_checks(kpi_entry_id, is_checked);

create index if not exists kpi_daily_routine_checks_employee_idx
on public.kpi_daily_routine_checks(employee_id, updated_at desc)
where employee_id is not null;

alter table public.kpi_entry_comments enable row level security;
alter table public.kpi_daily_routine_checks enable row level security;

grant select, insert, update, delete on public.kpi_entry_comments to authenticated;
grant select, insert, update, delete on public.kpi_daily_routine_checks to authenticated;

drop policy if exists kpi_entries_select_auth on public.kpi_entries;
create policy kpi_entries_select_auth on public.kpi_entries
for select to authenticated using (
  public.is_admin()
  or coalesce(is_public, true)
  or private.kpi_entry_related_to_current_employee(kpi_entries)
);

drop policy if exists kpi_entries_insert_auth on public.kpi_entries;
create policy kpi_entries_insert_auth on public.kpi_entries
for insert to authenticated with check (
  public.is_admin()
  or (
    (employee_id is null or employee_id = public.current_employee_id())
    and created_by = public.current_employee_id()
  )
);

drop policy if exists kpi_entries_update_auth on public.kpi_entries;
create policy kpi_entries_update_auth on public.kpi_entries
for update to authenticated using (
  public.is_admin()
  or private.kpi_entry_related_to_current_employee(kpi_entries)
) with check (
  public.is_admin()
  or private.kpi_entry_related_to_current_employee(kpi_entries)
);

drop policy if exists kpi_entries_delete_auth on public.kpi_entries;
create policy kpi_entries_delete_auth on public.kpi_entries
for delete to authenticated using (
  public.is_admin()
  or private.kpi_entry_related_to_current_employee(kpi_entries)
);

drop policy if exists kpi_entry_comments_select_auth on public.kpi_entry_comments;
create policy kpi_entry_comments_select_auth on public.kpi_entry_comments
for select to authenticated using (
  public.is_admin()
  or employee_id = public.current_employee_id()
  or exists (
    select 1 from public.kpi_entries entry
    where entry.id = kpi_entry_comments.kpi_entry_id
      and (coalesce(entry.is_public,true) or private.kpi_entry_related_to_current_employee(entry))
  )
);

drop policy if exists kpi_entry_comments_insert_auth on public.kpi_entry_comments;
create policy kpi_entry_comments_insert_auth on public.kpi_entry_comments
for insert to authenticated with check (
  public.is_admin()
  or (
    employee_id = public.current_employee_id()
    and exists (
      select 1 from public.kpi_entries entry
      where entry.id = kpi_entry_comments.kpi_entry_id
        and (coalesce(entry.is_public,true) or private.kpi_entry_related_to_current_employee(entry))
    )
  )
);

drop policy if exists kpi_entry_comments_update_auth on public.kpi_entry_comments;
create policy kpi_entry_comments_update_auth on public.kpi_entry_comments
for update to authenticated using (
  public.is_admin()
  or employee_id = public.current_employee_id()
) with check (
  public.is_admin()
  or employee_id = public.current_employee_id()
);

drop policy if exists kpi_entry_comments_delete_auth on public.kpi_entry_comments;
create policy kpi_entry_comments_delete_auth on public.kpi_entry_comments
for delete to authenticated using (
  public.is_admin()
  or employee_id = public.current_employee_id()
);

drop policy if exists kpi_daily_routine_checks_select_auth on public.kpi_daily_routine_checks;
create policy kpi_daily_routine_checks_select_auth on public.kpi_daily_routine_checks
for select to authenticated using (
  public.is_admin()
  or employee_id = public.current_employee_id()
  or exists (
    select 1 from public.kpi_entries entry
    where entry.id = kpi_daily_routine_checks.kpi_entry_id
      and (coalesce(entry.is_public,true) or private.kpi_entry_related_to_current_employee(entry))
  )
);

drop policy if exists kpi_daily_routine_checks_insert_auth on public.kpi_daily_routine_checks;
create policy kpi_daily_routine_checks_insert_auth on public.kpi_daily_routine_checks
for insert to authenticated with check (
  public.is_admin()
  or (
    employee_id = public.current_employee_id()
    and exists (
      select 1 from public.kpi_entries entry
      where entry.id = kpi_daily_routine_checks.kpi_entry_id
        and private.kpi_entry_related_to_current_employee(entry)
    )
  )
);

drop policy if exists kpi_daily_routine_checks_update_auth on public.kpi_daily_routine_checks;
create policy kpi_daily_routine_checks_update_auth on public.kpi_daily_routine_checks
for update to authenticated using (
  public.is_admin()
  or employee_id = public.current_employee_id()
  or exists (
    select 1 from public.kpi_entries entry
    where entry.id = kpi_daily_routine_checks.kpi_entry_id
      and private.kpi_entry_related_to_current_employee(entry)
  )
) with check (
  public.is_admin()
  or (
    employee_id = public.current_employee_id()
    and exists (
      select 1 from public.kpi_entries entry
      where entry.id = kpi_daily_routine_checks.kpi_entry_id
        and private.kpi_entry_related_to_current_employee(entry)
    )
  )
);

drop policy if exists kpi_daily_routine_checks_delete_auth on public.kpi_daily_routine_checks;
create policy kpi_daily_routine_checks_delete_auth on public.kpi_daily_routine_checks
for delete to authenticated using (
  public.is_admin()
  or employee_id = public.current_employee_id()
);

notify pgrst, 'reload schema';
