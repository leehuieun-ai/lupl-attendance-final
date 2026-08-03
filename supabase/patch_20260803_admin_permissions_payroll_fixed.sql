alter table public.employees
  add column if not exists payroll_fixed_basis jsonb not null default '[]'::jsonb;

create table if not exists public.admin_menu_permissions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  menu_id text not null,
  access_level text not null default 'none' check (access_level in ('none','read','edit','all')),
  created_by uuid references public.employees(id),
  updated_by uuid references public.employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(employee_id, menu_id)
);

create index if not exists admin_menu_permissions_employee_idx
  on public.admin_menu_permissions(employee_id);

alter table public.admin_menu_permissions enable row level security;

drop policy if exists "admin menu permissions admin all" on public.admin_menu_permissions;
create policy "admin menu permissions admin all"
  on public.admin_menu_permissions
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "admin menu permissions self read" on public.admin_menu_permissions;
create policy "admin menu permissions self read"
  on public.admin_menu_permissions
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.employees e
      where e.id = admin_menu_permissions.employee_id
        and e.user_id = auth.uid()
    )
  );
