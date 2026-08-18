create table if not exists public.kpi_entry_change_requests (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.kpi_entries(id) on delete cascade,
  project_id uuid null references public.kpi_entries(id) on delete set null,
  request_type text not null default 'edit',
  requested_by uuid not null references public.employees(id) on delete cascade,
  before_patch jsonb not null default '{}'::jsonb,
  after_patch jsonb not null default '{}'::jsonb,
  reason text null,
  status text not null default 'pending',
  reviewed_by uuid null references public.employees(id) on delete set null,
  review_note text null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz null,
  updated_at timestamptz not null default now(),
  constraint kpi_entry_change_requests_status_check
    check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  constraint kpi_entry_change_requests_type_check
    check (request_type in ('edit'))
);

create index if not exists kpi_entry_change_requests_entry_idx
on public.kpi_entry_change_requests(entry_id, created_at desc);

create index if not exists kpi_entry_change_requests_project_status_idx
on public.kpi_entry_change_requests(project_id, status, created_at desc);

create index if not exists kpi_entry_change_requests_requested_by_idx
on public.kpi_entry_change_requests(requested_by, created_at desc);

alter table public.kpi_entry_change_requests enable row level security;

grant select, insert, update on public.kpi_entry_change_requests to authenticated;

drop policy if exists "kpi_entry_change_requests_select" on public.kpi_entry_change_requests;
create policy "kpi_entry_change_requests_select"
on public.kpi_entry_change_requests
for select
using (
  exists (
    select 1
    from public.employees viewer
    where viewer.user_id = auth.uid()
      and (
        viewer.role = 'admin'
        or viewer.id = requested_by
      )
  )
);

drop policy if exists "kpi_entry_change_requests_insert" on public.kpi_entry_change_requests;
create policy "kpi_entry_change_requests_insert"
on public.kpi_entry_change_requests
for insert
with check (
  exists (
    select 1
    from public.employees requester
    where requester.user_id = auth.uid()
      and requester.id = requested_by
      and exists (
        select 1
        from public.kpi_entries target
        left join public.kpi_entries weekly_parent
          on weekly_parent.id = target.parent_id
          and target.scope = 'daily'
        left join public.kpi_entries project_parent
          on project_parent.id = coalesce(weekly_parent.parent_id, target.parent_id)
          and project_parent.scope = 'monthly'
        where target.id = entry_id
          and target.is_active is not false
          and (
            target.employee_id = requester.id
            or (target.scope = 'monthly' and target.employee_id = requester.id)
            or (target.scope in ('weekly', 'daily') and project_parent.employee_id = requester.id)
          )
      )
  )
);

drop policy if exists "kpi_entry_change_requests_update" on public.kpi_entry_change_requests;
create policy "kpi_entry_change_requests_update"
on public.kpi_entry_change_requests
for update
using (
  exists (
    select 1
    from public.employees reviewer
    where reviewer.user_id = auth.uid()
      and reviewer.role = 'admin'
  )
)
with check (
  exists (
    select 1
    from public.employees reviewer
    where reviewer.user_id = auth.uid()
      and reviewer.role = 'admin'
  )
);
