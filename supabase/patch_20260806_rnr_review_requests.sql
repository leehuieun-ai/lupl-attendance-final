-- 2026-08-06 R&R employee review requests
-- Supabase SQL Editor에서 1회 실행하세요.

create table if not exists public.rnr_review_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.employees(id) on delete cascade,
  raw_input text not null,
  title text not null,
  summary text not null,
  suggestion jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  review_note text,
  reviewed_by uuid references public.employees(id),
  reviewed_at timestamptz,
  rnr_entry_id uuid references public.rnr_entries(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists rnr_review_requests_status_idx
on public.rnr_review_requests(status, created_at desc);

create index if not exists rnr_review_requests_requester_idx
on public.rnr_review_requests(requester_id, created_at desc);

alter table public.rnr_review_requests enable row level security;

drop policy if exists rnr_review_requests_select_auth on public.rnr_review_requests;
create policy rnr_review_requests_select_auth on public.rnr_review_requests
for select to authenticated using (
  public.is_admin()
  or requester_id = public.current_employee_id()
);

drop policy if exists rnr_review_requests_insert_owner on public.rnr_review_requests;
create policy rnr_review_requests_insert_owner on public.rnr_review_requests
for insert to authenticated with check (
  requester_id = public.current_employee_id()
  and status = 'pending'
);

drop policy if exists rnr_review_requests_admin_update on public.rnr_review_requests;
create policy rnr_review_requests_admin_update on public.rnr_review_requests
for update to authenticated using (public.is_admin()) with check (public.is_admin());
