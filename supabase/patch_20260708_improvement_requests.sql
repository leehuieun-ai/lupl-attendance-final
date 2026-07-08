-- 2026-07-08 개선 요청함
-- Supabase SQL Editor에서 1회 실행하세요.

create table if not exists public.improvement_requests (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.employees(id) on delete cascade,
  request_type text not null default 'bug',
  request_type_label text not null default '오류',
  menu_id text,
  menu_label text,
  submenu_label text,
  page_title text,
  page_path text,
  note text not null,
  status text not null default 'open' check (status in ('open','reviewing','planned','done','dismissed')),
  ai_summary text,
  ai_payload jsonb not null default '{}'::jsonb,
  user_agent text,
  viewport_width int,
  viewport_height int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists improvement_requests_status_idx
on public.improvement_requests(status, created_at desc);

create index if not exists improvement_requests_menu_idx
on public.improvement_requests(menu_id, submenu_label, created_at desc);

create index if not exists improvement_requests_created_by_idx
on public.improvement_requests(created_by, created_at desc);

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

drop policy if exists improvement_requests_admin_update on public.improvement_requests;
create policy improvement_requests_admin_update on public.improvement_requests
for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists improvement_requests_owner_update on public.improvement_requests;
create policy improvement_requests_owner_update on public.improvement_requests
for update to authenticated using (
  created_by = public.current_employee_id()
  and status = 'open'
) with check (
  created_by = public.current_employee_id()
  and status = 'open'
);
