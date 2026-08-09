-- 2026-08-10 AI assistant inquiry logging
create table if not exists public.ai_assistant_inquiries (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.employees(id) on delete cascade,
  question text not null,
  response_text text not null,
  status text not null default 'answered' check (status in ('answered','error')),
  model text,
  actions jsonb not null default '[]'::jsonb,
  followup_questions jsonb not null default '[]'::jsonb,
  page_context jsonb not null default '{}'::jsonb,
  error_message text,
  user_agent text,
  viewport_width int,
  viewport_height int,
  created_at timestamptz not null default now()
);

create index if not exists ai_assistant_inquiries_created_at_idx
  on public.ai_assistant_inquiries(created_at desc);

create index if not exists ai_assistant_inquiries_created_by_idx
  on public.ai_assistant_inquiries(created_by, created_at desc);

alter table public.ai_assistant_inquiries enable row level security;

grant select, insert on table public.ai_assistant_inquiries to authenticated;

drop policy if exists ai_assistant_inquiries_select_admin on public.ai_assistant_inquiries;
create policy ai_assistant_inquiries_select_admin
  on public.ai_assistant_inquiries
  for select
  to authenticated
  using (public.is_admin());

drop policy if exists ai_assistant_inquiries_insert_self on public.ai_assistant_inquiries;
create policy ai_assistant_inquiries_insert_self
  on public.ai_assistant_inquiries
  for insert
  to authenticated
  with check (created_by = public.current_employee_id());

notify pgrst, 'reload schema';
