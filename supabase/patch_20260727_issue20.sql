-- 2026-07-27 Issue #20: 개선함 첨부/비공개, 반려 근무시간 변경 삭제

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

alter table public.improvement_requests add column if not exists attachments jsonb not null default '[]'::jsonb;
alter table public.improvement_requests add column if not exists visibility text not null default 'employee_owner';
alter table public.improvement_requests drop constraint if exists improvement_requests_visibility_check;
alter table public.improvement_requests add constraint improvement_requests_visibility_check check (visibility in ('employee_owner','admin_only'));
alter table public.improvement_requests enable row level security;

drop policy if exists improvement_requests_select_auth on public.improvement_requests;
create policy improvement_requests_select_auth on public.improvement_requests
for select to authenticated using (
  public.is_admin()
  or (created_by = public.current_employee_id() and coalesce(visibility,'employee_owner') <> 'admin_only')
);

drop policy if exists improvement_requests_insert_auth on public.improvement_requests;
create policy improvement_requests_insert_auth on public.improvement_requests
for insert to authenticated with check (
  created_by = public.current_employee_id()
  and (coalesce(visibility,'employee_owner') <> 'admin_only' or public.is_admin())
);

create or replace function public.delete_rejected_work_time_change_request(
  p_request_id uuid
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_admin uuid;
  v_before public.work_time_change_requests%rowtype;
begin
  if not public.is_admin() then raise exception '관리자만 삭제할 수 있습니다.'; end if;
  v_admin := public.current_employee_id();

  select * into v_before
  from public.work_time_change_requests
  where id = p_request_id
    and status = 'rejected';

  if not found then raise exception '삭제할 반려 요청이 없습니다.'; end if;

  delete from public.work_time_change_requests where id = p_request_id and status = 'rejected';

  insert into public.audit_logs(actor_employee_id,action,target_table,target_id,before_data,reason)
  values(v_admin,'delete_rejected_work_time_change_request','work_time_change_requests',p_request_id,to_jsonb(v_before),'반려 근무시간 변경 요청 삭제');

  return jsonb_build_object('ok',true);
end;
$$;

grant execute on function public.delete_rejected_work_time_change_request(uuid) to authenticated;
notify pgrst, 'reload schema';
